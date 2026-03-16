import type { LauncherConfig } from "../types";

const STORAGE_KEY = "clawlaunch-config";

export const defaultConfig: LauncherConfig = {
  profile: "coding",
  platforms: ["discord"],
  permissions: {
    files: true,
    terminal: true,
    browser: true,
    automation: false,
  },
  installPath: "~/ClawLaunch/bot",
  botStatus: "not_installed",
  botName: "ClawBot",
  commandPrefix: "!",
  modelProvider: "openai",
  botPurpose: "Help me write code, debug problems, and answer technical questions clearly.",
};

export function loadConfig(): LauncherConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig;

  try {
    const parsed = JSON.parse(raw);

    return {
      ...defaultConfig,
      ...parsed,
      permissions: {
        ...defaultConfig.permissions,
        ...(parsed.permissions || {}),
      },
    };
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(config: LauncherConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}