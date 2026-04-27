"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Types ----

type RawMessage = {
  id: string;
  groupJid: string;
  senderJid: string;
  text: string;
  timestamp: string;
  receivedAt: string;
  savedToDb: boolean;
};

type DanceEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  venue: string | null;
  dance_styles: string[];
  ticket_price: string | null;
  extras: Record<string, unknown> | null;
  city: string;
};

// ---- Helpers ----

const STYLE_COLORS: Record<string, string> = {
  salsa:   "bg-red-900/60 text-red-300",
  bachata: "bg-pink-900/60 text-pink-300",
  zouk:    "bg-purple-900/60 text-purple-300",
  kizomba: "bg-orange-900/60 text-orange-300",
  tango:   "bg-amber-900/60 text-amber-300",
};

function shortJid(jid: string) {
  return jid.replace("@g.us", "").replace("@s.whatsapp.net", "");
}

function relativeTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatEventDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function formatTime(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 || 12;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}

function groupEventsByDate(events: DanceEvent[]): Map<string, DanceEvent[]> {
  const map = new Map<string, DanceEvent[]>();
  for (const e of events) {
    const list = map.get(e.event_date) ?? [];
    list.push(e);
    map.set(e.event_date, list);
  }
  return map;
}

// ---- Component ----

export default function TestPage() {
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [events, setEvents] = useState<DanceEvent[]>([]);
  const [unprocessedCount, setUnprocessedCount] = useState(0);
  const [listenerStatus, setListenerStatus] = useState<"ok" | "error" | "connecting">("connecting");
  const [listenerError, setListenerError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState<{ count: number; eventCount: number } | null>(null);

  // Load persisted events from DB on mount
  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEvents(data); })
      .catch(() => {});
  }, []);

  // Poll listener for raw messages + unprocessed count
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/test/messages");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setListenerError(body.error ?? `HTTP ${res.status}`);
        setListenerStatus("error");
        return;
      }
      const data = await res.json();
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setUnprocessedCount(data.unprocessedCount ?? 0);
      setListenerStatus("ok");
    } catch {
      setListenerError("Could not reach the API route");
      setListenerStatus("error");
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  // Process button handler
  async function handleProcess() {
    setProcessing(true);
    setLastProcessed(null);
    try {
      const res = await fetch("/api/process", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Processing failed");
        return;
      }
      if (Array.isArray(data.events)) {
        setEvents((prev) => {
          // Merge new events (avoid dupes by id)
          const existingIds = new Set(prev.map((e) => e.id));
          const fresh = data.events.filter((e: DanceEvent) => !existingIds.has(e.id));
          return [...prev, ...fresh].sort((a, b) =>
            a.event_date.localeCompare(b.event_date)
          );
        });
      }
      setLastProcessed({ count: data.processed, eventCount: data.events?.length ?? 0 });
      setUnprocessedCount(0);
    } finally {
      setProcessing(false);
    }
  }

  const grouped = groupEventsByDate(events);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-mono">

      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4 sticky top-0 bg-gray-950 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-white">WCIDT · Test Dashboard</h1>
            <p className="text-xs text-gray-500 mt-0.5">Amsterdam · WhatsApp → DB → Extract → Events</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              listenerStatus === "ok" ? "bg-green-400" :
              listenerStatus === "error" ? "bg-red-400" :
              "bg-yellow-400 animate-pulse"
            }`} />
            <span className="text-xs text-gray-400 hidden sm:inline">
              {listenerStatus === "ok" ? "listener connected" :
               listenerStatus === "error" ? "listener offline" : "connecting…"}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">

        {/* Process button */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleProcess}
            disabled={processing || unprocessedCount === 0}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40
              bg-green-600 hover:bg-green-500 text-white disabled:cursor-not-allowed"
          >
            {processing
              ? "Processing…"
              : unprocessedCount > 0
              ? `Process ${unprocessedCount} new message${unprocessedCount !== 1 ? "s" : ""}`
              : "Nothing new to process"}
          </button>
          {lastProcessed && (
            <p className="text-xs text-gray-400">
              Processed {lastProcessed.count} messages →{" "}
              <span className="text-green-400">{lastProcessed.eventCount} event{lastProcessed.eventCount !== 1 ? "s" : ""} found</span>
            </p>
          )}
        </div>

        {/* Listener error */}
        {listenerStatus === "error" && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-sm text-red-300">
            <p className="font-semibold mb-1">Listener not running</p>
            <p className="text-red-400 mb-3 text-xs">{listenerError}</p>
            <code className="text-xs text-red-400 bg-red-900/50 rounded px-3 py-2 block">
              cd listener && npm run dev:local
            </code>
          </div>
        )}

        {/* ── Events ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
            Extracted Events
          </h2>

          {events.length === 0 ? (
            <p className="text-sm text-gray-600 py-4">
              No events yet. Once messages are in DB, click the Process button above.
            </p>
          ) : (
            <div className="space-y-6">
              {[...grouped.entries()].map(([date, dayEvents]) => (
                <div key={date}>
                  <p className="text-xs text-gray-500 mb-2">{formatEventDate(date)}</p>
                  <div className="space-y-2">
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-white text-sm">{ev.title}</p>
                          {ev.start_time && (
                            <span className="text-xs text-gray-400 shrink-0">
                              {formatTime(ev.start_time)}
                            </span>
                          )}
                        </div>
                        {ev.venue && (
                          <p className="text-xs text-gray-400 mt-0.5">{ev.venue}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ev.dance_styles.map((s) => (
                            <span
                              key={s}
                              className={`text-xs px-2 py-0.5 rounded capitalize ${STYLE_COLORS[s] ?? "bg-gray-800 text-gray-400"}`}
                            >
                              {s}
                            </span>
                          ))}
                          {ev.ticket_price && (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                              {ev.ticket_price}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Raw Messages ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
            Raw Messages ({messages.length})
          </h2>

          {messages.length === 0 && listenerStatus === "ok" && (
            <p className="text-sm text-gray-600 py-4">
              Listener running. Send a message to a WhatsApp group you&apos;re in.
            </p>
          )}

          <div className="space-y-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="text-gray-400">{shortJid(msg.groupJid)}</span>
                  <div className="flex items-center gap-2">
                    {msg.savedToDb && (
                      <span className="text-green-600 text-xs">saved</span>
                    )}
                    <span title={msg.receivedAt}>{relativeTime(msg.receivedAt)}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
