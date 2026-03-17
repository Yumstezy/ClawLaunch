import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import type {
  LauncherConfig,
  LauncherSecrets,
  PlatformKey,
  ProfileKey,
} from "./types";
import { profiles } from "./lib/profiles";
import { defaultConfig, loadConfig, saveConfig } from "./lib/storage";
import {
  checkEnvironment,
  createInstallFolder,
  writeLauncherConfig,
  writeSecrets,
  writeOpenClawConfig,
  installOpenClaw,
  startOpenClaw,
  stopOpenClaw,
  restartOpenClaw,
  readGatewayStatus,
  probeChannels,
  validatePlatformTokens,
  pingGateway,
  readGatewayLog,
  setAutoStart,
  getAutoStart,
  checkForUpdates,
  runUpdate,
  readUsageStats,
  watchdogCheck,
  validateOpenAIKeyLive,
  validateDiscordTokenLive,
  // batch 3
  sendNotification,
  setDiscordAvatar,
  readOpenClawConfig,
  writeOpenClawConfigRaw,
  createBackup,
  listBackups,
  restoreBackup,
} from "./lib/tauri";
import "./App.css";

type Screen = "welcome" | "configure" | "connect" | "install" | "done";
type InstallStepStatus = "idle" | "active" | "done" | "error";
type ValidationState = "idle" | "checking" | "valid" | "invalid" | "rate-limited";

// ── Saved profile type for multiple profiles feature ─────────
type SavedProfile = {
  id: string;
  name: string;
  config: LauncherConfig;
  secrets: LauncherSecrets;
  createdAt: string;
};

