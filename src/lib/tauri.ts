import { invoke } from "@tauri-apps/api/core";
import type { LauncherConfig, LauncherSecrets } from "../types";

export type CommandResponse = {
  success: boolean;
  message: string;
};

export async function checkEnvironment(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("check_environment");
}

export async function createInstallFolder(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("create_install_folder", { path });
}

export async function writeLauncherConfig(
  config: LauncherConfig
): Promise<CommandResponse> {
  return await invoke<CommandResponse>("write_launcher_config", {
    config: {
      profile: config.profile,
      platforms: config.platforms,
      permissions: config.permissions,
      install_path: config.installPath,
      bot_status: config.botStatus,
      bot_name: config.botName,
      command_prefix: config.commandPrefix,
      model_provider: config.modelProvider,
      bot_purpose: config.botPurpose,
    },
  });
}

export async function writeSecrets(
  path: string,
  secrets: LauncherSecrets
): Promise<CommandResponse> {
  return await invoke<CommandResponse>("write_secrets", {
    path,
    secrets: {
      openai_api_key: secrets.openaiApiKey,
      anthropic_api_key: secrets.anthropicApiKey,
      google_api_key: secrets.googleApiKey,
      xai_api_key: secrets.xaiApiKey,
      mistral_api_key: secrets.mistralApiKey,
      openrouter_api_key: secrets.openrouterApiKey,
      discord_bot_token: secrets.discordBotToken,
      telegram_bot_token: secrets.telegramBotToken,
      slack_bot_token: secrets.slackBotToken,
      googlechat_webhook: secrets.googlechatWebhook,
    },
  });
}

export async function writeOpenClawConfig(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("write_openclaw_config", { path });
}

export async function installOpenClaw(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("install_openclaw", { path });
}

export async function startOpenClaw(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("start_openclaw", { path });
}

export async function stopOpenClaw(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("stop_openclaw", { path });
}

export async function restartOpenClaw(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("restart_openclaw", { path });
}

export async function readGatewayStatus(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("read_gateway_status", { path });
}

export async function probeChannels(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("probe_channels");
}

export async function validatePlatformTokens(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("validate_platform_tokens", { path });
}

export async function pingGateway(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("ping_gateway");
}

export async function readGatewayLog(path: string, lines: number = 60): Promise<CommandResponse> {
  return await invoke<CommandResponse>("read_gateway_log", { path, lines });
}

export async function setAutoStart(enabled: boolean): Promise<CommandResponse> {
  return await invoke<CommandResponse>("set_auto_start", { enabled });
}

export async function getAutoStart(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("get_auto_start");
}

// ── Batch 2 ──────────────────────────────────────────────────
export async function checkForUpdates(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("check_for_updates");
}

export async function runUpdate(): Promise<CommandResponse> {
  return await invoke<CommandResponse>("run_update");
}

export async function readUsageStats(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("read_usage_stats", { path });
}

export async function watchdogCheck(path: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("watchdog_check", { path });
}

export async function validateOpenAIKeyLive(key: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("validate_openai_key_live", { key });
}

export async function validateDiscordTokenLive(token: string): Promise<CommandResponse> {
  return await invoke<CommandResponse>("validate_discord_token_live", { token });
}