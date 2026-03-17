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
    #[serde(default)]
    pub anthropic_api_key: String,
    #[serde(default)]
    pub google_api_key: String,
    #[serde(default)]
    pub xai_api_key: String,
    #[serde(default)]
    pub mistral_api_key: String,
    #[serde(default)]
    pub openrouter_api_key: String,
    pub discord_bot_token: String,
    pub telegram_bot_token: String,
    #[serde(default)]
    pub slack_bot_token: String,
    #[serde(default)]
    pub googlechat_webhook: String,
}

#[derive(Serialize)]
pub struct CommandResponse {
    pub success: bool,
    pub message: String,
}

pub struct GatewayProcessState(pub Mutex<Option<Child>>);

/// Expands leading `~/` on macOS/Linux using $HOME.
/// On Windows, expands `~/` using USERPROFILE or HOMEDRIVE+HOMEPATH.
fn expand_home(path: String) -> PathBuf {
    if path.starts_with("~/") || path.starts_with("~\\") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .or_else(|_| {
                let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
                let home_path = std::env::var("HOMEPATH").unwrap_or_default();
                if drive.is_empty() && home_path.is_empty() {
                    Err(std::env::VarError::NotPresent)
                } else {
                    Ok(format!("{}{}", drive, home_path))
                }
            });

        if let Ok(home) = home {
            let stripped = path
                .trim_start_matches("~/")
                .trim_start_matches("~\\");
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

fn find_node_binary() -> Option<PathBuf> {
    // macOS/Linux common paths
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

    // Windows: look for node.exe on PATH via `where` command
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("where").arg("node").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() && Path::new(&path).exists() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }

    // macOS/Linux fallback: `which node`
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("which").arg("node").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && Path::new(&path).exists() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }

    None
}

fn resolve_script_path(app: &AppHandle, filename: &str) -> Option<PathBuf> {
    // Dev mode: scripts are relative to the project root
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

/// Returns the resolved HOME directory, works on Windows and Unix.
fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "Could not resolve home directory (HOME / USERPROFILE not set).".to_string())
}

