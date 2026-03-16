use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
pub struct Permissions {
    pub files: bool,
    pub terminal: bool,
    pub browser: bool,
    pub automation: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LauncherConfig {
    pub profile: String,
    pub platforms: Vec<String>,
    pub permissions: Permissions,
    pub install_path: String,
    pub bot_status: String,
    pub bot_name: String,
    pub command_prefix: String,
    pub model_provider: String,
    pub bot_purpose: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LauncherSecrets {
    pub openai_api_key: String,
    pub discord_bot_token: String,
    pub telegram_bot_token: String,
}

#[derive(Serialize)]
pub struct CommandResponse {
    pub success: bool,
    pub message: String,
}

pub struct GatewayProcessState(pub Mutex<Option<Child>>);

fn expand_home(path: String) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(path.trim_start_matches("~/"));
        }
    }
    PathBuf::from(path)
}

fn find_node_binary() -> Option<PathBuf> {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/bin/node",
    ];

    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Some(path);
        }
    }

    if let Ok(output) = Command::new("which").arg("node").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && Path::new(&path).exists() {
                return Some(PathBuf::from(path));
            }
        }
    }

    None
}

fn resolve_script_path(app: &AppHandle, filename: &str) -> Option<PathBuf> {
    let dev_path = PathBuf::from("../scripts").join(filename);
    if dev_path.exists() {
        return Some(dev_path);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("scripts").join(filename),
            resource_dir.join("_up_").join("scripts").join(filename),
        ];

        for candidate in candidates {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

#[tauri::command]
pub fn check_environment() -> CommandResponse {
    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch.".to_string(),
        };
    };

    match Command::new(&node_path).arg("--version").output() {
        Ok(output) => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CommandResponse {
                success: true,
                message: format!("Environment check passed. Found Node {} at {}", version, node_path.display()),
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Node was found at {}, but could not be executed: {}", node_path.display(), e),
        },
    }
}

#[tauri::command]
pub fn create_install_folder(path: String) -> CommandResponse {
    let expanded = expand_home(path);

    match fs::create_dir_all(&expanded) {
        Ok(_) => CommandResponse {
            success: true,
            message: format!("Created install folder at {}", expanded.display()),
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to create install folder: {}", e),
        },
    }
}

#[tauri::command]
pub fn write_launcher_config(config: LauncherConfig) -> CommandResponse {
    let install_dir = expand_home(config.install_path.clone());
    let config_path = install_dir.join("launcher-state.json");

    if let Err(e) = fs::create_dir_all(&install_dir) {
        return CommandResponse {
            success: false,
            message: format!("Failed to prepare launcher state directory: {}", e),
        };
    }

    match serde_json::to_string_pretty(&config) {
        Ok(json) => match fs::write(&config_path, json) {
            Ok(_) => CommandResponse {
                success: true,
                message: format!("Launcher state written to {}", config_path.display()),
            },
            Err(e) => CommandResponse {
                success: false,
                message: format!("Failed to write launcher state: {}", e),
            },
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to serialize launcher state: {}", e),
        },
    }
}

#[tauri::command]
pub fn write_secrets(path: String, secrets: LauncherSecrets) -> CommandResponse {
    let install_dir = expand_home(path);
    let secrets_path = install_dir.join("secrets.json");

    if let Err(e) = fs::create_dir_all(&install_dir) {
        return CommandResponse {
            success: false,
            message: format!("Failed to prepare secrets directory: {}", e),
        };
    }

    match serde_json::to_string_pretty(&secrets) {
        Ok(json) => match fs::write(&secrets_path, json) {
            Ok(_) => CommandResponse {
                success: true,
                message: format!("Secrets written to {}", secrets_path.display()),
            },
            Err(e) => CommandResponse {
                success: false,
                message: format!("Failed to write secrets: {}", e),
            },
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to serialize secrets: {}", e),
        },
    }
}

#[tauri::command]
pub fn write_openclaw_config(app: AppHandle, path: String) -> CommandResponse {
    let install_dir = expand_home(path);

    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch.".to_string(),
        };
    };

    let Some(script_path) = resolve_script_path(&app, "install-openclaw.cjs") else {
        return CommandResponse {
            success: false,
            message: "Could not find install-openclaw.cjs in app resources.".to_string(),
        };
    };

    let output = Command::new(node_path)
        .arg(script_path)
        .arg(&install_dir)
        .arg("--config-only")
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                CommandResponse {
                    success: true,
                    message: "OpenClaw config written.".to_string(),
                }
            } else {
                let stdout = String::from_utf8_lossy(&result.stdout).to_string();
                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                CommandResponse {
                    success: false,
                    message: format!(
                        "Failed to write OpenClaw config.\n{}\n{}",
                        stdout.trim(),
                        stderr.trim()
                    ),
                }
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to run config writer: {}", e),
        },
    }
}

