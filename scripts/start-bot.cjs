const fs = require("fs");
const path = require("path");
const Discord = require("discord.js");
const OpenAI = require("openai").default;

const ClientCtor = Discord.Client || Discord.default?.Client;

const GatewayFlags =
  Discord.GatewayIntentBits ||
  Discord.IntentsBitField?.Flags ||
  {};

const INTENTS = {
  Guilds: GatewayFlags.Guilds ?? 1,
  GuildMessages: GatewayFlags.GuildMessages ?? 512,
  MessageContent: GatewayFlags.MessageContent ?? 32768,
};

const installPath = process.argv[2] || process.cwd();

const configPath = path.join(installPath, "clawlaunch-config.json");
const secretsPath = path.join(installPath, "secrets.json");
const manifestPath = path.join(installPath, "install-manifest.json");
const logPath = path.join(installPath, "bot.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logPath, line);
  console.log(msg);
}

function safeReadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    log(`ERROR loading ${label}`);
    log(err.message);
    process.exit(1);
  }
}

function getConfigValue(config, snakeKey, camelKey, fallback = "") {
  if (config && config[snakeKey] !== undefined) return config[snakeKey];
  if (config && config[camelKey] !== undefined) return config[camelKey];
  return fallback;
}

const config = safeReadJson(configPath, "config");
const secrets = safeReadJson(secretsPath, "secrets");
safeReadJson(manifestPath, "manifest");

const prefix = getConfigValue(config, "command_prefix", "commandPrefix", "!");
const botName = getConfigValue(config, "bot_name", "botName", "ClawBot");
const modelProvider = getConfigValue(config, "model_provider", "modelProvider", "openai");

const openaiKey = secrets.openai_api_key || secrets.openaiApiKey || "";
const discordToken = secrets.discord_bot_token || secrets.discordBotToken || "";

let openai = null;

if (openaiKey) {
  openai = new OpenAI({ apiKey: openaiKey });
  log("OpenAI client initialized.");
} else {
  log("WARNING: OpenAI key missing.");
}

async function askAI(prompt) {
  if (!openai) {
    throw new Error("OpenAI key missing.");
  }

  const model = "gpt-5-mini";

  log(`Calling OpenAI with model: ${model}`);

  const response = await openai.responses.create({
    model,
    input: prompt,
  });

  const text = response.output_text || "";

  if (!text.trim()) {
    throw new Error("OpenAI returned empty output.");
  }

  return text;
}

log("ClawLaunch bot runner starting...");
log(`Bot name: ${botName}`);
log(`Prefix: ${prefix}`);
log(`Provider: ${modelProvider}`);

if (!ClientCtor) {
  log("FATAL: Discord client constructor not found.");
  process.exit(1);
}

const client = new ClientCtor({
  intents: [
    INTENTS.Guilds,
    INTENTS.GuildMessages,
    INTENTS.MessageContent,
  ],
});

client.once("ready", () => {
  log(`Discord bot logged in as ${client.user?.tag}`);
});

client.on("error", (err) => {
  log(`Discord client error: ${err.message}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(" ");
    const command = (args.shift() || "").toLowerCase();

    log(`Command received: ${command}`);

    if (command === "ping") {
      await message.reply("pong");
      return;
    }

    if (command === "status") {
      await message.reply(
        `Bot: ${botName}\nProfile: ${config.profile}\nProvider: ${modelProvider}`
      );
      return;
    }

    if (command === "ask") {
      const prompt = args.join(" ").trim();

      if (!prompt) {
        await message.reply("Ask me something.");
        return;
      }

      await message.reply("Thinking...");

      try {
        const response = await askAI(prompt);
        await message.channel.send(response.slice(0, 1900));
      } catch (err) {
        const errorMessage =
          err?.message || "Unknown OpenAI error.";
        log(`ASK ERROR: ${errorMessage}`);

        if (err?.status) {
          log(`ASK ERROR STATUS: ${err.status}`);
        }

        if (err?.code) {
          log(`ASK ERROR CODE: ${err.code}`);
        }

        if (err?.error?.message) {
          log(`ASK ERROR DETAIL: ${err.error.message}`);
        }

        await message.channel.send(`!ask failed: ${errorMessage}`);
      }

      return;
    }

    if (command === "help") {
      await message.reply(
        [
          "Commands:",
          "!ping",
          "!status",
          "!ask <question>",
          "!help",
        ].join("\n")
      );
      return;
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    try {
      await message.reply("Something went wrong.");
    } catch {}
  }
});

client.login(discordToken).catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});

setInterval(() => {
  log("Runner heartbeat.");
}, 30000);