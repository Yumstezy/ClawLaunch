import { useEffect, useMemo, useState } from "react";
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
} from "./lib/tauri";
import "./App.css";

type Screen = "welcome" | "configure" | "connect" | "install" | "done";
type InstallStepStatus = "idle" | "active" | "done" | "error";

const defaultSecrets: LauncherSecrets = {
  openaiApiKey: "",
  discordBotToken: "",
  telegramBotToken: "",
};

const stepOrder: Screen[] = ["welcome", "configure", "connect", "install", "done"];

function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [config, setConfig] = useState<LauncherConfig>(defaultConfig);
  const [secrets, setSecrets] = useState<LauncherSecrets>(defaultSecrets);

  const [gatewayHealth, setGatewayHealth] = useState("unknown");
  const [channelHealth, setChannelHealth] = useState("unknown");
  const [serviceDetail, setServiceDetail] = useState("No status yet.");
  const [connectionCheck, setConnectionCheck] = useState("Not checked yet.");

  const [isInstalling, setIsInstalling] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isCheckingTokens, setIsCheckingTokens] = useState(false);

  const [formError, setFormError] = useState("");
  const [installError, setInstallError] = useState("");

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

  const gatewaySummary = useMemo(() => {
    const text = serviceDetail || "";

    const portMatch =
      text.match(/port[=: ](\d+)/i) ||
      text.match(/127\.0\.0\.1:(\d+)/i) ||
      text.match(/ws:\/\/127\.0\.0\.1:(\d+)/i);

    return {
      port: portMatch ? portMatch[1] : "18789",
      dashboardUrl: "http://127.0.0.1:18789",
    };
  }, [serviceDetail]);

  useEffect(() => {
    try {
      const saved = loadConfig();
      setConfig(saved);

      if (saved.botStatus !== "not_installed") {
        setScreen("done");
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  }, []);

  useEffect(() => {
    try {
      saveConfig(config);
    } catch (error) {
      console.error("Failed to save config:", error);
    }
  }, [config]);

  function pushInstallMessage(message: string) {
    setInstallMessages((prev) => [message, ...prev].slice(0, 30));
  }

  function setStepStatus(index: number, status: InstallStepStatus) {
    setInstallSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, status } : step))
    );
  }

  function resetInstallSteps() {
    setInstallSteps((prev) =>
      prev.map((step) => ({ ...step, status: "idle" as InstallStepStatus }))
    );
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

    if (config.modelProvider === "openai" && !secrets.openaiApiKey.trim()) {
      return "Please enter your OpenAI API key.";
    }

    if (config.platforms.includes("discord") && !secrets.discordBotToken.trim()) {
      return "Discord is selected, so you need to paste a Discord bot token.";
    }

    if (config.platforms.includes("telegram") && !secrets.telegramBotToken.trim()) {
      return "Telegram is selected, so you need to paste a Telegram bot token.";
    }

    if (!config.installPath.trim()) return "Please choose an install path.";

    return "";
  }

  function goNext() {
    setFormError("");

    if (screen === "welcome") {
      setScreen("configure");
      return;
    }

    if (screen === "configure") {
      const error = validateConfigureStep();
      if (error) {
        setFormError(error);
        return;
      }
      setScreen("connect");
      return;
    }

    if (screen === "connect") {
      const error = validateConnectStep();
      if (error) {
        setFormError(error);
        return;
      }
      setScreen("install");
      return;
    }

    if (screen === "install") {
      setScreen("done");
    }
  }

  function goBack() {
    setFormError("");

    if (screen === "configure") setScreen("welcome");
    else if (screen === "connect") setScreen("configure");
    else if (screen === "install") setScreen("connect");
    else if (screen === "done") setScreen("install");
  }

  const examplePrompts = useMemo(() => {
    const purpose = config.botPurpose.toLowerCase();

    if (purpose.includes("code") || purpose.includes("debug") || purpose.includes("program")) {
      return [
        "Explain this error and how to fix it",
        "Help me write a function for this task",
        "Review this code and suggest improvements",
      ];
    }

    if (purpose.includes("research") || purpose.includes("study") || purpose.includes("paper")) {
      return [
        "Summarize this topic in simple terms",
        "Compare these two ideas for me",
        "Help me research this question step by step",
      ];
    }

    if (purpose.includes("crypto") || purpose.includes("trade") || purpose.includes("market")) {
      return [
        "Summarize the latest market sentiment",
        "Explain this token in simple terms",
        "List risks I should watch for today",
      ];
    }

    if (purpose.includes("discord") || purpose.includes("community") || purpose.includes("server")) {
      return [
        "Answer this user question clearly",
        "Write a short announcement for my server",
        "Summarize what this channel has been discussing",
      ];
    }

    return [
      "Help me with this task",
      "Explain this clearly",
      "Give me the next best step",
    ];
  }, [config.botPurpose]);

  function updateProfile(profile: ProfileKey) {
    setConfig((prev) => ({
      ...prev,
      profile,
      permissions: profiles[profile].permissions,
    }));
  }

  function togglePlatform(platform: PlatformKey) {
    setConfig((prev) => {
      const exists = prev.platforms.includes(platform);
      const nextPlatforms = exists
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform];

      return {
        ...prev,
        platforms: nextPlatforms.length ? nextPlatforms : [platform],
      };
    });
  }

  async function refreshGatewayHealth() {
    try {
      const result = await readGatewayStatus(config.installPath);
      if (result.success) {
        setGatewayHealth("running");
      } else {
        setGatewayHealth("stopped");
      }
      setServiceDetail(result.message || "No status output.");
    } catch {
      setGatewayHealth("unknown");
      setServiceDetail("Failed to read status.");
    }
  }

  async function refreshChannelHealth() {
    try {
      const result = await probeChannels();
      const text = result.message.toLowerCase();

      if (
        result.success &&
        (text.includes("discord") ||
          text.includes("telegram") ||
          text.includes("connected") ||
          text.includes("enabled"))
      ) {
        setChannelHealth("connected");
      } else if (
        text.includes("error") ||
        text.includes("failed") ||
        text.includes("degraded")
      ) {
        setChannelHealth("degraded");
      } else {
        setChannelHealth("unknown");
      }
    } catch {
      setChannelHealth("unknown");
    }
  }

  async function runTokenCheck() {
    const error = validateConnectStep();
    if (error) {
      setFormError(error);
      return;
    }

    try {
      setIsCheckingTokens(true);
      setFormError("");

      const configResult = await writeLauncherConfig({
        ...config,
        botStatus: config.botStatus,
      });
      if (!configResult.success) {
        setConnectionCheck("Could not prepare launcher config for validation.");
        return;
      }

      const secretsResult = await writeSecrets(config.installPath, secrets);
      if (!secretsResult.success) {
        setConnectionCheck("Could not save tokens for validation.");
        return;
      }

      const result = await validatePlatformTokens(config.installPath);
      setConnectionCheck(result.message);
    } catch {
      setConnectionCheck("Token validation failed.");
    } finally {
      setIsCheckingTokens(false);
    }
  }

  async function runInstall() {
    const connectError = validateConnectStep();
    const configureError = validateConfigureStep();
    const blockingError = configureError || connectError;

    if (blockingError) {
      setInstallError(blockingError);
      return;
    }

    try {
      setIsInstalling(true);
      resetInstallSteps();

      setStepStatus(0, "active");
      const envResult = await checkEnvironment();
      pushInstallMessage(envResult.message);
      if (!envResult.success) {
        setStepStatus(0, "error");
        setInstallError("Environment check failed. Install Node.js first, then reopen ClawLaunch.");
        return;
      }
      setStepStatus(0, "done");

      setStepStatus(1, "active");
      const folderResult = await createInstallFolder(config.installPath);
      pushInstallMessage(folderResult.message);
      if (!folderResult.success) {
        setStepStatus(1, "error");
        setInstallError("We could not create the install folder.");
        return;
      }
      setStepStatus(1, "done");

      setStepStatus(2, "active");
      const configResult = await writeLauncherConfig({
        ...config,
        botStatus: "installed",
      });
      pushInstallMessage(configResult.message);
      if (!configResult.success) {
        setStepStatus(2, "error");
        setInstallError("We could not write the launcher config.");
        return;
      }
      setStepStatus(2, "done");

      setStepStatus(3, "active");
      const secretsResult = await writeSecrets(config.installPath, secrets);
      pushInstallMessage(secretsResult.message);
      if (!secretsResult.success) {
        setStepStatus(3, "error");
        setInstallError("We could not save your keys and tokens.");
        return;
      }
      setStepStatus(3, "done");

      setStepStatus(4, "active");
      const openclawConfigResult = await writeOpenClawConfig(config.installPath);
      pushInstallMessage(openclawConfigResult.message);
      if (!openclawConfigResult.success) {
        setStepStatus(4, "error");
        setInstallError("We could not build the OpenClaw config.");
        return;
      }
      setStepStatus(4, "done");

      setStepStatus(5, "active");
      const installResult = await installOpenClaw(config.installPath);
      pushInstallMessage(installResult.message);
      if (!installResult.success) {
        setStepStatus(5, "error");
        setInstallError(installResult.message || "OpenClaw installation failed.");
        return;
      }
      setStepStatus(5, "done");

      setStepStatus(6, "active");
      const startResult = await startOpenClaw(config.installPath);
      pushInstallMessage(startResult.message);
      if (!startResult.success) {
        setStepStatus(6, "error");
        setInstallError("OpenClaw installed, but the gateway could not start.");
        return;
      }
      setStepStatus(6, "done");

      setStepStatus(7, "active");
      await refreshGatewayHealth();
      await refreshChannelHealth();
      setStepStatus(7, "done");

      setConfig((prev) => ({
        ...prev,
        botStatus: "running",
      }));

      setScreen("done");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown install error.";
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
      if (result.success) {
        setConfig((prev) => ({ ...prev, botStatus: "stopped" }));
      }
      await refreshGatewayHealth();
      await refreshChannelHealth();
    } finally {
      setIsBusy(false);
    }
  }

  async function restartBot() {
    try {
      setIsBusy(true);
      const result = await restartOpenClaw(config.installPath);
      pushInstallMessage(result.message);
      if (result.success) {
        setConfig((prev) => ({ ...prev, botStatus: "running" }));
      }
      await refreshGatewayHealth();
      await refreshChannelHealth();
    } finally {
      setIsBusy(false);
    }
  }

  function openDashboard() {
    window.open(gatewaySummary.dashboardUrl, "_blank");
  }

  function openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const doneStatusText =
    gatewayHealth === "running" && channelHealth === "connected"
      ? "Your bot is installed and connected."
      : gatewayHealth === "running"
      ? "Your bot is installed. The gateway is running, but your channel connection may need attention."
      : "OpenClaw is installed, but the bot may still need one more setup fix.";

  return (
    <div className="app-shell wizard-shell">
      <main className="main wizard-main">
        <div className="wizard-topbar">
          <div>
            <div className="brand">ClawLaunch</div>
            <div className="subbrand">Easy ClawBot setup</div>
          </div>
          <div className="wizard-progress">
            Step {currentStepIndex + 1} of {totalSteps}
          </div>
        </div>

        {screen !== "done" && (
          <div className="wizard-steps">
            {["Welcome", "Configure", "Connect", "Install", "Done"].map((label, index) => (
              <div
                key={label}
                className={`wizard-step-pill ${
                  index < currentStepIndex ? "done" : index === currentStepIndex ? "active" : ""
                }`}
              >
                {label}
              </div>
            ))}
          </div>
        )}

        {screen === "welcome" && (
          <section className="panel hero-panel">
            <span className="eyebrow">Simple OpenClaw installer</span>
            <h1>Install ClawBot on your computer in minutes</h1>
            <p>
              This app installs OpenClaw, creates a strong starter config,
              connects your bot to Discord or Telegram, and gets it running on
              your machine.
            </p>

            <div className="summary-box">
              <div>✓ Install OpenClaw locally</div>
              <div>✓ Create a working config</div>
              <div>✓ Connect to a text platform</div>
              <div>✓ Start the gateway</div>
            </div>

            <div className="wizard-actions">
              <button onClick={goNext}>Start setup</button>
            </div>
          </section>
        )}

        {screen === "configure" && (
          <section className="setup-grid">
            <div className="panel">
              <h2>1. Pick a starting profile</h2>
              <div className="card-grid">
                {(Object.keys(profiles) as ProfileKey[]).map((key) => (
                  <button
                    key={key}
                    className={`card-button ${config.profile === key ? "selected" : ""}`}
                    onClick={() => updateProfile(key)}
                  >
                    <strong>{profiles[key].name}</strong>
                    <span>{profiles[key].description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2>2. Bot basics</h2>
              <div className="toggle-column">
                <label>
                  Bot name
                  <input
                    className="text-input"
                    value={config.botName}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, botName: e.target.value }))
                    }
                  />
                </label>

                <label>
                  AI provider
                  <select
                    className="text-input"
                    value={config.modelProvider}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        modelProvider: e.target.value as LauncherConfig["modelProvider"],
                      }))
                    }
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="local">Local</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="panel full-width">
              <h2>3. What should your bot help with?</h2>
              <label>
                Bot purpose
                <textarea
                  className="text-input"
                  rows={6}
                  value={config.botPurpose}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      botPurpose: e.target.value,
                    }))
                  }
                  placeholder="Example: Help me write code, debug errors, and explain technical concepts clearly."
                />
              </label>
            </div>

            {formError && (
              <div className="panel full-width error-panel">
                <strong>Before you continue:</strong> {formError}
              </div>
            )}

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
              </div>
            </div>
          </section>
        )}

        {screen === "connect" && (
          <section className="setup-grid">
            <div className="panel">
              <h2>1. Choose a text platform</h2>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={config.platforms.includes("discord")}
                    onChange={() => togglePlatform("discord")}
                  />
                  Discord
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.platforms.includes("telegram")}
                    onChange={() => togglePlatform("telegram")}
                  />
                  Telegram
                </label>
              </div>
            </div>

            <div className="panel">
  <h2>2. Add your keys and tokens</h2>
  <div className="toggle-column">
    <label>
      OpenAI API key
      <input
        className="text-input"
        type="password"
        value={secrets.openaiApiKey}
        onChange={(e) =>
          setSecrets((prev) => ({
            ...prev,
            openaiApiKey: e.target.value,
          }))
        }
      />
    </label>
    <p className="helper-text">
      Used so your bot can send requests to OpenAI and generate AI responses.
    </p>
    <div className="helper-links">
      <button
        className="secondary"
        onClick={() =>
          openExternal("https://platform.openai.com/settings/organization/api-keys")
        }
      >
        Get OpenAI API key
      </button>
    </div>

    <label>
      Discord bot token
      <input
        className="text-input"
        type="password"
        value={secrets.discordBotToken}
        onChange={(e) =>
          setSecrets((prev) => ({
            ...prev,
            discordBotToken: e.target.value,
          }))
        }
      />
    </label>
    <p className="helper-text">
      Used so your bot can sign in to Discord and connect to your server as a bot.
    </p>
    <div className="helper-links">
      <button
        className="secondary"
        onClick={() => openExternal("https://discord.com/developers/applications")}
      >
        Open Discord Developer Portal
      </button>
      <button
        className="secondary"
        onClick={() =>
          openExternal("https://docs.discord.com/developers/quick-start/getting-started")
        }
      >
        Discord bot setup guide
      </button>
    </div>

    <label>
      Telegram bot token
      <input
        className="text-input"
        type="password"
        value={secrets.telegramBotToken}
        onChange={(e) =>
          setSecrets((prev) => ({
            ...prev,
            telegramBotToken: e.target.value,
          }))
        }
      />
    </label>
    <p className="helper-text">
      Used so your bot can connect to Telegram if you choose Telegram as your text platform.
    </p>
  </div>
</div>

            <div className="panel full-width">
              <h2>3. Where should we install it?</h2>
              <label>
                Install path
                <input
                  className="text-input"
                  value={config.installPath}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      installPath: e.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="panel full-width">
              <h2>4. Check your tokens</h2>
              <div className="summary-box">
                <div>{connectionCheck}</div>
              </div>

              <div className="wizard-actions">
                <button
                  className="secondary"
                  onClick={runTokenCheck}
                  disabled={isCheckingTokens}
                >
                  {isCheckingTokens ? "Checking..." : "Check tokens"}
                </button>
              </div>
            </div>

            {formError && (
              <div className="panel full-width error-panel">
                <strong>Before you continue:</strong> {formError}
              </div>
            )}

            <div className="panel full-width">
              <div className="wizard-actions">
                <button className="secondary" onClick={goBack}>Back</button>
                <button onClick={goNext}>Next</button>
              </div>
            </div>
          </section>
        )}

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

              {installError && (
                <div className="install-error-box">
                  <strong>Install problem:</strong> {installError}
                </div>
              )}

              <div className="wizard-actions" style={{ marginTop: 16 }}>
                <button onClick={runInstall} disabled={isInstalling}>
                  {isInstalling ? "Installing..." : "Install now"}
                </button>
                <button
                  className="secondary"
                  onClick={goBack}
                  disabled={isInstalling}
                >
                  Back
                </button>
              </div>
            </div>

            <div className="panel full-width">
              <h2>Install messages</h2>
              <div className="log-box">
                {installMessages.map((message, index) => (
                  <div key={`${message}-${index}`} className="log-line">
                    {message}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {screen === "done" && (
          <section className="setup-grid">
            <div className="panel">
              <h2>Your ClawBot is ready</h2>
              <div className="status-pill">{gatewayHealth}</div>
              <p><strong>Gateway:</strong> {gatewayHealth}</p>
              <p><strong>Channels:</strong> {channelHealth}</p>
              <p><strong>Bot:</strong> {config.botName}</p>
              <p><strong>Profile:</strong> {selectedProfile.name}</p>
              <p><strong>Port:</strong> {gatewaySummary.port}</p>
            </div>

            <div className="panel">
              <h2>Status summary</h2>
              <p>{doneStatusText}</p>
              <p><strong>Config:</strong> ~/.openclaw/openclaw.json</p>
              <p><strong>Install folder:</strong> {config.installPath}</p>
              <p><strong>Gateway URL:</strong> {gatewaySummary.dashboardUrl}</p>
            </div>

            <div className="panel">
              <h2>Connection check</h2>
              <div className="summary-box">
                <div>{connectionCheck}</div>
              </div>
              <div className="wizard-actions">
                <button
                  className="secondary"
                  onClick={runTokenCheck}
                  disabled={isCheckingTokens}
                >
                  {isCheckingTokens ? "Checking..." : "Recheck connection"}
                </button>
              </div>
            </div>

            <div className="panel">
              <h2>Quick actions</h2>
              <div className="button-row">
                <button onClick={openDashboard}>Open gateway dashboard</button>
                <button className="secondary" onClick={restartBot} disabled={isBusy}>
                  Restart bot
                </button>
                <button className="secondary" onClick={stopBot} disabled={isBusy}>
                  Stop bot
                </button>
              </div>
            </div>

            <div className="panel full-width">
              <h2>Example ways to use your bot</h2>
              <div className="summary-box">
                {examplePrompts.map((prompt) => (
                  <div key={prompt}>• {prompt}</div>
                ))}
              </div>
            </div>

            {(gatewayHealth !== "running" || channelHealth !== "connected") && (
              <div className="panel full-width error-panel">
                <strong>Heads up:</strong> install completed, but one part may still need attention.
                Recheck your tokens, then restart the bot.
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;