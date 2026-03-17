const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const installPath = process.argv[2] || process.cwd();
const configOnly = process.argv.includes("--config-only");

const installerLogPath = path.join(installPath, "installer.log");
const launcherStatePath = path.join(installPath, "launcher-state.json");
const secretsPath = path.join(installPath, "secrets.json");
const manifestPath = path.join(installPath, "install-manifest.json");

const homeDir = os.homedir();
const openclawDir = path.join(homeDir, ".openclaw");
const openclawBinDir = path.join(openclawDir, "bin");
// On Windows the binary has .exe extension
const openclawBinary = path.join(
  openclawBinDir,
  process.platform === "win32" ? "openclaw.exe" : "openclaw"
);
const openclawConfigPath = path.join(homeDir, ".openclaw", "openclaw.json");

const isWindows = process.platform === "win32";

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(installPath, { recursive: true });
  fs.appendFileSync(installerLogPath, line);
  console.log(message);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveNodeBinary() {
  const candidates = [
    process.execPath,
    isWindows ? null : "/opt/homebrew/bin/node",
    isWindows ? null : "/usr/local/bin/node",
    isWindows ? null : "/usr/bin/node",
    isWindows ? null : "/bin/node",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  throw new Error(
    "Node.js binary could not be found. Please install Node.js and reopen ClawLaunch."
  );
}

const nodeBinary = resolveNodeBinary();

function run(command, options = {}) {
  log(`RUN: ${command}`);
  return execSync(command, {
    stdio: "pipe",
    env: {
      ...process.env,
      PATH: isWindows
        ? `${path.dirname(nodeBinary)};${openclawBinDir};${process.env.PATH || ""}`
        : `${path.dirname(nodeBinary)}:${openclawBinDir}:${process.env.PATH || ""}`,
    },
    // FIX: use cmd.exe on Windows instead of /bin/bash
    shell: isWindows ? true : "/bin/bash",
    ...options,
  });
}

function resolveModel(provider, profile) {
  switch (provider) {
    case "anthropic":
      return "anthropic/claude-sonnet-4-6";
    case "google":
      return "google/gemini-3-pro";
    case "xai":
      return "xai/grok-3";
    case "mistral":
      return "mistral/mistral-large-latest";
    case "openrouter":
      return "openrouter/auto";
    case "local":
      return profile === "coding"
        ? "ollama/qwen2.5-coder:latest"
        : "ollama/qwen2.5:latest";
    default:
      return "openai/gpt-4.1-mini";
  }
}

function buildProfileDefaults(profile) {
  switch (profile) {
    case "coding":
      return { responsePrefix: "[coding]", browserEnabled: true, shellEnabled: true, automationEnabled: false };
    case "daily":
      return { responsePrefix: "[daily]", browserEnabled: true, shellEnabled: false, automationEnabled: false };
    case "gaming":
      return { responsePrefix: "[gaming]", browserEnabled: true, shellEnabled: false, automationEnabled: false };
    case "tasks":
      return { responsePrefix: "[tasks]", browserEnabled: false, shellEnabled: true, automationEnabled: true };
    default:
      return { responsePrefix: "[mixed]", browserEnabled: true, shellEnabled: true, automationEnabled: true };
  }
}


function buildPresetConfig(state, secrets) {
  const profile = state.profile || "mixed";
  const provider = state.model_provider || "openai";
  const platforms = state.platforms || [];
  const permissions = state.permissions || {};
  const botPurpose = state.bot_purpose || "";
  const defaults = buildProfileDefaults(profile);

  const config = {
    gateway: { mode: "local", port: 18789 },
    channels: { defaults: { groupPolicy: "open" } },
    agents: {
      defaults: {
        model: { primary: resolveModel(provider, profile) },
      },
    },
    env: { vars: {} },
    messages: { responsePrefix: defaults.responsePrefix },
  };

  // API keys for all supported providers
  if (provider === "openai" && secrets.openai_api_key)
    config.env.vars.OPENAI_API_KEY = secrets.openai_api_key;
  if (provider === "anthropic" && secrets.anthropic_api_key)
    config.env.vars.ANTHROPIC_API_KEY = secrets.anthropic_api_key;
  if (provider === "google" && secrets.google_api_key)
    config.env.vars.GOOGLE_API_KEY = secrets.google_api_key;
  if (provider === "xai" && secrets.xai_api_key)
    config.env.vars.XAI_API_KEY = secrets.xai_api_key;
  if (provider === "mistral" && secrets.mistral_api_key)
    config.env.vars.MISTRAL_API_KEY = secrets.mistral_api_key;
  if (provider === "openrouter" && secrets.openrouter_api_key)
    config.env.vars.OPENROUTER_API_KEY = secrets.openrouter_api_key;

  if (defaults.browserEnabled || permissions.browser) {
    config.browser = { enabled: true };
  }

  if (defaults.shellEnabled || permissions.terminal) {
    config.env.shellEnv = {
      enabled: true,
      timeoutMs: profile === "tasks" ? 10000 : 15000,
    };
  }

  if (defaults.automationEnabled || permissions.automation) {
    config.automation = { enabled: true };
  }

  if (platforms.includes("discord") && secrets.discord_bot_token) {
    config.channels.discord = {
      enabled: true,
      token: secrets.discord_bot_token,
      dmPolicy: "open",
      allowFrom: ["*"],
      groupPolicy: "open",
    };
  }

  if (platforms.includes("telegram") && secrets.telegram_bot_token) {
    config.channels.telegram = {
      enabled: true,
      token: secrets.telegram_bot_token,
      dmPolicy: "open",
      allowFrom: ["*"],
      groupPolicy: "open",
    };
  }

  if (platforms.includes("slack") && secrets.slack_bot_token) {
    config.channels.slack = {
      enabled: true,
      token: secrets.slack_bot_token,
      dmPolicy: "open",
      groupPolicy: "open",
    };
  }

  if (platforms.includes("googlechat") && secrets.googlechat_webhook) {
    config.channels.googlechat = {
      enabled: true,
      webhook: secrets.googlechat_webhook,
    };
  }

  if (platforms.includes("whatsapp")) {
    config.channels.whatsapp = {
      enabled: true,
      dmPolicy: "open",
      groupPolicy: "open",
    };
  }

  if (platforms.includes("signal")) {
    config.channels.signal = {
      enabled: true,
      dmPolicy: "open",
    };
  }

  return config;
}

try {
  ensureDir(installPath);
  ensureDir(openclawDir);

  if (!fs.existsSync(launcherStatePath)) {
    throw new Error(`launcher-state.json not found at ${launcherStatePath}. Make sure ClawLaunch wrote it before running the installer.`);
  }

  if (!fs.existsSync(secretsPath)) {
    throw new Error(`secrets.json not found at ${secretsPath}. Make sure your tokens were saved before running the installer.`);
  }

  const state = readJson(launcherStatePath);
  const secrets = readJson(secretsPath);

  const config = buildPresetConfig(state, secrets);
  fs.writeFileSync(openclawConfigPath, JSON.stringify(config, null, 2));
  log(`Wrote OpenClaw config to ${openclawConfigPath}`);

  if (configOnly) {
    process.exit(0);
  }

  log("Checking Node...");
  const nodeVersion = run(`"${nodeBinary}" --version`).toString().trim();
  log(`Node detected: ${nodeVersion}`);

  log("Installing OpenClaw...");

  if (isWindows) {
    // Windows install uses PowerShell
    run(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://openclaw.ai/install-cli.ps1 | iex"`
    );
  } else {
    // macOS/Linux install
    run("curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash");
  }

  if (!fs.existsSync(openclawBinary)) {
    throw new Error(
      `Expected OpenClaw binary at ${openclawBinary}, but it was not found after install. ` +
      `Check the installer output above for errors.`
    );
  }

  const versionOut = run(`"${openclawBinary}" --version`).toString().trim();
  log(`OpenClaw CLI verified: ${versionOut}`);

  const manifest = {
    installedAt: new Date().toISOString(),
    runtimeType: "openclaw",
    status: "installed",
    nodeVersion,
    installPath,
    openclawConfigPath,
    openclawBinary,
    profile: state.profile || "mixed",
    provider: state.model_provider || "openai",
    botPurpose: state.bot_purpose || "",
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log("Install manifest written.");
  log("OpenClaw installer completed successfully.");
  process.exit(0);
} catch (error) {
  log(`INSTALL ERROR: ${error.message}`);
  process.exit(1);
}