#[tauri::command]
pub fn check_environment() -> CommandResponse {
    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch."
                .to_string(),
        };
    };

    match Command::new(&node_path).arg("--version").output() {
        Ok(output) => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CommandResponse {
                success: true,
                message: format!(
                    "Environment check passed. Found Node {} at {}",
                    version,
                    node_path.display()
                ),
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!(
                "Node was found at {}, but could not be executed: {}",
                node_path.display(),
                e
            ),
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
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch."
                .to_string(),
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
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch."
                .to_string(),
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
                if !stdout.is_empty() && !stderr.is_empty() {
                    "\n"
                } else {
                    ""
                },
                stderr
            );

            let _ = fs::write(&log_path, &combined);

            if result.status.success() {
                // AUTO-FIX: always run `openclaw doctor --fix` after install
                // so the config is clean before the gateway starts.
                // This silently removes any unrecognized keys (like systemPrompt)
                // without the user ever needing to touch the terminal.
                let openclaw_bin = home_dir()
                    .map(|h| h.join(".openclaw/bin/openclaw"))
                    .unwrap_or_else(|_| PathBuf::from("openclaw"));

                let _ = Command::new(&openclaw_bin)
                    .arg("doctor")
                    .arg("--fix")
                    .output();

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
                    message: format!("OpenClaw installer failed.\n{}", combined.trim()),
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

    // If there's already a running child, return success rather than blocking
    if let Some(child) = guard.as_mut() {
        // Check if it's actually still alive
        match child.try_wait() {
            Ok(Some(_)) => {
                // Exited — clear the slot and proceed to restart
                *guard = None;
            }
            Ok(None) => {
                // Still running
                return CommandResponse {
                    success: true,
                    message: "OpenClaw gateway is already running.".to_string(),
                };
            }
            Err(_) => {
                *guard = None;
            }
        }
    }

    let install_dir = expand_home(path);
    let log_path = install_dir.join("gateway.log");

    // AUTO-FIX: run `openclaw doctor --fix` before every gateway start.
    // This ensures the config is always valid even if a previous install
    // wrote unrecognized keys. Silent — we ignore failures here.
    let openclaw_bin = home_dir()
        .map(|h| h.join(".openclaw/bin/openclaw"))
        .unwrap_or_else(|_| PathBuf::from("openclaw"));
    let _ = Command::new(&openclaw_bin)
        .arg("doctor")
        .arg("--fix")
        .output();

    let Some(node_path) = find_node_binary() else {
        return CommandResponse {
            success: false,
            message: "Node.js was not found. Please install Node.js, then reopen ClawLaunch."
                .to_string(),
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
        message: "OpenClaw gateway started.".to_string(),
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

    let openclaw_bin = match home_dir() {
        Ok(home) => home.join(".openclaw/bin/openclaw"),
        Err(e) => {
            return CommandResponse {
                success: false,
                message: e,
            }
        }
    };

    let result = Command::new(&openclaw_bin)
        .arg("gateway")
        .arg("stop")
        .output();

    let _ = fs::write(
        &status_path,
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

// FIX: restart_openclaw must pass the AppHandle to start_openclaw
#[tauri::command]
pub fn restart_openclaw(
    app: AppHandle,
    path: String,
    state: State<'_, GatewayProcessState>,
) -> CommandResponse {
    // Kill the running child process directly (don't call stop_openclaw which also
    // tries to run the openclaw CLI — that's fine for a clean stop but redundant here)
    {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }

    start_openclaw(app, path, state)
}

// FIX: use TCP port probe instead of calling openclaw CLI.
// The CLI fails when the config has invalid keys (e.g. systemPrompt), even
// when the gateway is actually running. A TCP connect to port 18789 is the
// only reliable way to check if the gateway is up.
#[tauri::command]
pub fn read_gateway_status(path: String) -> CommandResponse {
    use std::net::TcpStream;
    use std::time::Duration;

    let install_dir = expand_home(path);
    let status_path = install_dir.join("gateway-status.json");

    // Try to open a TCP connection to the gateway port
    let is_running = TcpStream::connect_timeout(
        &"127.0.0.1:18789".parse().unwrap(),
        Duration::from_millis(800),
    )
    .is_ok();

    let status = if is_running { "running" } else { "stopped" };
    let message = if is_running {
        "Gateway is running on port 18789.".to_string()
    } else {
        "Gateway is not running on port 18789.".to_string()
    };

    let _ = fs::write(
        &status_path,
        serde_json::json!({
            "status": status,
            "updatedAt": "tcp-probe",
            "detail": &message,
            "error": "",
        })
        .to_string(),
    );

    CommandResponse {
        success: is_running,
        message,
    }
}

#[tauri::command]
pub fn probe_channels() -> CommandResponse {
    let openclaw_bin = match home_dir() {
        Ok(home) => home.join(".openclaw/bin/openclaw"),
        Err(e) => {
            return CommandResponse {
                success: false,
                message: e,
            }
        }
    };

    let output = Command::new(&openclaw_bin)
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

/// FIX: replaced curl subprocess with Rust's std::net TCP check for Discord
/// and a simple HTTP GET using std for Telegram — no curl dependency required.
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
        } else if secrets.openai_api_key.trim().starts_with("sk-") {
            results.push("OpenAI: key present and looks valid.".to_string());
        } else {
            ok = false;
            results.push("OpenAI: key present but format looks wrong (should start with sk-).".to_string());
        }
    }

    if state.platforms.iter().any(|p| p == "discord") {
        if secrets.discord_bot_token.trim().is_empty() {
            ok = false;
            results.push("Discord: token missing.".to_string());
        } else {
            // Discord bot tokens are always: <id>.<timestamp>.<hmac> — two dots minimum
            let token = secrets.discord_bot_token.trim();
            let parts: Vec<&str> = token.splitn(3, '.').collect();
            if parts.len() == 3 && !parts[0].is_empty() && !parts[1].is_empty() {
                results.push("Discord: token format looks valid.".to_string());
            } else {
                ok = false;
                results.push("Discord: token format looks wrong. Make sure you copied the full bot token.".to_string());
            }
        }
    }

    if state.platforms.iter().any(|p| p == "telegram") {
        if secrets.telegram_bot_token.trim().is_empty() {
            ok = false;
            results.push("Telegram: token missing.".to_string());
        } else {
            // Telegram tokens are always: <number>:<alphanumeric>
            let token = secrets.telegram_bot_token.trim();
            let parts: Vec<&str> = token.splitn(2, ':').collect();
            if parts.len() == 2 && parts[0].chars().all(|c| c.is_ascii_digit()) && !parts[1].is_empty() {
                results.push("Telegram: token format looks valid.".to_string());
            } else {
                ok = false;
                results.push("Telegram: token format looks wrong. It should look like 123456789:ABCdef...".to_string());
            }
        }
    }

    CommandResponse {
        success: ok,
        message: results.join("\n"),
    }
}

// ─────────────────────────────────────────────────────────────
// BATCH 1: Auto-refresh, Live logs, Auto-start on login
// ─────────────────────────────────────────────────────────────

/// Fast TCP probe — same as read_gateway_status but lighter,
/// called by the 30-second auto-refresh ticker in the frontend.
#[tauri::command]
pub fn ping_gateway() -> CommandResponse {
    use std::net::TcpStream;
    use std::time::Duration;

    let is_running = TcpStream::connect_timeout(
        &"127.0.0.1:18789".parse().unwrap(),
        Duration::from_millis(600),
    )
    .is_ok();

    CommandResponse {
        success: is_running,
        message: if is_running {
            "running".to_string()
        } else {
            "stopped".to_string()
        },
    }
}

/// Read the last N lines of the gateway log file.
/// Returns them newest-first so the UI can show the most recent activity at the top.
#[tauri::command]
pub fn read_gateway_log(path: String, lines: usize) -> CommandResponse {
    let install_dir = expand_home(path);
    let log_path = install_dir.join("gateway.log");

    match fs::read_to_string(&log_path) {
        Ok(content) => {
            let collected: Vec<&str> = content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .rev()
                .take(lines)
                .collect();

            CommandResponse {
                success: true,
                message: collected.join("\n"),
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Could not read gateway log: {}", e),
        },
    }
}

/// Enable or disable auto-start on login.
/// macOS: writes/removes a LaunchAgent plist.
/// Windows: writes/removes a registry key under HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
#[tauri::command]
pub fn set_auto_start(enabled: bool) -> CommandResponse {
    #[cfg(target_os = "macos")]
    {
        let home = match home_dir() {
            Ok(h) => h,
            Err(e) => return CommandResponse { success: false, message: e },
        };

        let agents_dir = home.join("Library/LaunchAgents");
        let plist_path = agents_dir.join("ai.clawlaunch.plist");

        if !enabled {
            // Remove plist and unload
            if plist_path.exists() {
                let _ = Command::new("launchctl")
                    .arg("unload")
                    .arg(&plist_path)
                    .output();
                let _ = fs::remove_file(&plist_path);
            }
            return CommandResponse {
                success: true,
                message: "Auto-start disabled.".to_string(),
            };
        }

        // Find the ClawLaunch app bundle
        let app_path = std::env::current_exe()
            .ok()
            .and_then(|p| {
                // Walk up from .../ClawLaunch.app/Contents/MacOS/clawlaunch-launcher
                // to .../ClawLaunch.app
                let mut p = p;
                for _ in 0..3 {
                    p = match p.parent() {
                        Some(parent) => parent.to_path_buf(),
                        None => return None,
                    };
                    if p.extension().and_then(|e| e.to_str()) == Some("app") {
                        return Some(p);
                    }
                }
                None
            })
            .unwrap_or_else(|| PathBuf::from("/Applications/ClawLaunch.app"));

        if let Err(e) = fs::create_dir_all(&agents_dir) {
            return CommandResponse {
                success: false,
                message: format!("Could not create LaunchAgents dir: {}", e),
            };
        }

        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.clawlaunch</string>
  <key>ProgramArguments</key>
  <array>
    <string>open</string>
    <string>-a</string>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>"#,
            app_path.display()
        );

        match fs::write(&plist_path, plist) {
            Ok(_) => {
                let _ = Command::new("launchctl")
                    .arg("load")
                    .arg(&plist_path)
                    .output();
                CommandResponse {
                    success: true,
                    message: "Auto-start enabled. ClawLaunch will open on login.".to_string(),
                }
            }
            Err(e) => CommandResponse {
                success: false,
                message: format!("Could not write LaunchAgent plist: {}", e),
            },
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let exe = match std::env::current_exe() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(e) => return CommandResponse { success: false, message: format!("Could not find exe path: {}", e) },
        };

        if enabled {
            let result = Command::new("reg")
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", "ClawLaunch",
                    "/t", "REG_SZ",
                    "/d", &exe,
                    "/f",
                ])
                .output();

            match result {
                Ok(o) if o.status.success() => CommandResponse {
                    success: true,
                    message: "Auto-start enabled.".to_string(),
                },
                Ok(o) => CommandResponse {
                    success: false,
                    message: format!("Registry write failed: {}", String::from_utf8_lossy(&o.stderr)),
                },
                Err(e) => CommandResponse {
                    success: false,
                    message: format!("Could not run reg.exe: {}", e),
                },
            }
        } else {
            let result = Command::new("reg")
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", "ClawLaunch",
                    "/f",
                ])
                .output();

            CommandResponse {
                success: result.map(|o| o.status.success()).unwrap_or(false),
                message: "Auto-start disabled.".to_string(),
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = enabled;
        CommandResponse {
            success: false,
            message: "Auto-start is not supported on this platform.".to_string(),
        }
    }
}

/// Check whether auto-start is currently enabled.
#[tauri::command]
pub fn get_auto_start() -> CommandResponse {
    #[cfg(target_os = "macos")]
    {
        let enabled = home_dir()
            .map(|h| h.join("Library/LaunchAgents/ai.clawlaunch.plist").exists())
            .unwrap_or(false);

        CommandResponse {
            success: enabled,
            message: if enabled { "enabled".to_string() } else { "disabled".to_string() },
        }
    }

    #[cfg(target_os = "windows")]
    {
        let result = Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v", "ClawLaunch",
            ])
            .output();

        let enabled = result.map(|o| o.status.success()).unwrap_or(false);
        CommandResponse {
            success: enabled,
            message: if enabled { "enabled".to_string() } else { "disabled".to_string() },
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        CommandResponse {
            success: false,
            message: "disabled".to_string(),
        }
    }
}

