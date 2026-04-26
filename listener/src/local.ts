/**
 * Local test mode — no Supabase, no Claude API.
 * Auth state stored in listener/auth_info/ (gitignored).
 * Messages kept in memory, served at GET /messages on port 3001.
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
import { createServer } from "http";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ transport: { target: "pino-pretty" } });

type StoredMessage = {
  id: string;
  groupJid: string;
  senderJid: string;
  text: string;
  timestamp: string;
  receivedAt: string;
};

const messages: StoredMessage[] = [];
const MAX_MESSAGES = 200;

function addMessage(msg: StoredMessage) {
  messages.unshift(msg); // newest first
  if (messages.length > MAX_MESSAGES) messages.pop();
}

// HTTP server: Next.js fetches from here
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
server.listen(PORT, () => logger.info(`Listener HTTP server on port ${PORT}`));

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
      logger.info("👆 Scan the QR code above in WhatsApp → Settings → Linked Devices → Link a Device");
    }
    if (connection === "open") {
      logger.info("✅ WhatsApp connected — send a message to any group you're in");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      logger.info({ code }, reconnect ? "Reconnecting…" : "Logged out");
      if (reconnect) setTimeout(connect, 3000);
      else process.exit(1);
    }
  });

  sock.ev.on("messages.upsert", ({ messages: incoming, type }) => {
    if (type !== "notify") return;

    for (const msg of incoming) {
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid ?? "";
      const isGroup = jid.endsWith("@g.us");

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        null;

      if (!text || text.trim().length < 2) continue;

      const stored: StoredMessage = {
        id: msg.key.id ?? Date.now().toString(),
        groupJid: jid,
        senderJid: msg.key.participant || jid,
        text: text.trim(),
        timestamp: new Date(
          (typeof msg.messageTimestamp === "number"
            ? msg.messageTimestamp
            : Number(msg.messageTimestamp)) * 1000
        ).toISOString(),
        receivedAt: new Date().toISOString(),
      };

      addMessage(stored);

      logger.info(
        { jid, isGroup, preview: text.slice(0, 80) },
        isGroup ? "Group message" : "DM"
      );
    }
  });
}

connect().catch((err) => {
  logger.error(err, "Fatal");
  process.exit(1);
});
