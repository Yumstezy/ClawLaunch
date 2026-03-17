export type ProfileKey = "coding" | "daily" | "gaming" | "tasks" | "mixed";

export type PlatformKey =
  | "discord"
  | "telegram"
  | "whatsapp"
  | "slack"
  | "signal"
  | "googlechat";

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "local"
  | "openrouter";

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
  anthropicApiKey: string;
  googleApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  openrouterApiKey: string;
  discordBotToken: string;
  telegramBotToken: string;
  whatsappEnabled: boolean;
  slackBotToken: string;
  signalEnabled: boolean;
  googlechatWebhook: string;
};