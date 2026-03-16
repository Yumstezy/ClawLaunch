const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const installPath = process.argv[2] || process.cwd();
const runtimeDir = path.join(installPath, "runtime");
const manifestPath = path.join(installPath, "install-manifest.json");
const installerLogPath = path.join(installPath, "installer.log");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(installerLogPath, line);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

try {
  ensureDir(installPath);
  ensureDir(runtimeDir);

  log("Installer started.");
  log(`Install path: ${installPath}`);
  log(`Runtime dir: ${runtimeDir}`);

  const nodeVersion = execSync("node --version").toString().trim();
  log(`Node detected: ${nodeVersion}`);

  const runtimeReadme = path.join(runtimeDir, "README.txt");
  fs.writeFileSync(
    runtimeReadme,
    [
      "ClawLaunch Runtime",
      "------------------",
      "This is a placeholder runtime installed by the ClawLaunch installer.",
      "Next step: replace this with real OpenClaw/Clawbot download + setup.",
      "",
    ].join("\n")
  );
  log("Runtime placeholder files created.");

  const manifest = {
    installedAt: new Date().toISOString(),
    runtimeVersion: "0.1.0-placeholder",
    runtimeType: "clawlaunch-placeholder-runtime",
    nodeVersion,
    installPath,
    folders: {
      runtime: runtimeDir,
    },
    status: "installed",
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log("Install manifest written.");

  log("Installer completed successfully.");
  process.exit(0);
} catch (error) {
  log(`INSTALL ERROR: ${error.message}`);
  process.exit(1);
}