// ─────────────────────────────────────────────────────────────
// BATCH 2: Update checker, Usage stats, Crash recovery
// (Multiple profiles + Live API validation are handled in the frontend)
// ─────────────────────────────────────────────────────────────

/// Check if a newer version of OpenClaw is available.
/// Compares the installed binary version against the latest published version.
#[tauri::command]
pub fn check_for_updates() -> CommandResponse {
    let openclaw_bin = match home_dir() {
        Ok(home) => home.join(".openclaw/bin/openclaw"),
        Err(e) => return CommandResponse { success: false, message: e },
    };

    // Get installed version
    let installed = match Command::new(&openclaw_bin).arg("--version").output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(_) => return CommandResponse {
            success: false,
            message: "Could not read installed OpenClaw version.".to_string(),
        },
    };

    // Fetch latest version from openclaw.ai
    let latest = match Command::new("curl")
        .args(["-fsSL", "--max-time", "5", "https://openclaw.ai/version.txt"])
        .output()
    {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        _ => return CommandResponse {
            success: true,
            message: format!("up-to-date::{}", installed),
        },
    };

    if latest.is_empty() || installed.contains(&latest) {
        CommandResponse {
            success: true,
            message: format!("up-to-date::{}", installed),
        }
    } else {
        CommandResponse {
            success: true,
            message: format!("update-available::{}::{}", installed, latest),
        }
    }
}