#[tauri::command]
pub fn install_openclaw(app: AppHandle, path: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let log_path = install_dir.join("installer.log");

    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch.".to_string(),
        };
    };

    let Some(script_path) = resolve_script_path(&app, "install-openclaw.cjs") else {
        return CommandResponse {
            success: false,
            message: "Could not find install-openclaw.cjs in app resources.".to_string(),
        };
    };

    if let Err(e) = fs::create_dir_all(&install_dir) {
        return CommandResponse {
            success: false,
            message: format!("Failed to create install directory: {}", e),
        };
    }

    let output = Command::new(node_path)
        .arg(script_path)
        .arg(&install_dir)
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();

            let combined = format!(
                "{}{}{}",
                stdout,
                if !stdout.is_empty() && !stderr.is_empty() { "\n" } else { "" },
                stderr
            );

            let _ = fs::write(&log_path, &combined);

            if result.status.success() {
                CommandResponse {
                    success: true,
                    message: format!(
                        "OpenClaw installer completed successfully.\n{}",
                        combined.trim()
                    ),
                }
            } else {
                CommandResponse {
                    success: false,
                    message: format!(
                        "OpenClaw installer failed.\n{}",
                        combined.trim()
                    ),
                }
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to run OpenClaw installer: {}", e),
        },
    }

}

#[tauri::command]
pub fn start_openclaw(
    app: AppHandle,
    path: String,
    state: State<'_, GatewayProcessState>,
) -> CommandResponse {
    let mut guard = state.0.lock().unwrap();

    if guard.is_some() {
        return CommandResponse {
            success: false,
            message: "OpenClaw start already in progress.".to_string(),
        };
    }

    let install_dir = expand_home(path);
    let log_path = install_dir.join("gateway.log");

    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch.".to_string(),
        };
    };

    let Some(script_path) = resolve_script_path(&app, "start-openclaw.cjs") else {
        return CommandResponse {
            success: false,
            message: "Could not find start-openclaw.cjs in app resources.".to_string(),
        };
    };

    let log_file = match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(file) => file,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to open gateway log: {}", e),
            }
        }
    };

    let log_file_err = match log_file.try_clone() {
        Ok(file) => file,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to clone gateway log handle: {}", e),
            }
        }
    };

    let child = match Command::new(node_path)
        .arg(script_path)
        .arg(&install_dir)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err))
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to start OpenClaw: {}", e),
            }
        }
    };

    *guard = Some(child);

    CommandResponse {
        success: true,
        message: "OpenClaw start requested.".to_string(),
    }
}

#[tauri::command]
pub fn stop_openclaw(path: String, state: State<'_, GatewayProcessState>) -> CommandResponse {
    let install_dir = expand_home(path);
    let log_path = install_dir.join("gateway.log");
    let status_path = install_dir.join("gateway-status.json");

    {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }

    let openclaw_bin = match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".openclaw/bin/openclaw"),
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to resolve HOME for openclaw binary: {}", e),
            }
        }
    };

    let result = Command::new(openclaw_bin)
        .arg("gateway")
        .arg("stop")
        .output();

    let _ = fs::write(
        status_path,
        r#"{"status":"stopped","updatedAt":"manual-stop"}"#,
    );

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .and_then(|mut f| {
                    writeln!(f, "{}", stdout)?;
                    writeln!(f, "{}", stderr)?;
                    Ok(())
                });

            CommandResponse {
                success: output.status.success(),
                message: if output.status.success() {
                    "OpenClaw stopped.".to_string()
                } else if !stderr.trim().is_empty() {
                    format!("Failed to stop OpenClaw: {}", stderr.trim())
                } else {
                    "Failed to stop OpenClaw.".to_string()
                },
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to run openclaw gateway stop: {}", e),
        },
    }
}

#[tauri::command]
pub fn restart_openclaw(
    app: AppHandle,
    path: String,
    state: State<'_, GatewayProcessState>,
) -> CommandResponse {
    let _ = stop_openclaw(path.clone(), state.clone());
    start_openclaw(app, path, state)
}

