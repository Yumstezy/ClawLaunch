import { load } from "@tauri-apps/plugin-store";
import type { LauncherConfig } from "../types";

const STORE_FILE = "clawlaunch.json";
const CONFIG_KEY = "config";

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

export const defaultSecrets = {
  openaiApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
  xaiApiKey: "",
  mistralApiKey: "",
  openrouterApiKey: "",
  discordBotToken: "",
  telegramBotToken: "",
  whatsappEnabled: false,
  slackBotToken: "",
  signalEnabled: false,
  googlechatWebhook: "",
};

export async function loadConfig(): Promise<LauncherConfig> {
  try {
    const store = await load(STORE_FILE, { defaults: { [CONFIG_KEY]: defaultConfig } });
    const saved = await store.get<LauncherConfig>(CONFIG_KEY);
    if (!saved) return defaultConfig;

    return {
      ...defaultConfig,
      ...saved,
      permissions: {
        ...defaultConfig.permissions,
        ...(saved.permissions || {}),
      },
    };
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: LauncherConfig): Promise<void> {
  try {
    const store = await load(STORE_FILE, { defaults: { [CONFIG_KEY]: defaultConfig } });
    await store.set(CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}