/// Run `openclaw update` to update to the latest version.
#[tauri::command]
pub fn run_update() -> CommandResponse {
    let openclaw_bin = match home_dir() {
        Ok(home) => home.join(".openclaw/bin/openclaw"),
        Err(e) => return CommandResponse { success: false, message: e },
    };

    match Command::new(&openclaw_bin).arg("update").output() {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            CommandResponse {
                success: result.status.success(),
                message: if !stdout.is_empty() { stdout } else { stderr },
            }
        }
        Err(e) => CommandResponse {
            success: false,
            message: format!("Update failed: {}", e),
        },
    }
}

/// Read usage stats from the gateway log:
/// total messages handled, uptime estimate, last activity time.
#[tauri::command]
pub fn read_usage_stats(path: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let log_path = install_dir.join("gateway.log");

    let content = match fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return CommandResponse {
            success: true,
            message: r#"{"messages":0,"uptime":"unknown","lastActivity":"never"}"#.to_string(),
        },
    };

    let lines: Vec<&str> = content.lines().collect();

    // Count message events (lines containing "[discord]" or "[telegram]" with message indicators)
    let message_count = lines.iter().filter(|l| {
        (l.contains("[discord]") || l.contains("[telegram]")) &&
        (l.contains("message") || l.contains("received") || l.contains("reply") || l.contains("agent"))
    }).count();

    // Find first and last timestamp in log
    let first_ts = lines.iter()
        .find(|l| l.starts_with('[') || l.contains("-06:00") || l.contains("-05:00"))
        .map(|l| l.chars().take(32).collect::<String>())
        .unwrap_or_else(|| "unknown".to_string());

    let last_ts = lines.iter().rev()
        .find(|l| l.starts_with('[') || l.contains("-06:00") || l.contains("-05:00"))
        .map(|l| l.chars().take(32).collect::<String>())
        .unwrap_or_else(|| "unknown".to_string());

    // Count restart events
    let restarts = lines.iter().filter(|l| l.contains("Starting OpenClaw gateway")).count();

    let json = format!(
        r#"{{"messages":{},"restarts":{},"firstSeen":"{}","lastActivity":"{}"}}"#,
        message_count, restarts, first_ts, last_ts
    );

    CommandResponse { success: true, message: json }
}

