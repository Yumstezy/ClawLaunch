# ClawLaunch

<div align="center">

![ClawLaunch](branding/branding:clawlaunch-icon.png)

**The easiest way to run your own AI bot — no terminal required.**

[![Latest Release](https://img.shields.io/github/v/release/Yumstezy/debuging-clawlaunch?color=00FFB2&label=Download&style=for-the-badge)](https://github.com/Yumstezy/debuging-clawlaunch/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=for-the-badge)](https://github.com/Yumstezy/debuging-clawlaunch/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-blue?style=for-the-badge)](https://tauri.app)

</div>

---

## What is ClawLaunch?

ClawLaunch is a desktop app that installs and manages [OpenClaw](https://openclaw.ai) on your computer with a single click. No terminal, no config files, no technical knowledge required.

You paste your API key, pick a chat platform, click Install — and your personal AI bot is live on Discord, Telegram, or any of 6 supported platforms.

> ClawLaunch does not create a new AI. It sets up [OpenClaw](https://openclaw.ai) (formerly ClawBot/Molty) on your machine and keeps it running.

---

## Features

### Setup wizard
- 5-step guided install: Welcome → Configure → Connect → Install → Done
- Works with OpenAI, Anthropic, Google, xAI, Mistral, Ollama, and OpenRouter
- Supports Discord, Telegram, WhatsApp, Slack, Signal, and Google Chat
- Live API key validation as you type — know if your key works before installing
- 5 built-in bot profiles: Coding, Daily, Gaming, Tasks, Mixed

### While your bot is running
- **System tray** — close the window and your bot keeps running in the background
- **Auto-start on login** — your bot restarts automatically after a reboot
- **Auto-refresh** — gateway status updates every 30 seconds
- **Crash recovery** — if your bot crashes, it restarts itself automatically
- **Desktop notifications** — get notified when your bot crashes, restarts, or an update is available
- **Live log viewer** — watch your bot's activity in real time

### Management tools
- **Config editor** — edit `openclaw.json` directly from the UI with JSON validation
- **Backup & restore** — one-click backup of all your settings and tokens
- **Multiple profiles** — save and switch between different bot setups instantly
- **Bot avatar** — set your Discord bot's profile picture from any image URL
- **Update checker** — get notified when a new version of OpenClaw is available

---

## Download

**[→ Download the latest release](https://github.com/Yumstezy/debuging-clawlaunch/releases/latest)**

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `ClawLaunch_0.1.0_aarch64.dmg` |
| Windows | Coming soon |

---

## Installation

1. Download `ClawLaunch_0.1.0_aarch64.dmg` from the [Releases page](https://github.com/Yumstezy/debuging-clawlaunch/releases/latest)
2. Open the DMG and drag **ClawLaunch** to your Applications folder
3. Right-click the app → **Open** (required on first launch since the app is unsigned)
4. Follow the setup wizard — takes about 2 minutes

### Requirements

- macOS 10.15 Catalina or later (Apple Silicon / aarch64)
- [Node.js 22+](https://nodejs.org) — the installer will let you know if it's missing
- An API key from one of the supported AI providers (OpenAI, Anthropic, Google, etc.)

---

## Quick start

Once installed, here's how to use your bot:

1. **Invite it to your Discord server** — go to the [Discord Developer Portal](https://discord.com/developers/applications) → your app → OAuth2 → URL Generator → select `bot` + `applications.commands` scopes → use the invite link
2. **Mention your bot in any channel** — type `@YourBotName help me write a Python function` and it will reply with a full AI response
3. **Keep ClawLaunch running** — your bot works as long as ClawLaunch is open. Click X to minimize to tray, or turn on **Start on login** so it restarts automatically

---

## What your bot can do

Once running, your bot has access to everything OpenClaw supports:

| Capability | Details |
|-----------|---------|
| 💬 Chat | Responds in Discord, Telegram, WhatsApp, Slack, Signal, Google Chat |
| 🧠 Memory | Remembers context across your conversation |
| 🌐 Browser | Browses the web, fills forms, extracts data from any site |
| ⚡ System | Reads/writes files, runs shell commands, executes scripts |
| 🧩 Skills | Extendable with community-built plugins |
| 🔒 Privacy | Runs entirely on your machine — your data never leaves your computer |

---

## Supported AI providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4.1, o3, GPT-4.1 mini |
| Anthropic | Claude Sonnet 4, Claude Opus 4 |
| Google | Gemini 3 Pro, Gemini 3 Flash |
| xAI | Grok |
| Mistral | Mistral Large |
| Local | Ollama (qwen2.5, qwen2.5-coder, and more) |
| OpenRouter | 100+ models via a single key |

---

## Supported chat platforms

Discord · Telegram · WhatsApp · Slack · Signal · Google Chat

More platforms (iMessage, Microsoft Teams, Matrix, IRC, and more) can be added manually after install by editing the OpenClaw config file.

---

## Built with

- [Tauri](https://tauri.app) — native desktop app framework (Rust + WebView)
- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) — frontend UI
- [OpenClaw](https://openclaw.ai) — the AI agent runtime this app installs and manages

---

## Development

```bash
# Clone the repo
git clone https://github.com/Yumstezy/debuging-clawlaunch.git
cd debuging-clawlaunch

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Requirements for development
- [Node.js 22+](https://nodejs.org)
- [Rust](https://rustup.rs)
- [Tauri CLI](https://tauri.app/v2/guides/getting-started/prerequisites)

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <p>Built with ❤️ to make AI accessible to everyone.</p>
  <p>
    <a href="https://openclaw.ai">OpenClaw</a> ·
    <a href="https://github.com/Yumstezy/debuging-clawlaunch/releases">Download</a> ·
    <a href="https://github.com/Yumstezy/debuging-clawlaunch/issues">Report a bug</a>
  </p>
</div>