const defaultSecrets: LauncherSecrets = {
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

const stepOrder: Screen[] = ["welcome", "configure", "connect", "install", "done"];

function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [config, setConfig] = useState<LauncherConfig>(defaultConfig);
  const [secrets, setSecrets] = useState<LauncherSecrets>(defaultSecrets);

  const [gatewayHealth, setGatewayHealth] = useState("unknown");
  const [channelHealth, setChannelHealth] = useState("unknown");
  const [connectionCheck, setConnectionCheck] = useState("Not checked yet.");

  const [isInstalling, setIsInstalling] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isCheckingTokens, setIsCheckingTokens] = useState(false);

  const [formError, setFormError] = useState("");
  const [installError, setInstallError] = useState("");

  // ── Batch 1 ──────────────────────────────────────────────────
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [autoStart, setAutoStartState] = useState(false);

  // ── Batch 2: Update checker ───────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<"unknown" | "up-to-date" | "available">("unknown");
  const [updateInfo, setUpdateInfo] = useState({ installed: "", latest: "" });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  // ── Batch 2: Usage stats ─────────────────────────────────────
  const [usageStats, setUsageStats] = useState<{
    messages: number;
    restarts: number;
    firstSeen: string;
    lastActivity: string;
  } | null>(null);

  // ── Batch 2: Crash recovery ───────────────────────────────────
  const [crashCount, setCrashCount] = useState(0);
  const [lastCrashTime, setLastCrashTime] = useState<string | null>(null);

  // ── Batch 2: Live API validation ──────────────────────────────
  const [openaiValidation, setOpenaiValidation] = useState<ValidationState>("idle");
  const [discordValidation, setDiscordValidation] = useState<ValidationState>("idle");
  const openaiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discordDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Batch 2: Multiple profiles ────────────────────────────────
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  // ── Reset / start over ────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ── Batch 3: Onboarding checklist ────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState<Record<string, boolean>>({});

  // ── Batch 3: Config editor ────────────────────────────────────
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [configEditorContent, setConfigEditorContent] = useState("");
  const [configEditorError, setConfigEditorError] = useState("");
  const [configEditorSaving, setConfigEditorSaving] = useState(false);

  // ── Batch 3: Avatar ───────────────────────────────────────────
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarStatus, setAvatarStatus] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);

  // ── Batch 3: Backup/restore ───────────────────────────────────
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupList, setBackupList] = useState<string[]>([]);
  const [backupStatus, setBackupStatus] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

  const [installSteps, setInstallSteps] = useState([
    { label: "Checking environment", status: "idle" as InstallStepStatus },
    { label: "Creating install folder", status: "idle" as InstallStepStatus },
    { label: "Writing launcher config", status: "idle" as InstallStepStatus },
    { label: "Saving secrets", status: "idle" as InstallStepStatus },
    { label: "Building OpenClaw config", status: "idle" as InstallStepStatus },
    { label: "Installing OpenClaw", status: "idle" as InstallStepStatus },
    { label: "Starting gateway", status: "idle" as InstallStepStatus },
    { label: "Checking channel connection", status: "idle" as InstallStepStatus },
  ]);

  const [installMessages, setInstallMessages] = useState<string[]>([]);

  const selectedProfile = useMemo(() => profiles[config.profile], [config.profile]);
  const currentStepIndex = stepOrder.indexOf(screen);
  const totalSteps = 5;

  const gatewaySummary = useMemo(() => ({
    port: "18789",
    dashboardUrl: "http://127.0.0.1:18789",
  }), []);

  // ── Load config on mount ─────────────────────────────────────
  useEffect(() => {
    loadConfig().then((saved) => {
      setConfig(saved);
      if (saved.botStatus !== "not_installed") setScreen("done");
    }).catch(console.error);
    getAutoStart().then((r) => setAutoStartState(r.success)).catch(() => {});

    // Load saved profiles from localStorage
    try {
      const raw = localStorage.getItem("clawlaunch-profiles");
      if (raw) setSavedProfiles(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    saveConfig(config).catch(console.error);
  }, [config]);

  // ── Auto-refresh gateway status every 30s ────────────────────
  useEffect(() => {
    if (screen !== "done") return;
    let prevHealth = "unknown";
    const tick = async () => {
      try {
        const ping = await pingGateway();
        const health = ping.success ? "running" : "stopped";
        // Notify if gateway just stopped unexpectedly
        if (prevHealth === "running" && health === "stopped") {
          sendNotification("ClawLaunch", `${config.botName} gateway stopped unexpectedly.`).catch(() => {});
        }
        prevHealth = health;
        setGatewayHealth(health);
      } catch {
        setGatewayHealth("stopped");
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [screen]);

  // ── Batch 2: Crash watchdog every 60s ────────────────────────
  useEffect(() => {
    if (screen !== "done") return;
    if (config.botStatus !== "running") return;

    const id = setInterval(async () => {
      try {
        const result = await watchdogCheck(config.installPath);
        if (result.message === "restarted") {
          setCrashCount((c) => c + 1);
          setLastCrashTime(new Date().toLocaleTimeString());
          setGatewayHealth("running");
          sendNotification("ClawLaunch", `${config.botName} crashed and was automatically restarted.`).catch(() => {});
        } else if (result.message.startsWith("restart-failed")) {
          sendNotification("ClawLaunch", `${config.botName} stopped and could not restart. Open ClawLaunch to fix it.`).catch(() => {});
        }
      } catch {}
    }, 60_000);

    return () => clearInterval(id);
  }, [screen, config.botStatus, config.installPath]);

  // ── Batch 2: Check for updates on done screen ─────────────────
  useEffect(() => {
    if (screen !== "done") return;
    checkForUpdates().then((result) => {
      if (!result.success) return;
      const parts = result.message.split("::");
      if (parts[0] === "update-available") {
        setUpdateStatus("available");
        setUpdateInfo({ installed: parts[1] || "", latest: parts[2] || "" });
        sendNotification("ClawLaunch", `OpenClaw update available: ${parts[1]} → ${parts[2]}`).catch(() => {});
      } else {
        setUpdateStatus("up-to-date");
        setUpdateInfo({ installed: parts[1] || "", latest: "" });
      }
    }).catch(() => {});
  }, [screen]);

  // ── Batch 2: Load usage stats on done screen ─────────────────
  useEffect(() => {
    if (screen !== "done") return;
    readUsageStats(config.installPath).then((result) => {
      if (result.success) {
        try {
          setUsageStats(JSON.parse(result.message));
        } catch {}
      }
    }).catch(() => {});
  }, [screen, config.installPath]);

  // ── Live log polling ─────────────────────────────────────────
  useEffect(() => {
    if (!showLogs || screen !== "done") return;
    const fetchLogs = async () => {
      try {
        const result = await readGatewayLog(config.installPath, 80);
        if (result.success && result.message)
          setLogLines(result.message.split("\n").filter(Boolean));
      } catch {}
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 5_000);
    return () => clearInterval(id);
  }, [showLogs, screen, config.installPath]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [logLines]);

  // ── Batch 2: Debounced live OpenAI key validation ─────────────
  const handleOpenAIKeyChange = useCallback((val: string) => {
    setSecrets((prev) => ({ ...prev, openaiApiKey: val }));
    setOpenaiValidation("idle");
    if (openaiDebounceRef.current) clearTimeout(openaiDebounceRef.current);
    if (!val.trim()) return;
    openaiDebounceRef.current = setTimeout(async () => {
      setOpenaiValidation("checking");
      try {
        const r = await validateOpenAIKeyLive(val.trim());
        setOpenaiValidation(r.message as ValidationState);
      } catch {
        setOpenaiValidation("idle");
      }
    }, 900);
  }, []);

  // ── Batch 2: Debounced live Discord token validation ──────────
  const handleDiscordTokenChange = useCallback((val: string) => {
    setSecrets((prev) => ({ ...prev, discordBotToken: val }));
    setDiscordValidation("idle");
    if (discordDebounceRef.current) clearTimeout(discordDebounceRef.current);
    if (!val.trim()) return;
    discordDebounceRef.current = setTimeout(async () => {
      setDiscordValidation("checking");
      try {
        const r = await validateDiscordTokenLive(val.trim());
        setDiscordValidation(r.message as ValidationState);
      } catch {
        setDiscordValidation("idle");
      }
    }, 900);
  }, []);

  function validationBadge(state: ValidationState) {
    if (state === "idle") return null;
    if (state === "checking") return <span className="badge badge-checking">Checking…</span>;
    if (state === "valid") return <span className="badge badge-valid">✓ Valid</span>;
    if (state === "rate-limited") return <span className="badge badge-valid">✓ Looks valid</span>;
    if (state === "invalid") return <span className="badge badge-invalid">✗ Invalid</span>;
    return <span className="badge badge-invalid">✗ Error</span>;
  }

  // ── Batch 2: Save / load / delete profiles ────────────────────
  function saveCurrentProfile() {
    if (!newProfileName.trim()) return;
    const profile: SavedProfile = {
      id: Date.now().toString(),
      name: newProfileName.trim(),
      config: { ...config },
      secrets: { ...secrets },
      createdAt: new Date().toLocaleString(),
    };
    const updated = [...savedProfiles, profile];
    setSavedProfiles(updated);
    localStorage.setItem("clawlaunch-profiles", JSON.stringify(updated));
    setNewProfileName("");
  }

  function loadSavedProfile(profile: SavedProfile) {
    setConfig(profile.config);
    setSecrets(profile.secrets);
    setShowProfileManager(false);
    setScreen("configure");
  }

  function deleteSavedProfile(id: string) {
    const updated = savedProfiles.filter((p) => p.id !== id);
    setSavedProfiles(updated);
    localStorage.setItem("clawlaunch-profiles", JSON.stringify(updated));
  }

  async function handleRunUpdate() {
    setIsUpdating(true);
    setUpdateMessage("Updating OpenClaw...");
    try {
      const result = await runUpdate();
      setUpdateMessage(result.success ? "Updated successfully! Restart your bot." : result.message);
      if (result.success) setUpdateStatus("up-to-date");
    } catch {
      setUpdateMessage("Update failed. Try again.");
    } finally {
      setIsUpdating(false);
    }
  }

  function pushInstallMessage(message: string) {
    setInstallMessages((prev) => [message, ...prev].slice(0, 30));
  }

  function setStepStatus(index: number, status: InstallStepStatus) {
    setInstallSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, status } : step))
    );
  }

  function resetInstallSteps() {
    setInstallSteps((prev) => prev.map((step) => ({ ...step, status: "idle" as InstallStepStatus })));
    setInstallMessages([]);
    setInstallError("");
  }

  function validateConfigureStep(): string {
    if (!config.botName.trim()) return "Please enter a bot name.";
    if (!config.botPurpose.trim()) return "Please describe what you want your bot to do.";
    if (!config.modelProvider.trim()) return "Please choose an AI provider.";
    return "";
  }

  function validateConnectStep(): string {
    if (!config.platforms.length) return "Please choose at least one text platform.";
    if (config.modelProvider === "openai" && !secrets.openaiApiKey.trim())
      return "Please enter your OpenAI API key.";
    if (config.platforms.includes("discord") && !secrets.discordBotToken.trim())
      return "Discord is selected, so you need to paste a Discord bot token.";
    if (config.platforms.includes("telegram") && !secrets.telegramBotToken.trim())
      return "Telegram is selected, so you need to paste a Telegram bot token.";
    if (!config.installPath.trim()) return "Please choose an install path.";
    return "";
  }

  function goNext() {
    setFormError("");
    if (screen === "welcome") { setScreen("configure"); return; }
    if (screen === "configure") {
      const error = validateConfigureStep();
      if (error) { setFormError(error); return; }
      setScreen("connect");
      return;
    }
    if (screen === "connect") {
      const error = validateConnectStep();
      if (error) { setFormError(error); return; }
      setScreen("install");
      return;
    }
    if (screen === "install") setScreen("done");
  }

  function goBack() {
    setFormError("");
    if (screen === "configure") setScreen("welcome");
    else if (screen === "connect") setScreen("configure");
    else if (screen === "install") setScreen("connect");
    else if (screen === "done") setScreen("install");
  }

  const examplePrompts = useMemo(() => {
    const p = config.botPurpose.toLowerCase();
    if (p.includes("code") || p.includes("debug"))
      return ["Explain this error and how to fix it", "Help me write a function for this task", "Review this code and suggest improvements"];
    if (p.includes("research") || p.includes("study"))
      return ["Summarize this topic in simple terms", "Compare these two ideas for me", "Help me research this question step by step"];
    if (p.includes("crypto") || p.includes("trade"))
      return ["Summarize the latest market sentiment", "Explain this token in simple terms", "List risks I should watch for today"];
    if (p.includes("discord") || p.includes("community"))
      return ["Answer this user question clearly", "Write a short announcement for my server", "Summarize what this channel has been discussing"];
    return ["Help me with this task", "Explain this clearly", "Give me the next best step"];
  }, [config.botPurpose]);

  function updateProfile(profile: ProfileKey) {
    setConfig((prev) => ({ ...prev, profile, permissions: profiles[profile].permissions }));
  }

  function togglePlatform(platform: PlatformKey) {
    setConfig((prev) => {
      const exists = prev.platforms.includes(platform);
      const next = exists ? prev.platforms.filter((p) => p !== platform) : [...prev.platforms, platform];
      return { ...prev, platforms: next.length ? next : [platform] };
    });
  }

  async function refreshGatewayHealth() {
    try {
      const result = await readGatewayStatus(config.installPath);
      setGatewayHealth(result.success ? "running" : "stopped");
    } catch {
      setGatewayHealth("unknown");
    }
  }

  async function refreshChannelHealth() {
    try {
      const result = await probeChannels();
      const text = result.message.toLowerCase();
      if (result.success && (text.includes("discord") || text.includes("telegram") || text.includes("connected") || text.includes("ok")))
        setChannelHealth("connected");
      else if (text.includes("error") || text.includes("failed") || text.includes("degraded"))
        setChannelHealth("degraded");
      else setChannelHealth("unknown");
    } catch {
      setChannelHealth("unknown");
    }
  }

  async function runTokenCheck() {
    const error = validateConnectStep();
    if (error) { setFormError(error); return; }
    try {
      setIsCheckingTokens(true);
      setFormError("");
      const configResult = await writeLauncherConfig({ ...config, botStatus: config.botStatus });
      if (!configResult.success) { setConnectionCheck("Could not prepare launcher config for validation."); return; }
      const secretsResult = await writeSecrets(config.installPath, secrets);
      if (!secretsResult.success) { setConnectionCheck("Could not save tokens for validation."); return; }
      const result = await validatePlatformTokens(config.installPath);
      setConnectionCheck(result.message);
    } catch {
      setConnectionCheck("Token validation failed.");
    } finally {
      setIsCheckingTokens(false);
    }
  }

  async function runInstall() {
    const blockingError = validateConfigureStep() || validateConnectStep();
    if (blockingError) { setInstallError(blockingError); return; }
    try {
      setIsInstalling(true);
      resetInstallSteps();

      setStepStatus(0, "active");
      const envResult = await checkEnvironment();
      pushInstallMessage(envResult.message);
      if (!envResult.success) { setStepStatus(0, "error"); setInstallError("Environment check failed. Install Node.js first."); return; }
      setStepStatus(0, "done");

      setStepStatus(1, "active");
      const folderResult = await createInstallFolder(config.installPath);
      pushInstallMessage(folderResult.message);
      if (!folderResult.success) { setStepStatus(1, "error"); setInstallError("Could not create the install folder."); return; }
      setStepStatus(1, "done");

      setStepStatus(2, "active");
      const configResult = await writeLauncherConfig({ ...config, botStatus: "installed" });
      pushInstallMessage(configResult.message);
      if (!configResult.success) { setStepStatus(2, "error"); setInstallError("Could not write the launcher config."); return; }
      setStepStatus(2, "done");

      setStepStatus(3, "active");
      const secretsResult = await writeSecrets(config.installPath, secrets);
      pushInstallMessage(secretsResult.message);
      if (!secretsResult.success) { setStepStatus(3, "error"); setInstallError("Could not save your keys and tokens."); return; }
      setStepStatus(3, "done");

      setStepStatus(4, "active");
      const openclawConfigResult = await writeOpenClawConfig(config.installPath);
      pushInstallMessage(openclawConfigResult.message);
      if (!openclawConfigResult.success) { setStepStatus(4, "error"); setInstallError("Could not build the OpenClaw config."); return; }
      setStepStatus(4, "done");

      setStepStatus(5, "active");
      const installResult = await installOpenClaw(config.installPath);
      pushInstallMessage(installResult.message);
      if (!installResult.success) { setStepStatus(5, "error"); setInstallError(installResult.message || "OpenClaw installation failed."); return; }
      setStepStatus(5, "done");

      setStepStatus(6, "active");
      const startResult = await startOpenClaw(config.installPath);
      pushInstallMessage(startResult.message);
      if (!startResult.success) { setStepStatus(6, "error"); setInstallError("OpenClaw installed, but the gateway could not start."); return; }
      setStepStatus(6, "done");

      setStepStatus(7, "active");
      await refreshGatewayHealth();
      await refreshChannelHealth();
      setStepStatus(7, "done");

      setConfig((prev) => ({ ...prev, botStatus: "running" }));
      setScreen("done");
      // Show onboarding checklist automatically after fresh install
      setShowOnboarding(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown install error.";
      setInstallError(message);
      pushInstallMessage(`Install failed: ${message}`);
    } finally {
      setIsInstalling(false);
    }
  }

  async function stopBot() {
    try {
      setIsBusy(true);
      const result = await stopOpenClaw(config.installPath);
      pushInstallMessage(result.message);
      if (result.success) { setConfig((prev) => ({ ...prev, botStatus: "stopped" })); setGatewayHealth("stopped"); }
    } finally { setIsBusy(false); }
  }

  async function restartBot() {
    try {
      setIsBusy(true);
      const result = await restartOpenClaw(config.installPath);
      pushInstallMessage(result.message);
      if (result.success) {
        setConfig((prev) => ({ ...prev, botStatus: "running" }));
        await refreshGatewayHealth();
        await refreshChannelHealth();
      }
    } finally { setIsBusy(false); }
  }

  async function openConfigEditor() {
    try {
      const result = await readOpenClawConfig();
      if (result.success) {
        setConfigEditorContent(result.message);
        setConfigEditorError("");
        setShowConfigEditor(true);
      } else {
        setConfigEditorError(result.message);
        setShowConfigEditor(true);
      }
    } catch (e) {
      setConfigEditorError("Could not read config file.");
      setShowConfigEditor(true);
    }
  }

  async function saveConfigEditor() {
    setConfigEditorSaving(true);
    setConfigEditorError("");
    try {
      const result = await writeOpenClawConfigRaw(configEditorContent);
      if (result.success) {
        setShowConfigEditor(false);
      } else {
        setConfigEditorError(result.message);
      }
    } catch {
      setConfigEditorError("Failed to save config.");
    } finally {
      setConfigEditorSaving(false);
    }
  }

  async function handleSetAvatar() {
    if (!avatarUrl.trim()) return;
    setAvatarSaving(true);
    setAvatarStatus("");
    try {
      const result = await setDiscordAvatar(config.installPath, avatarUrl.trim());
      setAvatarStatus(result.message);
    } catch {
      setAvatarStatus("Failed to update avatar.");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function openBackupModal() {
    setShowBackupModal(true);
    setBackupStatus("");
    try {
      const result = await listBackups(config.installPath);
      if (result.success && result.message) {
        setBackupList(result.message.split("
").filter(Boolean));
      } else {
        setBackupList([]);
      }
    } catch {
      setBackupList([]);
    }
  }

  async function handleCreateBackup() {
    setBackupBusy(true);
    try {
      const result = await createBackup(config.installPath);
      setBackupStatus(result.message);
      // Refresh list
      const list = await listBackups(config.installPath);
      if (list.success && list.message) setBackupList(list.message.split("
").filter(Boolean));
    } catch {
      setBackupStatus("Backup failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup(name: string) {
    setBackupBusy(true);
    try {
      const result = await restoreBackup(config.installPath, name);
      setBackupStatus(result.message);
    } catch {
      setBackupStatus("Restore failed.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function toggleAutoStart() {
    const next = !autoStart;
    const result = await setAutoStart(next);
    if (result.success) setAutoStartState(next);
  }

  function openExternal(url: string) {
    openShell(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  }

  const doneStatusText =
    gatewayHealth === "running" && channelHealth === "connected"
      ? "Your bot is installed and connected."
      : gatewayHealth === "running"
      ? "Gateway is running but channel connection may need attention."
      : "OpenClaw is installed but may need one more fix.";

  return (
    <div className="app-shell wizard-shell">
      <main className="main wizard-main">

        {/* ── Topbar ── */}
        <div className="wizard-topbar">
          <div>
            <div className="brand">ClawLaunch</div>
            <div className="subbrand">Easy ClawBot setup</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Batch 2: Profile manager button */}
            {savedProfiles.length > 0 && (
              <button className="secondary" style={{ padding: "8px 14px", fontSize: 13 }}
                onClick={() => setShowProfileManager(true)}>
                Profiles ({savedProfiles.length})
              </button>
            )}
            <div className="wizard-progress">Step {currentStepIndex + 1} of {totalSteps}</div>
          </div>
        </div>

        {/* ── Batch 2: Update banner ── */}
        {updateStatus === "available" && (
          <div className="update-banner">
            <span>🦞 OpenClaw update available — {updateInfo.installed} → {updateInfo.latest}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {updateMessage && <span style={{ fontSize: 13, color: "#86efac" }}>{updateMessage}</span>}
              <button onClick={handleRunUpdate} disabled={isUpdating} style={{ padding: "8px 16px", fontSize: 13 }}>
                {isUpdating ? "Updating…" : "Update now"}
              </button>
            </div>
          </div>
        )}

        {/* ── Batch 2: Profile manager modal ── */}
        {showProfileManager && (
          <div className="modal-overlay" onClick={() => setShowProfileManager(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <h2>Saved profiles</h2>
              <p style={{ color: "#9fb1d3", fontSize: 14 }}>Switch between different bot setups without going through the full wizard again.</p>
              {savedProfiles.length === 0 && (
                <div className="summary-box" style={{ color: "#64748b" }}>No saved profiles yet. Save your current setup below.</div>
              )}
              {savedProfiles.map((p) => (
                <div key={p.id} className="profile-row">
                  <div>
                    <strong>{p.name}</strong>
                    <span className="helper-text" style={{ margin: 0, display: "block" }}>
                      {p.config.botName} · {p.config.profile} · {p.createdAt}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => loadSavedProfile(p)}>Load</button>
                    <button className="secondary" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => deleteSavedProfile(p.id)}>Delete</button>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
                <input className="text-input" placeholder="Profile name…" value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  style={{ flex: 1 }} />
                <button onClick={saveCurrentProfile} disabled={!newProfileName.trim()}>Save current</button>
              </div>
              <div className="wizard-actions" style={{ marginTop: 12 }}>
                <button className="secondary" onClick={() => setShowProfileManager(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Batch 3: Onboarding checklist modal ── */}
        {showOnboarding && (
          <div className="modal-overlay" onClick={() => setShowOnboarding(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="onboarding-header">
                <span className="eyebrow" style={{ marginBottom: 0 }}>🎉 You're live</span>
                <button className="secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setShowOnboarding(false)}>Skip</button>
              </div>
              <h2 style={{ marginTop: 14 }}>3 things to do right now</h2>
              <p style={{ marginBottom: 20 }}>Complete these to start using your bot.</p>

              <div className="onboarding-steps">
                {[
                  {
                    id: "invite",
                    emoji: "🔗",
                    title: "Invite your bot to a Discord server",
                    desc: "Go to Discord Developer Portal → your app → OAuth2 → URL Generator. Select bot + applications.commands scopes, then use the invite link.",
                    action: () => openExternal("https://discord.com/developers/applications"),
                    actionLabel: "Open Developer Portal",
                  },
                  {
                    id: "message",
                    emoji: "💬",
                    title: `Send your first message to @${config.botName}`,
                    desc: `In any channel, type @${config.botName} followed by a question or task. Your bot will reply with an AI response.`,
                    action: null,
                    actionLabel: "",
                  },
                  {
                    id: "autostart",
                    emoji: "🔁",
                    title: "Turn on Start on login",
                    desc: "So your bot keeps running after a reboot without you having to open ClawLaunch manually.",
                    action: toggleAutoStart,
                    actionLabel: autoStart ? "✓ Already on" : "Turn on now",
                  },
                ].map((step) => (
                  <div key={step.id} className={`onboarding-step ${onboardingChecked[step.id] ? "onboarding-done" : ""}`}
                    onClick={() => setOnboardingChecked((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}>
                    <div className="onboarding-check">{onboardingChecked[step.id] ? "✓" : ""}</div>
                    <div style={{ flex: 1 }}>
                      <div className="onboarding-step-title">{step.emoji} {step.title}</div>
                      <div className="onboarding-step-desc">{step.desc}</div>
                      {step.action && !onboardingChecked[step.id] && (
                        <button style={{ marginTop: 10, fontSize: 12, padding: "7px 14px" }}
                          onClick={(e) => { e.stopPropagation(); step.action!(); }}>
                          {step.actionLabel}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="wizard-actions" style={{ marginTop: 20 }}>
                <button onClick={() => setShowOnboarding(false)}>
                  {Object.values(onboardingChecked).filter(Boolean).length === 3 ? "All done! 🎉" : "Got it"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Batch 3: Config editor modal ── */}
        {showConfigEditor && (
          <div className="modal-overlay" onClick={() => setShowConfigEditor(false)}>
            <div className="modal-panel config-editor-panel" onClick={(e) => e.stopPropagation()}>
              <h2>Edit openclaw.json</h2>
              <p style={{ marginBottom: 12, fontSize: 13 }}>
                This is your bot's full config file at <code>~/.openclaw/openclaw.json</code>.
                Edit carefully — a backup is created automatically before saving.
              </p>
              {configEditorError && (
                <div className="install-error-box" style={{ marginBottom: 12 }}>{configEditorError}</div>
              )}
              <textarea
                className="text-input config-editor-textarea"
                value={configEditorContent}
                onChange={(e) => setConfigEditorContent(e.target.value)}
                spellCheck={false}
              />
              <div className="wizard-actions" style={{ marginTop: 12 }}>
                <button onClick={saveConfigEditor} disabled={configEditorSaving}>
                  {configEditorSaving ? "Saving..." : "Save & close"}
                </button>
                <button className="secondary" onClick={() => setShowConfigEditor(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Batch 3: Avatar modal ── */}
        {showAvatarModal && (
          <div className="modal-overlay" onClick={() => setShowAvatarModal(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <h2>Set bot avatar</h2>
              <p style={{ marginBottom: 16, fontSize: 13 }}>
                Paste a public image URL (.png or .jpg). It will be uploaded as your Discord bot's profile picture.
                Images must be under 10MB and publicly accessible.
              </p>
              <label>Image URL
                <input className="text-input" value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.png" />
              </label>
              {avatarStatus && (
                <div className={`install-${avatarStatus.includes("success") ? "checklist" : "error-box"}`}
                  style={{ marginTop: 12, padding: "10px 14px", borderRadius: "var(--radius-md)",
                    background: avatarStatus.includes("success") ? "var(--cyan-dim)" : "var(--red-dim)",
                    border: `1px solid ${avatarStatus.includes("success") ? "var(--border-lit)" : "rgba(255,77,109,0.25)"}`,
                    color: avatarStatus.includes("success") ? "var(--cyan)" : "#ffb3be",
                    fontSize: 13 }}>
                  {avatarStatus}
                </div>
              )}
              <div className="wizard-actions" style={{ marginTop: 16 }}>
                <button onClick={handleSetAvatar} disabled={avatarSaving || !avatarUrl.trim()}>
                  {avatarSaving ? "Uploading..." : "Set avatar"}
                </button>
                <button className="secondary" onClick={() => setShowAvatarModal(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Batch 3: Backup modal ── */}
        {showBackupModal && (
          <div className="modal-overlay" onClick={() => setShowBackupModal(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <h2>Backup & restore</h2>
              <p style={{ marginBottom: 16, fontSize: 13 }}>
                Backups save your launcher config, tokens, and openclaw.json so you can restore them if something goes wrong.
              </p>

              <button onClick={handleCreateBackup} disabled={backupBusy}>
                {backupBusy ? "Working..." : "Create backup now"}
              </button>

              {backupStatus && (
                <div className="summary-box" style={{ marginTop: 14, fontSize: 13 }}>{backupStatus}</div>
              )}

              {backupList.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h2 style={{ fontSize: 15, marginBottom: 10 }}>Saved backups</h2>
                  <div style={{ display: "grid", gap: 8 }}>
                    {backupList.map((name) => (
                      <div key={name} className="profile-row">
                        <span style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "monospace" }}>{name}</span>
                        <button className="secondary" style={{ fontSize: 12, padding: "6px 12px" }}
                          disabled={backupBusy}
                          onClick={() => handleRestoreBackup(name)}>
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {backupList.length === 0 && !backupBusy && (
                <p style={{ marginTop: 14, fontSize: 13 }}>No backups yet. Create one above.</p>
              )}

              <div className="wizard-actions" style={{ marginTop: 16 }}>
                <button className="secondary" onClick={() => setShowBackupModal(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reset confirmation modal ── */}
        {showResetConfirm && (
          <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <h2>Set up a new bot</h2>
              <p style={{ marginBottom: 8 }}>This will take you back to the beginning of setup so you can configure a different bot, platform, or AI provider.</p>
              <p style={{ marginBottom: 20, color: "var(--text-muted)", fontSize: 13 }}>
                Your current bot will keep running in the background until you stop it or install a new one. Your saved profiles are kept.
              </p>
              <div className="wizard-actions" style={{ marginTop: 0 }}>
                <button onClick={() => {
                  setConfig({ ...defaultConfig, botStatus: "not_installed" });
                  setSecrets(defaultSecrets);
                  setScreen("welcome");
                  setGatewayHealth("unknown");
                  setChannelHealth("unknown");
                  setConnectionCheck("Not checked yet.");
                  setInstallError("");
                  setFormError("");
                  setShowResetConfirm(false);
                }}>
                  Start fresh setup
                </button>
                <button className="secondary" onClick={() => setShowResetConfirm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {screen !== "done" && (
          <div className="wizard-steps">
            {["Welcome", "Configure", "Connect", "Install", "Done"].map((label, index) => (
              <div key={label} className={`wizard-step-pill ${index < currentStepIndex ? "done" : index === currentStepIndex ? "active" : ""}`}>
                {label}
              </div>
            ))}
          </div>
        )}

        {/* ── Welcome ── */}
        {screen === "welcome" && (
          <section className="panel hero-panel">
            <span className="eyebrow">Simple OpenClaw installer</span>
            <h1>Launch Your Own AI Bot in Minutes</h1>
            <p style={{ fontSize: 16, marginBottom: 28 }}>
              ClawLaunch sets up OpenClaw on your computer automatically — no terminal, no config files.
              Just click Install and your bot is live on Discord or Telegram.
            </p>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🖥️</div>
                <strong>Runs on Your Machine</strong>
                <span>Mac, Windows, or Linux. Private by default — your data stays yours.</span>
              </div>
              <div className="feature-card">
                <div className="feature-icon">💬</div>
                <strong>Any Chat App</strong>
                <span>Talk to it on Discord or Telegram. Works in DMs and group chats.</span>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🧠</div>
                <strong>Persistent Memory</strong>
                <span>Remembers context across conversations. Becomes uniquely yours.</span>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🌐</div>
                <strong>Browser Control</strong>
                <span>Browse the web, fill forms, and extract data from any site.</span>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <strong>Full System Access</strong>
                <span>Read and write files, run shell commands, execute scripts.</span>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🧩</div>
                <strong>Skills & Plugins</strong>
                <span>Extend with community skills or build your own.</span>
              </div>
            </div>

            <div className="wizard-actions">
              <button onClick={goNext}>Start setup — it's free</button>
              {savedProfiles.length > 0 && (
                <button className="secondary" onClick={() => setShowProfileManager(true)}>Load a saved profile</button>
              )}
            </div>
          </section>
        )}

        {/* ── Configure ── */}
        {screen === "configure" && (
          <section className="setup-grid">
            <div className="panel">
              <h2>1. Pick a starting profile</h2>
              <div className="card-grid">
                {(Object.keys(profiles) as ProfileKey[]).map((key) => (
                  <button key={key} className={`card-button ${config.profile === key ? "selected" : ""}`} onClick={() => updateProfile(key)}>
                    <strong>{profiles[key].name}</strong>
                    <span>{profiles[key].description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2>2. Bot basics</h2>
              <div className="toggle-column">
                <label>Bot name
                  <input className="text-input" value={config.botName}
                    onChange={(e) => setConfig((prev) => ({ ...prev, botName: e.target.value }))} />
                </label>
                <label>AI provider
                  <select className="text-input" value={config.modelProvider}
                    onChange={(e) => setConfig((prev) => ({ ...prev, modelProvider: e.target.value as LauncherConfig["modelProvider"] }))}>
                    <optgroup label="Cloud">
                      <option value="openai">OpenAI (GPT-4.1, o3)</option>
                      <option value="anthropic">Anthropic (Claude Sonnet 4)</option>
                      <option value="google">Google (Gemini 3 Pro)</option>
                      <option value="xai">xAI (Grok)</option>
                      <option value="mistral">Mistral</option>
                    </optgroup>
                    <optgroup label="Local / Self-hosted">
                      <option value="local">Local (Ollama)</option>
                      <option value="openrouter">OpenRouter (multi-model)</option>
                    </optgroup>
                  </select>
                </label>
              </div>
            </div>

            <div className="panel full-width">
              <h2>3. What should your bot help with?</h2>
              <label>Bot purpose
                <textarea className="text-input" rows={6} value={config.botPurpose}
                  onChange={(e) => setConfig((prev) => ({ ...prev, botPurpose: e.target.value }))}
                  placeholder="Example: Help me write code, debug errors, and explain technical concepts clearly." />
              </label>
            </div>

            {formError && <div className="panel full-width error-panel"><strong>Before you continue:</strong> {formError}</div>}

            <div className="panel full-width">
              <h2>Summary</h2>
              <div className="summary-box">
                <div><strong>Profile:</strong> {selectedProfile.name}</div>
                <div><strong>Bot:</strong> {config.botName || "—"}</div>
                <div><strong>Provider:</strong> {config.modelProvider}</div>
                <div><strong>Purpose:</strong> {config.botPurpose || "—"}</div>
              </div>
              <div className="wizard-actions">
                <button className="secondary" onClick={goBack}>Back</button>
                <button onClick={goNext}>Next</button>
                {/* Batch 2: Save profile shortcut */}
                <button className="secondary" onClick={() => setShowProfileManager(true)}>Save as profile</button>
              </div>
            </div>
          </section>
        )}

        {/* ── Connect ── */}
        {screen === "connect" && (
          <section className="setup-grid">
            <div className="panel">
              <h2>1. Choose your chat platforms</h2>
              <p className="helper-text" style={{ marginBottom: 12 }}>Pick one or more. Your bot will respond on all selected platforms simultaneously.</p>
              <div className="platform-grid">
                {([
                  { id: "discord", label: "Discord", note: "Bot token" },
                  { id: "telegram", label: "Telegram", note: "Bot token" },
                  { id: "whatsapp", label: "WhatsApp", note: "QR pairing" },
                  { id: "slack", label: "Slack", note: "OAuth" },
                  { id: "signal", label: "Signal", note: "Phone setup" },
                  { id: "googlechat", label: "Google Chat", note: "Webhook" },
                ] as { id: PlatformKey, label: string, note: string }[]).map(({ id, label, note }) => (
                  <label key={id} className={`platform-card ${config.platforms.includes(id) ? "platform-selected" : ""}`}>
                    <input type="checkbox" checked={config.platforms.includes(id)} onChange={() => togglePlatform(id)} style={{ display: "none" }} />
                    <span className="platform-check">{config.platforms.includes(id) ? "✓" : ""}</span>
                    <strong>{label}</strong>
                    <span>{note}</span>
                  </label>
                ))}
              </div>
              <p className="helper-text" style={{ marginTop: 10 }}>
                More platforms (iMessage, Teams, Matrix, IRC, etc.) can be added manually after install via the <code>~/.openclaw/openclaw.json</code> config file.
              </p>
            </div>

            <div className="panel">
              <h2>2. Add your API keys</h2>
              <div className="toggle-column">

                {/* AI provider key — dynamic based on selection */}
                {config.modelProvider === "openai" && (
                  <>
                    <label>OpenAI API key {validationBadge(openaiValidation)}
                      <input className={`text-input ${openaiValidation === "valid" || openaiValidation === "rate-limited" ? "input-valid" : openaiValidation === "invalid" ? "input-invalid" : ""}`}
                        type="password" value={secrets.openaiApiKey} onChange={(e) => handleOpenAIKeyChange(e.target.value)} />
                    </label>
                    <p className="helper-text">Powers your bot's AI responses via OpenAI.</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://platform.openai.com/settings/organization/api-keys")}>Get OpenAI API key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "anthropic" && (
                  <>
                    <label>Anthropic API key
                      <input className="text-input" type="password" value={secrets.anthropicApiKey}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, anthropicApiKey: e.target.value }))} />
                    </label>
                    <p className="helper-text">Powers your bot with Claude (Sonnet 4, Opus 4).</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://console.anthropic.com/settings/keys")}>Get Anthropic API key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "google" && (
                  <>
                    <label>Google AI API key
                      <input className="text-input" type="password" value={secrets.googleApiKey}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, googleApiKey: e.target.value }))} />
                    </label>
                    <p className="helper-text">Powers your bot with Gemini 3 Pro / Flash.</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://aistudio.google.com/app/apikey")}>Get Google AI key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "xai" && (
                  <>
                    <label>xAI API key
                      <input className="text-input" type="password" value={secrets.xaiApiKey}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, xaiApiKey: e.target.value }))} />
                    </label>
                    <p className="helper-text">Powers your bot with Grok from xAI.</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://console.x.ai/")}>Get xAI API key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "mistral" && (
                  <>
                    <label>Mistral API key
                      <input className="text-input" type="password" value={secrets.mistralApiKey}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, mistralApiKey: e.target.value }))} />
                    </label>
                    <p className="helper-text">Powers your bot with Mistral models.</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://console.mistral.ai/api-keys/")}>Get Mistral API key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "openrouter" && (
                  <>
                    <label>OpenRouter API key
                      <input className="text-input" type="password" value={secrets.openrouterApiKey}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, openrouterApiKey: e.target.value }))} />
                    </label>
                    <p className="helper-text">Access 100+ models from one key via OpenRouter.</p>
                    <div className="helper-links">
                      <button className="secondary" onClick={() => openExternal("https://openrouter.ai/keys")}>Get OpenRouter key</button>
                    </div>
                  </>
                )}
                {config.modelProvider === "local" && (
                  <div className="summary-box">
                    <div>🖥️ <strong>Local model selected</strong></div>
                    <div style={{ fontSize: 13 }}>No API key needed. Make sure <code>ollama</code> is running on your machine before installing.</div>
                    <div style={{ marginTop: 4 }}>
                      <button className="secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => openExternal("https://ollama.ai")}>Get Ollama</button>
                    </div>
                  </div>
                )}

                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 4 }}>
                  {/* Platform tokens — shown only for selected platforms */}
                  {config.platforms.includes("discord") && (
                    <>
                      <label style={{ marginBottom: 0 }}>Discord bot token {validationBadge(discordValidation)}
                        <input className={`text-input ${discordValidation === "valid" || discordValidation === "rate-limited" ? "input-valid" : discordValidation === "invalid" ? "input-invalid" : ""}`}
                          type="password" value={secrets.discordBotToken} onChange={(e) => handleDiscordTokenChange(e.target.value)} />
                      </label>
                      <div className="helper-links" style={{ marginTop: 8 }}>
                        <button className="secondary" onClick={() => openExternal("https://discord.com/developers/applications")}>Discord Developer Portal</button>
                        <button className="secondary" onClick={() => openExternal("https://docs.discord.com/developers/quick-start/getting-started")}>Setup guide</button>
                      </div>
                    </>
                  )}
                  {config.platforms.includes("telegram") && (
                    <>
                      <label style={{ marginTop: 12, marginBottom: 0 }}>Telegram bot token
                        <input className="text-input" type="password" value={secrets.telegramBotToken}
                          onChange={(e) => setSecrets((prev) => ({ ...prev, telegramBotToken: e.target.value }))} />
                      </label>
                      <div className="helper-links" style={{ marginTop: 8 }}>
                        <button className="secondary" onClick={() => openExternal("https://t.me/BotFather")}>Open BotFather on Telegram</button>
                      </div>
                    </>
                  )}
                  {config.platforms.includes("slack") && (
                    <>
                      <label style={{ marginTop: 12, marginBottom: 0 }}>Slack bot token
                        <input className="text-input" type="password" value={secrets.slackBotToken}
                          onChange={(e) => setSecrets((prev) => ({ ...prev, slackBotToken: e.target.value }))} />
                      </label>
                      <div className="helper-links" style={{ marginTop: 8 }}>
                        <button className="secondary" onClick={() => openExternal("https://api.slack.com/apps")}>Slack API Console</button>
                      </div>
                    </>
                  )}
                  {config.platforms.includes("googlechat") && (
                    <>
                      <label style={{ marginTop: 12, marginBottom: 0 }}>Google Chat webhook URL
                        <input className="text-input" type="password" value={secrets.googlechatWebhook}
                          onChange={(e) => setSecrets((prev) => ({ ...prev, googlechatWebhook: e.target.value }))} />
                      </label>
                    </>
                  )}
                  {config.platforms.includes("whatsapp") && (
                    <div className="summary-box" style={{ marginTop: 12 }}>
                      <div>📱 <strong>WhatsApp</strong> — uses QR code pairing</div>
                      <div style={{ fontSize: 13 }}>After install, a QR code will appear in the gateway dashboard. Scan it with WhatsApp on your phone to connect.</div>
                    </div>
                  )}
                  {config.platforms.includes("signal") && (
                    <div className="summary-box" style={{ marginTop: 12 }}>
                      <div>🔒 <strong>Signal</strong> — requires phone number setup</div>
                      <div style={{ fontSize: 13 }}>After install, follow the Signal setup guide in the OpenClaw docs to link your number.</div>
                      <div style={{ marginTop: 4 }}>
                        <button className="secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => openExternal("https://docs.openclaw.ai/channels/signal")}>Signal setup guide</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="panel full-width">
              <h2>3. Where should we install it?</h2>
              <label>Install path
                <input className="text-input" value={config.installPath} placeholder="~/ClawLaunch/bot"
                  onChange={(e) => setConfig((prev) => ({ ...prev, installPath: e.target.value }))} />
              </label>
              <p className="helper-text">Use <code>~/</code> for your home folder. On Windows use a full path like <code>C:\Users\YourName\ClawLaunch\bot</code>.</p>
            </div>

            <div className="panel full-width">
              <h2>4. Check your tokens</h2>
              <div className="summary-box"><div>{connectionCheck}</div></div>
              <div className="wizard-actions">
                <button className="secondary" onClick={runTokenCheck} disabled={isCheckingTokens}>
                  {isCheckingTokens ? "Checking..." : "Check tokens"}
                </button>
              </div>
            </div>

            {formError && <div className="panel full-width error-panel"><strong>Before you continue:</strong> {formError}</div>}

            <div className="panel full-width">
              <div className="wizard-actions">
                <button className="secondary" onClick={goBack}>Back</button>
                <button onClick={goNext}>Next</button>
              </div>
            </div>
          </section>
        )}

        {/* ── Install ── */}
        {screen === "install" && (
          <section className="setup-grid">
            <div className="panel full-width">
              <h2>Installing ClawBot</h2>
              <div className="install-checklist">
                {installSteps.map((step) => (
                  <div key={step.label} className={`install-step ${step.status}`}>
                    <span className="install-dot" />
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>
              {installError && <div className="install-error-box"><strong>Install problem:</strong> {installError}</div>}
              <div className="wizard-actions" style={{ marginTop: 16 }}>
                <button onClick={runInstall} disabled={isInstalling}>{isInstalling ? "Installing..." : "Install now"}</button>
                <button className="secondary" onClick={goBack} disabled={isInstalling}>Back</button>
              </div>
            </div>

            <div className="panel full-width">
              <h2>Install messages</h2>
              <div className="log-box">
                {installMessages.length === 0
                  ? <div className="log-line" style={{ color: "#64748b" }}>Click "Install now" to begin.</div>
                  : installMessages.map((msg, i) => <div key={i} className="log-line">{msg}</div>)
                }
              </div>
            </div>
          </section>
        )}

        {/* ── Done ── */}
        {screen === "done" && (
          <section className="setup-grid">

            {/* Status */}
            <div className="panel">
              <h2>Your ClawBot is ready</h2>
              <div className={`status-pill ${gatewayHealth === "running" ? "status-running" : "status-stopped"}`}>
                {gatewayHealth.toUpperCase()}
              </div>
              <p><strong>Gateway:</strong> {gatewayHealth}</p>
              <p><strong>Channels:</strong> {channelHealth}</p>
              <p><strong>Bot:</strong> {config.botName}</p>
              <p><strong>Profile:</strong> {selectedProfile.name}</p>
              <p><strong>Port:</strong> 18789</p>

              {/* Auto-start toggle */}
              <div className="autostart-row">
                <label className="autostart-label">
                  <span>Start on login</span>
                  <span className="helper-text" style={{ margin: 0 }}>Keeps your bot running after a reboot</span>
                </label>
                <button className={`toggle-btn ${autoStart ? "toggle-on" : "toggle-off"}`} onClick={toggleAutoStart}>
                  {autoStart ? "ON" : "OFF"}
                </button>
              </div>

              {/* Batch 2: Crash recovery status */}
              {crashCount > 0 && (
                <div className="crash-notice">
                  ⚡ Auto-restarted {crashCount} time{crashCount !== 1 ? "s" : ""} — last at {lastCrashTime}
                </div>
              )}
            </div>

            {/* Status summary */}
            <div className="panel">
              <h2>Status summary</h2>
              <p>{doneStatusText}</p>
              <p><strong>Config:</strong> ~/.openclaw/openclaw.json</p>
              <p><strong>Install folder:</strong> {config.installPath}</p>
              <p><strong>Gateway URL:</strong> {gatewaySummary.dashboardUrl}</p>
              <p className="helper-text" style={{ marginTop: 8 }}>Status auto-refreshes every 30 seconds.</p>
            </div>

            {/* Batch 2: Usage stats */}
            {usageStats && (
              <div className="panel">
                <h2>Usage stats</h2>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{usageStats.messages}</div>
                    <div className="stat-label">Messages handled</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{usageStats.restarts}</div>
                    <div className="stat-label">Gateway starts</div>
                  </div>
                </div>
                <p className="helper-text" style={{ marginTop: 12 }}>
                  First seen: {usageStats.firstSeen.substring(0, 24)}<br />
                  Last active: {usageStats.lastActivity.substring(0, 24)}
                </p>
              </div>
            )}

            {/* Connection check */}
            <div className="panel">
              <h2>Connection check</h2>
              <div className="summary-box"><div>{connectionCheck}</div></div>
              <div className="wizard-actions">
                <button className="secondary" onClick={runTokenCheck} disabled={isCheckingTokens}>
                  {isCheckingTokens ? "Checking..." : "Recheck connection"}
                </button>
              </div>
            </div>

            {/* Quick actions */}
            <div className="panel">
              <h2>Quick actions</h2>
              <div className="button-row">
                <button onClick={() => openExternal(gatewaySummary.dashboardUrl)}>Open gateway dashboard</button>
                <button className="secondary" onClick={restartBot} disabled={isBusy}>Restart bot</button>
                <button className="secondary" onClick={stopBot} disabled={isBusy}>Stop bot</button>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px" }}
                  onClick={() => setShowProfileManager(true)}>
                  Manage profiles
                </button>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px" }}
                  onClick={() => setShowOnboarding(true)}>
                  Setup guide
                </button>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px" }}
                  onClick={openConfigEditor}>
                  Edit config
                </button>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px" }}
                  onClick={() => setShowAvatarModal(true)}>
                  Set avatar
                </button>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px" }}
                  onClick={openBackupModal}>
                  Backup
                </button>
                <button className="secondary" style={{ fontSize: 13, padding: "8px 14px", borderColor: "rgba(255,77,109,0.3)", color: "#ffb3be" }}
                  onClick={() => setShowResetConfirm(true)}>
                  Set up a new bot
                </button>
              </div>
            </div>

            {/* Live logs */}
            <div className="panel full-width">
              <div className="log-header">
                <h2 style={{ margin: 0 }}>Live gateway logs</h2>
                <button className="secondary" style={{ padding: "8px 14px", fontSize: 13 }}
                  onClick={() => setShowLogs((v) => !v)}>
                  {showLogs ? "Hide logs" : "Show logs"}
                </button>
              </div>
              {showLogs && (
                <div className="log-box" ref={logRef} style={{ marginTop: 14, maxHeight: 340 }}>
                  {logLines.length === 0
                    ? <div className="log-line" style={{ color: "#64748b" }}>No log output yet.</div>
                    : logLines.map((line, i) => <div key={i} className="log-line">{line}</div>)
                  }
                </div>
              )}
            </div>

            {/* How to use guide */}
            <div className="panel full-width how-to-panel">
              <h2>Your bot is ready — here's what it can do</h2>
              <p style={{ marginBottom: 24 }}>
                Everything below is already enabled. Just mention your bot in Discord or Telegram to use any of these features.
              </p>

              {/* Capabilities grid */}
              <div className="capability-grid">
                <div className="capability-card">
                  <div className="cap-icon">💬</div>
                  <div>
                    <strong>Chat in Discord or Telegram</strong>
                    <p>Mention <span className="inline-code">@{config.botName}</span> in any channel or DM it directly. It replies with full AI responses.</p>
                  </div>
                </div>
                <div className="capability-card">
                  <div className="cap-icon">🧠</div>
                  <div>
                    <strong>Persistent memory</strong>
                    <p>Your bot remembers context within a session. The more you use it, the more it understands your style and preferences.</p>
                  </div>
                </div>
                <div className="capability-card">
                  <div className="cap-icon">🌐</div>
                  <div>
                    <strong>Browse the web</strong>
                    <p>Ask it to look something up, summarize a page, or extract data from a website. It controls a real browser.</p>
                    <span className="cap-badge">Enabled in your profile</span>
                  </div>
                </div>
                <div className="capability-card">
                  <div className="cap-icon">⚡</div>
                  <div>
                    <strong>Run code & access files</strong>
                    <p>It can read and write files, run shell commands, and execute scripts on your machine — all from chat.</p>
                    <span className="cap-badge">Coding &amp; Tasks profiles</span>
                  </div>
                </div>
                <div className="capability-card">
                  <div className="cap-icon">🧩</div>
                  <div>
                    <strong>Skills &amp; plugins</strong>
                    <p>Extend your bot with community-built skills. Run <span className="inline-code">openclaw skills list</span> in your terminal to see what's available.</p>
                  </div>
                </div>
                <div className="capability-card">
                  <div className="cap-icon">🔒</div>
                  <div>
                    <strong>Fully private</strong>
                    <p>Everything runs on your machine. Your conversations never leave your computer unless you're using an external AI provider like OpenAI.</p>
                  </div>
                </div>
              </div>

              {/* Step by step */}
              <div style={{ marginTop: 28 }}>
                <h2 style={{ marginBottom: 16 }}>Get started in 3 steps</h2>
                <div className="how-to-steps">
                  <div className="how-to-step">
                    <div className="how-to-num">1</div>
                    <div>
                      <strong>Invite the bot to your server</strong>
                      <p>Go to Discord Developer Portal → your app → OAuth2 → URL Generator. Select <code>bot</code> and <code>applications.commands</code> scopes. Open the generated link and add it to your server.</p>
                      <div className="wizard-actions" style={{ marginTop: 10 }}>
                        <button className="secondary" style={{ fontSize: 12, padding: "7px 14px" }}
                          onClick={() => openExternal("https://discord.com/developers/applications")}>
                          Open Discord Developer Portal
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="how-to-step">
                    <div className="how-to-num">2</div>
                    <div>
                      <strong>Mention your bot in a channel</strong>
                      <p>In any Discord channel your bot has access to, type a message mentioning it. It will reply instantly.</p>
                      <div className="example-prompts" style={{ marginTop: 10 }}>
                        {examplePrompts.map((prompt) => (
                          <div key={prompt} className="example-prompt">
                            <span className="prompt-at">@{config.botName}</span> {prompt}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="how-to-step">
                    <div className="how-to-num">3</div>
                    <div>
                      <strong>Keep ClawLaunch running</strong>
                      <p>Your bot only works while ClawLaunch is open. Minimize it to the tray using the X button — it keeps running in the background. Turn on <strong style={{ color: "var(--cyan)" }}>Start on login</strong> so it restarts automatically after a reboot.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="wizard-actions" style={{ marginTop: 20 }}>
                <button className="secondary" onClick={() => openExternal("https://docs.openclaw.ai")}>
                  OpenClaw docs
                </button>
                <button className="secondary" onClick={() => openExternal("https://openclaw.ai")}>
                  OpenClaw website
                </button>
              </div>
            </div>

            {/* Only show warning if we've actually checked and something is wrong */}
            {gatewayHealth === "stopped" && config.botStatus === "running" && (
              <div className="panel full-width error-panel">
                <strong>Heads up:</strong> the gateway appears stopped. Click <strong>Restart bot</strong> to bring it back up.
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;