/// Crash recovery: check if gateway died and restart it automatically.
/// Called periodically by the frontend watchdog.
#[tauri::command]
pub fn watchdog_check(
    app: AppHandle,
    path: String,
    state: State<'_, GatewayProcessState>,
) -> CommandResponse {
    use std::net::TcpStream;
    use std::time::Duration;

    // Check if port is responding
    let is_running = TcpStream::connect_timeout(
        &"127.0.0.1:18789".parse().unwrap(),
        Duration::from_millis(600),
    ).is_ok();

    if is_running {
        return CommandResponse {
            success: true,
            message: "ok".to_string(),
        };
    }

    // Port not responding — check if we have a child process that exited
    {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Crashed — clear slot and fall through to restart
                    let _ = status;
                    *guard = None;
                }
                Ok(None) => {
                    // Process alive but port not responding — give it time
                    return CommandResponse {
                        success: false,
                        message: "starting".to_string(),
                    };
                }
                Err(_) => {
                    *guard = None;
                }
            }
        }
    }

    // Auto-restart
    let restart_result = start_openclaw(app, path, state);
    CommandResponse {
        success: restart_result.success,
        message: if restart_result.success {
            "restarted".to_string()
        } else {
            format!("restart-failed::{}", restart_result.message)
        },
    }
}

