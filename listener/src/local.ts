/**
 * Local mode — no Claude API.
 * Auth state stored in listener/auth_info/ (gitignored).
 * ALL group messages saved to Supabase raw_messages (groups auto-registered).
 * Messages also kept in memory, served at GET /messages on port 3001.
 * Run: npm run dev:local
 */
import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createServer } from "http";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ transport: { target: "pino-pretty" } });

// --- Supabase (optional) ---

let supabase: SupabaseClient | null = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  logger.info("Supabase configured — all group messages will be saved to DB");
} else {
  logger.warn("No Supabase env vars — running memory-only (messages won't persist)");
}

async function saveToDb(
  groupJid: string,
  senderJid: string,
  text: string,
  messageTimestamp: string
): Promise<boolean> {
  if (!supabase) return false;

  // Auto-register the chat if we haven't seen it before
  const isGroup = groupJid.endsWith("@g.us");
  await supabase
    .from("whatsapp_groups")
    .upsert({
      group_jid: groupJid,
      group_name: isGroup ? groupJid : `DM (${groupJid})`,
      city: "amsterdam",
    }, {
      onConflict: "group_jid",
      ignoreDuplicates: true,
    });

  const { error } = await supabase.from("raw_messages").insert({
    group_jid: groupJid,
    sender_jid: senderJid,
    message_text: text,
    message_timestamp: messageTimestamp,
  });

  if (error) {
    logger.error({ error, groupJid }, "DB insert failed");
    return false;
  }
  return true;
}

// --- In-memory store (for /test page) ---

type StoredMessage = {
  id: string;
  groupJid: string;
  senderJid: string;
  text: string;
  timestamp: string;
  receivedAt: string;
  savedToDb: boolean;
};

const messages: StoredMessage[] = [];
const MAX_MESSAGES = 200;

function addMessage(msg: StoredMessage) {
  messages.unshift(msg);
  if (messages.length > MAX_MESSAGES) messages.pop();
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

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => logger.info(`HTTP server on port ${PORT}`));

// --- WhatsApp ---

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }) as Parameters<typeof makeWASocket>[0]["logger"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({ level: "silent" }) as Parameters<typeof makeWASocket>[0]["logger"]
      ),
    },
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      logger.info("👆 Scan the QR code in WhatsApp → Settings → Linked Devices → Link a Device");
    }
    if (connection === "open") {
      logger.info("✅ WhatsApp connected");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      logger.info({ code }, reconnect ? "Reconnecting…" : "Logged out");
      if (reconnect) setTimeout(connect, 3000);
      else process.exit(1);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages: incoming, type }) => {
    // Debug: log every upsert before any filtering
    logger.info(
      { type, count: incoming.length, jids: incoming.map((m) => m.key.remoteJid) },
      "messages.upsert fired"
    );

    if (type !== "notify") return;

    for (const msg of incoming) {
      const jid = msg.key.remoteJid ?? "";
      logger.info({ jid, fromMe: msg.key.fromMe }, "checking message");

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        null;

      if (!text || text.trim().length < 2) continue;

      const senderJid = msg.key.participant || jid;
      const messageTimestamp = new Date(
        (typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp)) * 1000
      ).toISOString();

      const savedToDb = await saveToDb(jid, senderJid, text.trim(), messageTimestamp);

      addMessage({
        id: msg.key.id ?? Date.now().toString(),
        groupJid: jid,
        senderJid,
        text: text.trim(),
        timestamp: messageTimestamp,
        receivedAt: new Date().toISOString(),
        savedToDb,
      });

      logger.info({ jid, savedToDb, preview: text.slice(0, 80) }, "Message received");
    }
  });
}

connect().catch((err) => {
  logger.error(err, "Fatal");
  process.exit(1);
});
