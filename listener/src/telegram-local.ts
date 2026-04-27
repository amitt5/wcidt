/**
 * Telegram local mode — no Claude/OpenAI API.
 * Session stored in listener/telegram_session.txt (gitignored).
 * ALL group/channel messages saved to Supabase raw_messages.
 * Messages also kept in memory, served at GET /messages on port 3002.
 * Run: npm run dev:telegram
 *
 * First run: you'll be prompted for phone number + verification code.
 * Subsequent runs: reuses saved session automatically.
 *
 * Get TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org/apps
 */
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createServer } from "http";
import * as fs from "fs";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import pino from "pino";

const logger = pino({ transport: { target: "pino-pretty" } });
const SESSION_FILE = "telegram_session.txt";
const PORT = Number(process.env.TELEGRAM_PORT) || 3002;

// --- Supabase ---

let supabase: SupabaseClient | null = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  logger.info("Supabase configured — messages will be saved to DB");
} else {
  logger.warn("No Supabase env vars — running memory-only mode");
}

async function saveToDb(
  groupJid: string,
  senderJid: string,
  text: string,
  timestamp: string
): Promise<boolean> {
  if (!supabase) return false;

  await supabase
    .from("whatsapp_groups")
    .upsert(
      { group_jid: groupJid, group_name: groupJid, city: "amsterdam" },
      { onConflict: "group_jid", ignoreDuplicates: true }
    );

  const { error } = await supabase.from("raw_messages").insert({
    group_jid: groupJid,
    sender_jid: senderJid,
    message_text: text,
    message_timestamp: timestamp,
  });

  if (error) {
    logger.error({ error, groupJid }, "DB insert failed");
    return false;
  }
  return true;
}

// --- In-memory store ---

type StoredMessage = {
  id: string;
  groupJid: string;
  senderJid: string;
  text: string;
  timestamp: string;
  receivedAt: string;
  savedToDb: boolean;
  source: "telegram";
};

const messages: StoredMessage[] = [];

function addMessage(msg: StoredMessage) {
  messages.unshift(msg);
  if (messages.length > 200) messages.pop();
}

// --- HTTP server ---

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200);
    res.end("OK");
    return;
  }

  if (req.url === "/messages" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => logger.info(`Telegram HTTP server on port ${PORT}`));

// --- Interactive prompt for first-time auth ---

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// --- Telegram connection ---

async function connect() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";

  if (!apiId || !apiHash) {
    logger.error(
      "Missing TELEGRAM_API_ID or TELEGRAM_API_HASH — get them from https://my.telegram.org/apps"
    );
    process.exit(1);
  }

  const sessionStr = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, "utf-8").trim()
    : "";

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      if (process.env.TELEGRAM_PHONE) return process.env.TELEGRAM_PHONE;
      return prompt("📱 Phone number (with country code, e.g. +31612345678): ");
    },
    password: async () => prompt("🔑 2FA password (press Enter if none): "),
    phoneCode: async () => prompt("📩 Verification code from Telegram: "),
    onError: (err) => logger.error({ err }, "Auth error"),
  });

  // Persist session so next run skips the auth prompts
  fs.writeFileSync(SESSION_FILE, String(client.session.save()));
  logger.info("✅ Telegram connected — session saved to telegram_session.txt");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.addEventHandler(async (event: any) => {
    const msg = event.message;
    if (!msg?.text || msg.text.trim().length < 2) return;

    const chatId = msg.chatId?.toString() ?? "unknown";
    const jid = `tg_${chatId}`;
    const senderJid = msg.senderId?.toString() ?? "unknown";
    const timestamp = new Date(msg.date * 1000).toISOString();
    const text = msg.text.trim();

    const savedToDb = await saveToDb(jid, senderJid, text, timestamp);

    addMessage({
      id: String(msg.id),
      groupJid: jid,
      senderJid,
      text,
      timestamp,
      receivedAt: new Date().toISOString(),
      savedToDb,
      source: "telegram",
    });

    logger.info(
      {
        chatId,
        isGroup: msg.isGroup,
        isChannel: msg.isChannel,
        savedToDb,
        preview: text.slice(0, 80),
      },
      "Telegram message"
    );
  }, new NewMessage({}));

  logger.info("Listening for new Telegram messages — send something to any group you're in");

  // Keep the process alive
  await new Promise(() => {});
}

connect().catch((err) => {
  logger.error(err, "Fatal");
  process.exit(1);
});