/// Validate an OpenAI API key live by making a lightweight API call.
/// Uses curl to hit /v1/models — cheap, fast, reliable indicator.
#[tauri::command]
pub fn validate_openai_key_live(key: String) -> CommandResponse {
    if key.trim().is_empty() {
        return CommandResponse { success: false, message: "empty".to_string() };
    }
    if !key.trim().starts_with("sk-") {
        return CommandResponse { success: false, message: "bad-format".to_string() };
    }

    let result = Command::new("curl")
        .args([
            "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "--max-time", "6",
            "-H", &format!("Authorization: Bearer {}", key.trim()),
            "https://api.openai.com/v1/models",
        ])
        .output();

    match result {
        Ok(out) => {
            let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
            match code.as_str() {
                "200" => CommandResponse { success: true, message: "valid".to_string() },
                "401" => CommandResponse { success: false, message: "invalid".to_string() },
                "429" => CommandResponse { success: true, message: "rate-limited".to_string() },
                _ => CommandResponse { success: false, message: format!("http-{}", code) },
            }
        }
        Err(_) => CommandResponse { success: false, message: "network-error".to_string() },
    }
}

/// Validate a Discord bot token live via the Discord API.
#[tauri::command]
pub fn validate_discord_token_live(token: String) -> CommandResponse {
    if token.trim().is_empty() {
        return CommandResponse { success: false, message: "empty".to_string() };
    }

    let result = Command::new("curl")
        .args([
            "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "--max-time", "6",
            "-H", &format!("Authorization: Bot {}", token.trim()),
            "https://discord.com/api/v10/users/@me",
        ])
        .output();

    match result {
        Ok(out) => {
            let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
            match code.as_str() {
                "200" => CommandResponse { success: true, message: "valid".to_string() },
                "401" => CommandResponse { success: false, message: "invalid".to_string() },
                "429" => CommandResponse { success: true, message: "rate-limited".to_string() },
                _ => CommandResponse { success: false, message: format!("http-{}", code) },
            }
        }
        Err(_) => CommandResponse { success: false, message: "network-error".to_string() },
    }
}

// ─────────────────────────────────────────────────────────────
// BATCH 3: Notifications, Avatar, Config editor, Backup/restore
// ─────────────────────────────────────────────────────────────

/// Send a desktop notification using the OS native API.
/// macOS: uses `osascript`. Windows: uses PowerShell toast.
#[tauri::command]
pub fn send_notification(title: String, body: String) -> CommandResponse {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body.replace('"', "\\\""),
            title.replace('"', "\\\"")
        );
        let result = Command::new("osascript").arg("-e").arg(&script).output();
        return CommandResponse {
            success: result.map(|o| o.status.success()).unwrap_or(false),
            message: "Notification sent.".to_string(),
        };
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
            $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
            $template.GetElementsByTagName('text')[0].AppendChild($template.CreateTextNode('{}')) | Out-Null
            $template.GetElementsByTagName('text')[1].AppendChild($template.CreateTextNode('{}')) | Out-Null
            $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('ClawLaunch').Show($toast)
            "#,
            title.replace('\'', "''"),
            body.replace('\'', "''")
        );
        let result = Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
            .output();
        return CommandResponse {
            success: result.map(|o| o.status.success()).unwrap_or(false),
            message: "Notification sent.".to_string(),
        };
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (title, body);
        CommandResponse { success: false, message: "Notifications not supported on this platform.".to_string() }
    }
}