#[tauri::command]
pub fn read_gateway_status(path: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let openclaw_bin = match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".openclaw/bin/openclaw"),
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to resolve HOME for openclaw binary: {}", e),
            }
        }
    };

    let output = Command::new(openclaw_bin)
        .arg("gateway")
        .arg("status")
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();

            let status_path = install_dir.join("gateway-status.json");
            let _ = fs::write(
                status_path,
                serde_json::json!({
                    "status": if result.status.success() { "running" } else { "stopped" },
                    "updatedAt": "runtime-check",
                    "detail": stdout.trim(),
                    "error": stderr.trim(),
                })
                .to_string(),
            );

            CommandResponse {
                success: result.status.success(),
                message: if !stdout.trim().is_empty() {
                    stdout
                } else if !stderr.trim().is_empty() {
                    stderr
                } else {
                    "No status output.".to_string()
                },
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to run openclaw gateway status: {}", e),
        },
    }
}

#[tauri::command]
pub fn probe_channels() -> CommandResponse {
    let openclaw_bin = match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".openclaw/bin/openclaw"),
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Failed to resolve HOME for openclaw binary: {}", e),
            }
        }
    };

    let output = Command::new(openclaw_bin)
        .arg("channels")
        .arg("status")
        .arg("--probe")
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();

            CommandResponse {
                success: result.status.success(),
                message: if !stdout.trim().is_empty() {
                    stdout
                } else {
                    stderr
                },
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Failed to probe channels: {}", e),
        },
    }
}

#[tauri::command]
pub fn validate_platform_tokens(path: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let secrets_path = install_dir.join("secrets.json");
    let state_path = install_dir.join("launcher-state.json");

    let secrets_raw = match fs::read_to_string(&secrets_path) {
        Ok(v) => v,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Could not read secrets.json: {}", e),
            }
        }
    };

    let state_raw = match fs::read_to_string(&state_path) {
        Ok(v) => v,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Could not read launcher-state.json: {}", e),
            }
        }
    };

    let secrets: LauncherSecrets = match serde_json::from_str(&secrets_raw) {
        Ok(v) => v,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Could not parse secrets.json: {}", e),
            }
        }
    };

    let state: LauncherConfig = match serde_json::from_str(&state_raw) {
        Ok(v) => v,
        Err(e) => {
            return CommandResponse {
                success: false,
                message: format!("Could not parse launcher-state.json: {}", e),
            }
        }
    };

    let mut results: Vec<String> = vec![];
    let mut ok = true;

    if state.model_provider == "openai" {
        if secrets.openai_api_key.trim().is_empty() {
            ok = false;
            results.push("OpenAI: missing API key.".to_string());
        } else {
            results.push("OpenAI: key present.".to_string());
        }
    }

    if state.platforms.iter().any(|p| p == "discord") {
        if secrets.discord_bot_token.trim().is_empty() {
            ok = false;
            results.push("Discord: token missing.".to_string());
        } else {
            let output = Command::new("curl")
                .arg("-s")
                .arg("-o")
                .arg("/dev/null")
                .arg("-w")
                .arg("%{http_code}")
                .arg("-H")
                .arg(format!("Authorization: Bot {}", secrets.discord_bot_token.trim()))
                .arg("https://discord.com/api/v10/users/@me")
                .output();

            match output {
                Ok(out) => {
                    let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if code == "200" {
                        results.push("Discord: token looks valid.".to_string());
                    } else {
                        ok = false;
                        results.push(format!("Discord: token check failed (HTTP {}).", code));
                    }
                }
                Err(e) => {
                    ok = false;
                    results.push(format!("Discord: validation failed to run: {}", e));
                }
            }
        }
    }

    if state.platforms.iter().any(|p| p == "telegram") {
        if secrets.telegram_bot_token.trim().is_empty() {
            ok = false;
            results.push("Telegram: token missing.".to_string());
        } else {
            let url = format!(
                "https://api.telegram.org/bot{}/getMe",
                secrets.telegram_bot_token.trim()
            );

            let output = Command::new("curl")
                .arg("-s")
                .arg(&url)
                .output();

            match output {
                Ok(out) => {
                    let body = String::from_utf8_lossy(&out.stdout).to_string();
                    if body.contains("\"ok\":true") {
                        results.push("Telegram: token looks valid.".to_string());
                    } else {
                        ok = false;
                        results.push("Telegram: token check failed.".to_string());
                    }
                }
                Err(e) => {
                    ok = false;
                    results.push(format!("Telegram: validation failed to run: {}", e));
                }
            }
        }
    }

    CommandResponse {
        success: ok,
        message: results.join("\n"),
    }
}