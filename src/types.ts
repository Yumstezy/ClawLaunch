export type ProfileKey = "coding" | "daily" | "gaming" | "tasks" | "mixed";
export type PlatformKey = "discord" | "telegram";
export type ModelProvider = "openai" | "anthropic" | "local";

export type Permissions = {
  files: boolean;
  terminal: boolean;
  browser: boolean;
  automation: boolean;
};

export type LauncherConfig = {
  profile: ProfileKey;
  platforms: PlatformKey[];
  permissions: Permissions;
  installPath: string;
  botStatus: "not_installed" | "installed" | "running" | "stopped";
  botName: string;
  commandPrefix: string;
  modelProvider: ModelProvider;
  botPurpose: string;
};

export type LauncherSecrets = {
  openaiApiKey: string;
  discordBotToken: string;
  telegramBotToken: string;
};