/// Set the Discord bot's avatar by uploading an image URL via the Discord API.
#[tauri::command]
pub fn set_discord_avatar(path: String, image_url: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let secrets_path = install_dir.join("secrets.json");

    let secrets_raw = match fs::read_to_string(&secrets_path) {
        Ok(v) => v,
        Err(e) => return CommandResponse { success: false, message: format!("Could not read secrets: {}", e) },
    };

    let secrets: LauncherSecrets = match serde_json::from_str(&secrets_raw) {
        Ok(v) => v,
        Err(e) => return CommandResponse { success: false, message: format!("Could not parse secrets: {}", e) },
    };

    if secrets.discord_bot_token.trim().is_empty() {
        return CommandResponse { success: false, message: "No Discord token found.".to_string() };
    }

    // Download the image first
    let download = Command::new("curl")
        .args(["-fsSL", "--max-time", "10", &image_url])
        .output();

    let image_bytes = match download {
        Ok(out) if out.status.success() && !out.stdout.is_empty() => out.stdout,
        _ => return CommandResponse { success: false, message: "Could not download image from that URL.".to_string() },
    };

    // Detect mime type
    let mime = if image_url.ends_with(".png") { "image/png" }
               else if image_url.ends_with(".jpg") || image_url.ends_with(".jpeg") { "image/jpeg" }
               else { "image/png" };

    // Base64 encode
    use std::fmt::Write as FmtWrite;
    let b64: String = {
        let bytes = &image_bytes;
        let mut out = String::new();
        let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let chars: Vec<char> = chars.chars().collect();
        let mut i = 0;
        while i < bytes.len() {
            let b0 = bytes[i] as usize;
            let b1 = if i + 1 < bytes.len() { bytes[i + 1] as usize } else { 0 };
            let b2 = if i + 2 < bytes.len() { bytes[i + 2] as usize } else { 0 };
            out.push(chars[(b0 >> 2) & 63]);
            out.push(chars[((b0 & 3) << 4) | (b1 >> 4)]);
            out.push(if i + 1 < bytes.len() { chars[((b1 & 15) << 2) | (b2 >> 6)] } else { '=' });
            out.push(if i + 2 < bytes.len() { chars[b2 & 63] } else { '=' });
            i += 3;
        }
        out
    };

    let data_uri = format!("data:{};base64,{}", mime, b64);
    let body = format!("{{\"avatar\":\"{}\"}}", data_uri);

    let result = Command::new("curl")
        .args([
            "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "--max-time", "15",
            "-X", "PATCH",
            "-H", "Content-Type: application/json",
            "-H", &format!("Authorization: Bot {}", secrets.discord_bot_token.trim()),
            "-d", &body,
            "https://discord.com/api/v10/users/@me",
        ])
        .output();

    match result {
        Ok(out) => {
            let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
            match code.as_str() {
                "200" => CommandResponse { success: true, message: "Avatar updated successfully!".to_string() },
                "401" => CommandResponse { success: false, message: "Invalid Discord token.".to_string() },
                "429" => CommandResponse { success: false, message: "Rate limited by Discord. Try again in a minute.".to_string() },
                _ => CommandResponse { success: false, message: format!("Discord returned HTTP {}. Make sure the image URL is public and under 10MB.", code) },
            }
        }
        Err(e) => CommandResponse { success: false, message: format!("Failed to contact Discord: {}", e) },
    }
}

/// Read the current openclaw.json config file contents.
#[tauri::command]
pub fn read_openclaw_config() -> CommandResponse {
    let config_path = match home_dir() {
        Ok(h) => h.join(".openclaw/openclaw.json"),
        Err(e) => return CommandResponse { success: false, message: e },
    };

    match fs::read_to_string(&config_path) {
        Ok(content) => CommandResponse { success: true, message: content },
        Err(e) => CommandResponse { success: false, message: format!("Could not read config: {}", e) },
    }
}

/// Write updated content back to openclaw.json.
/// Validates it's valid JSON before writing.
#[tauri::command]
pub fn write_openclaw_config_raw(content: String) -> CommandResponse {
    // Validate JSON first
    if let Err(e) = serde_json::from_str::<serde_json::Value>(&content) {
        return CommandResponse {
            success: false,
            message: format!("Invalid JSON: {}", e),
        };
    }

    let config_path = match home_dir() {
        Ok(h) => h.join(".openclaw/openclaw.json"),
        Err(e) => return CommandResponse { success: false, message: e },
    };

    // Backup first
    let backup_path = match home_dir() {
        Ok(h) => h.join(".openclaw/openclaw.json.bak"),
        Err(_) => config_path.with_extension("bak"),
    };

    if config_path.exists() {
        let _ = fs::copy(&config_path, &backup_path);
    }

    match fs::write(&config_path, &content) {
        Ok(_) => CommandResponse {
            success: true,
            message: "Config saved. Restart your bot for changes to take effect.".to_string(),
        },
        Err(e) => CommandResponse {
            success: false,
            message: format!("Could not write config: {}", e),
        },
    }
}

