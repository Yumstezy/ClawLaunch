const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const installPath = process.argv[2] || process.cwd();
const homeDir = os.homedir();
const openclawDir = path.join(homeDir, ".openclaw");
const openclawBinDir = path.join(openclawDir, "bin");
// FIX: use .exe on Windows
const openclawBinary = path.join(
  openclawBinDir,
  process.platform === "win32" ? "openclaw.exe" : "openclaw"
);

const gatewayLogPath = path.join(installPath, "gateway.log");
const gatewayStatusPath = path.join(installPath, "gateway-status.json");

const isWindows = process.platform === "win32";

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(installPath, { recursive: true });
  fs.appendFileSync(gatewayLogPath, line);
  console.log(message);
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
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return null;
}

function writeStatus(status, detail = "") {
  fs.writeFileSync(
    gatewayStatusPath,
    JSON.stringify(
      { status, updatedAt: new Date().toISOString(), detail },
      null,
      2
    )
  );
}

try {
  fs.mkdirSync(installPath, { recursive: true });

  const nodeBinary = resolveNodeBinary();
  if (!nodeBinary) {
    throw new Error("Node.js was not found. Please install Node.js and reopen ClawLaunch.");
  }

  if (!fs.existsSync(openclawBinary)) {
    throw new Error(
      `OpenClaw binary not found at ${openclawBinary}. ` +
      `Run the installer first before starting the gateway.`
    );
  }

  log("Starting OpenClaw gateway...");
  writeStatus("starting", "Launching OpenClaw gateway");

  const out = fs.openSync(gatewayLogPath, "a");
  const err = fs.openSync(gatewayLogPath, "a");

  // FIX: use semicolon PATH separator on Windows
  const pathSep = isWindows ? ";" : ":";

  const child = spawn(openclawBinary, ["gateway"], {
    detached: false,
    stdio: ["ignore", out, err],
    env: {
      ...process.env,
      PATH: `${path.dirname(nodeBinary)}${pathSep}${openclawBinDir}${pathSep}${process.env.PATH || ""}`,
    },
  });

  if (!child.pid) {
    throw new Error("Failed to spawn OpenClaw gateway — no PID returned.");
  }

  log(`OpenClaw process spawned with pid ${child.pid}`);
  writeStatus("running", `PID ${child.pid}`);

  child.on("exit", (code) => {
    const message = `OpenClaw gateway exited with code ${code}`;
    log(message);
    writeStatus("stopped", message);
  });

  child.on("error", (err) => {
    const message = `OpenClaw gateway process error: ${err.message}`;
    log(message);
    writeStatus("error", message);
  });

  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`Failed to start OpenClaw gateway: ${message}`);
  writeStatus("error", message);
  process.exit(1);
}
