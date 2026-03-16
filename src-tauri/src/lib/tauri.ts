import type { LauncherConfig, LauncherSecrets } from "../types";

export type CommandResponse = {
  success: boolean;
  message: string;
};

async function getInvoke() {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke;
}

export async function checkEnvironment(): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("check_environment");
}

export async function createInstallFolder(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("create_install_folder", { path });
}

export async function writeLauncherConfig(
  config: LauncherConfig
): Promise<CommandResponse> {
  const invoke = await getInvoke();
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
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("write_secrets", {
    path,
    secrets: {
      openai_api_key: secrets.openaiApiKey,
      discord_bot_token: secrets.discordBotToken,
      telegram_bot_token: secrets.telegramBotToken,
    },
  });
}

export async function writeOpenClawConfig(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("write_openclaw_config", { path });
}

export async function installOpenClaw(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("install_openclaw", { path });
}

export async function startOpenClaw(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("start_openclaw", { path });
}

export async function stopOpenClaw(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("stop_openclaw", { path });
}

export async function restartOpenClaw(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("restart_openclaw", { path });
}

export async function readGatewayStatus(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("read_gateway_status", { path });
}

export async function probeChannels(): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("probe_channels");
}

export async function validatePlatformTokens(path: string): Promise<CommandResponse> {
  const invoke = await getInvoke();
  return await invoke<CommandResponse>("validate_platform_tokens", { path });
}