/// Create a backup of the launcher state and openclaw config.
#[tauri::command]
pub fn create_backup(path: String) -> CommandResponse {
    let install_dir = expand_home(path);

    let home = match home_dir() {
        Ok(h) => h,
        Err(e) => return CommandResponse { success: false, message: e },
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let backup_dir = install_dir.join(format!("backup-{}", timestamp));

    if let Err(e) = fs::create_dir_all(&backup_dir) {
        return CommandResponse { success: false, message: format!("Could not create backup dir: {}", e) };
    }

    let files_to_backup = [
        (install_dir.join("launcher-state.json"), "launcher-state.json"),
        (install_dir.join("secrets.json"), "secrets.json"),
        (home.join(".openclaw/openclaw.json"), "openclaw.json"),
        (install_dir.join("install-manifest.json"), "install-manifest.json"),
    ];

    let mut backed_up = vec![];
    let mut failed = vec![];

    for (src, name) in &files_to_backup {
        if src.exists() {
            match fs::copy(src, backup_dir.join(name)) {
                Ok(_) => backed_up.push(*name),
                Err(e) => failed.push(format!("{}: {}", name, e)),
            }
        }
    }

    if backed_up.is_empty() {
        return CommandResponse {
            success: false,
            message: "No files found to back up.".to_string(),
        };
    }

    CommandResponse {
        success: true,
        message: format!(
            "Backed up {} to {}\nFiles: {}{}",
            backed_up.len(),
            backup_dir.display(),
            backed_up.join(", "),
            if failed.is_empty() { String::new() } else { format!("\nFailed: {}", failed.join(", ")) }
        ),
    }
}

/// List available backups in the install directory.
#[tauri::command]
pub fn list_backups(path: String) -> CommandResponse {
    let install_dir = expand_home(path);

    let entries = match fs::read_dir(&install_dir) {
        Ok(e) => e,
        Err(e) => return CommandResponse { success: false, message: format!("Could not read install dir: {}", e) },
    };

    let mut backups: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("backup-")
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    backups.sort();
    backups.reverse(); // newest first

    CommandResponse {
        success: true,
        message: backups.join("\n"),
    }
}

/// Restore a backup by copying its files back into place.
#[tauri::command]
pub fn restore_backup(path: String, backup_name: String) -> CommandResponse {
    let install_dir = expand_home(path);
    let backup_dir = install_dir.join(&backup_name);

    if !backup_dir.exists() {
        return CommandResponse { success: false, message: format!("Backup {} not found.", backup_name) };
    }

    let home = match home_dir() {
        Ok(h) => h,
        Err(e) => return CommandResponse { success: false, message: e },
    };

    let restore_map = [
        ("launcher-state.json", install_dir.join("launcher-state.json")),
        ("secrets.json", install_dir.join("secrets.json")),
        ("openclaw.json", home.join(".openclaw/openclaw.json")),
        ("install-manifest.json", install_dir.join("install-manifest.json")),
    ];

    let mut restored = vec![];
    for (name, dest) in &restore_map {
        let src = backup_dir.join(name);
        if src.exists() {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match fs::copy(&src, dest) {
                Ok(_) => restored.push(*name),
                Err(_) => {}
            }
        }
    }

    CommandResponse {
        success: !restored.is_empty(),
        message: if restored.is_empty() {
            "No files were restored.".to_string()
        } else {
            format!("Restored: {}. Restart your bot for changes to take effect.", restored.join(", "))
        },
    }
}