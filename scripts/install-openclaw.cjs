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
const openclawBinary = path.join(openclawBinDir, "openclaw");
const openclawConfigPath = path.join(homeDir, ".openclaw", "openclaw.json");

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
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    "/bin/node",
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
      PATH: `${path.dirname(nodeBinary)}:${openclawBinDir}:${process.env.PATH || ""}`,
    },
    shell: "/bin/bash",
    ...options,
  });
}

function resolveModel(provider, profile) {
  if (provider === "anthropic") {
    return "anthropic/claude-sonnet-4-6";
  }

  if (provider === "local") {
    return profile === "coding"
      ? "ollama/qwen2.5-coder:latest"
      : "ollama/qwen2.5:latest";
  }

  return "openai/gpt-4.1-mini";
}

function buildProfileDefaults(profile) {
  switch (profile) {
    case "coding":
      return {
        responsePrefix: "[coding]",
        browserEnabled: true,
        shellEnabled: true,
        automationEnabled: false,
      };
    case "daily":
      return {
        responsePrefix: "[daily]",
        browserEnabled: true,
        shellEnabled: false,
        automationEnabled: false,
      };
    case "gaming":
      return {
        responsePrefix: "[gaming]",
        browserEnabled: true,
        shellEnabled: false,
        automationEnabled: false,
      };
    case "tasks":
      return {
        responsePrefix: "[tasks]",
        browserEnabled: false,
        shellEnabled: true,
        automationEnabled: true,
      };
    default:
      return {
        responsePrefix: "[mixed]",
        browserEnabled: true,
        shellEnabled: true,
        automationEnabled: true,
      };
  }
}

function buildPurposePrompt(profile, purpose) {
  const safePurpose = (purpose || "").trim();

  return [
    `You are running in the ${profile} profile.`,
    safePurpose
      ? `Primary purpose: ${safePurpose}`
      : "Primary purpose: Help the user clearly and effectively.",
    "Stay aligned with the configured purpose.",
    "Be useful, clear, and practical.",
  ].join(" ");
}

function buildPresetConfig(state, secrets) {
  const profile = state.profile || "mixed";
  const provider = state.model_provider || "openai";
  const platforms = state.platforms || [];
  const permissions = state.permissions || {};
  const botPurpose = state.bot_purpose || "";
  const defaults = buildProfileDefaults(profile);

  const config = {
    gateway: {
      mode: "local",
      port: 18789,
    },
    channels: {
      defaults: {
        groupPolicy: "open",
      },
    },
    agents: {
      defaults: {
        model: {
          primary: resolveModel(provider, profile),
        },
        systemPrompt: buildPurposePrompt(profile, botPurpose),
      },
    },
    env: {
      vars: {},
    },
    messages: {
      responsePrefix: defaults.responsePrefix,
    },
  };

  if (provider === "openai" && secrets.openai_api_key) {
    config.env.vars.OPENAI_API_KEY = secrets.openai_api_key;
  }

  if (defaults.browserEnabled || permissions.browser) {
    config.browser = {
      enabled: true,
    };
  }

  if (defaults.shellEnabled || permissions.terminal) {
    config.env.shellEnv = {
      enabled: true,
      timeoutMs: profile === "tasks" ? 10000 : 15000,
    };
  }

  if (defaults.automationEnabled || permissions.automation) {
    config.automation = {
      enabled: true,
    };
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

  return config;
}

try {
  ensureDir(installPath);
  ensureDir(openclawDir);

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

  log("Installing OpenClaw with local-prefix installer...");
  run("curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash");

  if (!fs.existsSync(openclawBinary)) {
    throw new Error(`Expected OpenClaw binary at ${openclawBinary}, but it was not found.`);
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