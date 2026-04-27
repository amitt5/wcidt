import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { useSupabaseAuthState } from "./auth-state";
import { startHealthServer } from "./health";

const logger = pino({ level: "info" });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Loaded once on startup — groups we're monitoring
let trackedGroups: Set<string> = new Set();

async function loadTrackedGroups() {
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("group_jid");

  if (error) {
    logger.error({ error }, "Failed to load tracked groups");
    return;
  }

  trackedGroups = new Set((data ?? []).map((r: { group_jid: string }) => r.group_jid));
  logger.info({ count: trackedGroups.size }, "Loaded tracked groups");
}

async function connectToWhatsApp() {
  await loadTrackedGroups();

  const { state, saveCreds } = await useSupabaseAuthState(supabase);

  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, "Using Baileys version");

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }) as Parameters<typeof makeWASocket>[0]["logger"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as Parameters<typeof makeWASocket>[0]["logger"]),
    },
    printQRInTerminal: true,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Scan the QR code above with your WhatsApp to connect");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.info({ statusCode, shouldReconnect }, "Connection closed");

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        logger.error("Logged out — delete auth state from Supabase and restart");
        process.exit(1);
      }
    } else if (connection === "open") {
      logger.info("WhatsApp connected");
      // Reload groups in case they were updated while disconnected
      await loadTrackedGroups();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip messages we sent
      const groupJid = msg.key.remoteJid;
      if (!groupJid || !groupJid.endsWith("@g.us")) continue;

      // Log all group JIDs we see — useful for initial setup to find your group's JID
      if (!trackedGroups.has(groupJid)) {
        logger.info({ groupJid, groupName: msg.pushName }, "Untracked group message (JID logged for setup)");
        continue;
      }

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        null;

      if (!text || text.trim().length < 5) continue;

      const senderJid = msg.key.participant || msg.key.remoteJid || "";
      const messageTimestamp = new Date(
        (typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp)) * 1000
      ).toISOString();

      const { error } = await supabase.from("raw_messages").insert({
        group_jid: groupJid,
        sender_jid: senderJid,
        message_text: text.trim(),
        message_timestamp: messageTimestamp,
      });

      if (error) {
        logger.error({ error, groupJid }, "Failed to insert raw message");
      } else {
        logger.info({ groupJid, preview: text.slice(0, 60) }, "Message stored");
      }
    }
  });
}

startHealthServer(Number(process.env.PORT) || 3001);
connectToWhatsApp().catch((err) => {
  logger.error(err, "Fatal error");
  process.exit(1);
});
