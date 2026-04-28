"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ---- Types ----

type Group = {
  id: string;
  group_jid: string;
  group_name: string;
  city: string | null;
};

type RawMessage = {
  id: string;
  group_jid: string;
  sender_jid: string;
  message_text: string;
  message_timestamp: string;
  processed: boolean;
  created_at: string;
  whatsapp_groups: { group_name: string; city: string | null } | null;
};

type DanceEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  venue: string | null;
  city: string | null;
  dance_styles: string[];
  ticket_price: string | null;
  extras: Record<string, unknown> | null;
};

// ---- Helpers ----

const STYLE_COLORS: Record<string, string> = {
  salsa:   "bg-red-900/60 text-red-300",
  bachata: "bg-pink-900/60 text-pink-300",
  zouk:    "bg-purple-900/60 text-purple-300",
  kizomba: "bg-orange-900/60 text-orange-300",
  tango:   "bg-amber-900/60 text-amber-300",
};

function sourceFromJid(jid: string): "telegram" | "whatsapp" {
  return jid.startsWith("tg_") ? "telegram" : "whatsapp";
}

function displayName(msg: RawMessage): string {
  const name = msg.whatsapp_groups?.group_name;
  if (!name || name === msg.group_jid) {
    return msg.group_jid
      .replace("tg_", "")
      .replace("@g.us", "")
      .replace("@s.whatsapp.net", "")
      .replace("@lid", "");
  }
  return name;
}

function relativeTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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

type TabId = "all" | "unassigned" | string; // string = city name

export default function TestPage() {
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [events, setEvents] = useState<DanceEvent[]>([]);
  const [unprocessedCount, setUnprocessedCount] = useState(0);
  const [listenerOnline, setListenerOnline] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState<{ count: number; eventCount: number } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");

  // Inline city creation state — per-group
  const [assigningGroup, setAssigningGroup] = useState<string | null>(null);
  const [newCityInput, setNewCityInput] = useState("");
  const newCityRef = useRef<HTMLInputElement>(null);

  // Load persisted events on mount
  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEvents(data); })
      .catch(() => {});
  }, []);

  // Poll DB messages + groups + listener health every 3s
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/test/messages");
      if (!res.ok) return;
      const data = await res.json();
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setUnprocessedCount(data.unprocessedCount ?? 0);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setListenerOnline(data.listenerOnline ?? false);
    } catch {
      // Supabase unreachable — leave state as-is
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  // Derived: distinct cities
  const cities = Array.from(
    new Set(groups.map((g) => g.city).filter((c): c is string => !!c))
  ).sort();

  const unassignedGroups = groups.filter((g) => !g.city);

  // Filter messages by active tab
  const visibleMessages = messages.filter((msg) => {
    const city = msg.whatsapp_groups?.city ?? null;
    if (activeTab === "all") return true;
    if (activeTab === "unassigned") return !city;
    return city === activeTab;
  });

  // Unprocessed count for the active tab
  const visibleUnprocessed = visibleMessages.filter((m) => !m.processed).length;

  // Filter events by active tab
  const visibleEvents = events.filter((ev) => {
    if (activeTab === "all") return true;
    if (activeTab === "unassigned") return !ev.city;
    return ev.city === activeTab;
  });

  // Process button
  async function handleProcess() {
    setProcessing(true);
    setLastProcessed(null);
    try {
      const body = activeTab === "all" || activeTab === "unassigned"
        ? {}
        : { city: activeTab };
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Processing failed");
        return;
      }
      if (Array.isArray(data.events)) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const fresh = data.events.filter((e: DanceEvent) => !existingIds.has(e.id));
          return [...prev, ...fresh].sort((a, b) => a.event_date.localeCompare(b.event_date));
        });
      }
      setLastProcessed({ count: data.processed, eventCount: data.events?.length ?? 0 });
      setUnprocessedCount(0);
    } finally {
      setProcessing(false);
    }
  }

  // Assign city to a group
  async function assignCity(groupId: string, city: string | null) {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city }),
    });
    if (res.ok) {
      const updated: Group = await res.json();
      setGroups((prev) => prev.map((g) => g.id === updated.id ? updated : g));
    }
    setAssigningGroup(null);
    setNewCityInput("");
  }

  function startNewCity(groupId: string) {
    setAssigningGroup(groupId);
    setNewCityInput("");
    setTimeout(() => newCityRef.current?.focus(), 50);
  }

  const grouped = groupEventsByDate(visibleEvents);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-mono">

      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4 sticky top-0 bg-gray-950 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-white">WCIDT · Test Dashboard</h1>
            <p className="text-xs text-gray-500 mt-0.5">WhatsApp + Telegram → DB → Extract → Events</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${listenerOnline ? "bg-green-400" : "bg-gray-600"}`} />
            <span className="text-xs text-gray-500">
              {listenerOnline ? "listener running" : "listener offline"}
            </span>
          </div>
        </div>
      </header>

      {/* City Tabs */}
      <div className="border-b border-gray-800 px-4">
        <div className="max-w-2xl mx-auto flex gap-1 overflow-x-auto">
          {(["all", ...cities, "unassigned"] as TabId[]).map((tab) => {
            const label =
              tab === "all" ? "All" :
              tab === "unassigned" ? `Unassigned${unassignedGroups.length > 0 ? ` (${unassignedGroups.length})` : ""}` :
              tab.charAt(0).toUpperCase() + tab.slice(1);
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-white text-white"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">

        {/* Process button — hidden on Unassigned tab */}
        {activeTab !== "unassigned" && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleProcess}
              disabled={processing || visibleUnprocessed === 0}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40
                bg-green-600 hover:bg-green-500 text-white disabled:cursor-not-allowed"
            >
              {processing
                ? "Processing…"
                : visibleUnprocessed > 0
                ? `Process ${visibleUnprocessed} new message${visibleUnprocessed !== 1 ? "s" : ""}${activeTab !== "all" ? ` (${activeTab})` : ""}`
                : "Nothing new to process"}
            </button>
            {lastProcessed && (
              <p className="text-xs text-gray-400">
                {lastProcessed.count} messages →{" "}
                <span className="text-green-400">{lastProcessed.eventCount} event{lastProcessed.eventCount !== 1 ? "s" : ""} found</span>
              </p>
            )}
          </div>
        )}

        {/* ── Unassigned Groups ── */}
        {activeTab === "unassigned" && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Unassigned Groups ({unassignedGroups.length})
            </h2>
            {unassignedGroups.length === 0 ? (
              <p className="text-sm text-gray-600 py-4">All groups have a city assigned.</p>
            ) : (
              <div className="space-y-2">
                {unassignedGroups.map((group) => (
                  <div key={group.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-white">{group.group_name === group.group_jid
                        ? group.group_jid.replace("tg_", "").replace("@g.us", "").replace("@s.whatsapp.net", "").replace("@lid", "")
                        : group.group_name}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">{group.group_jid}</p>
                    </div>

                    {assigningGroup === group.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Existing cities */}
                        {cities.length > 0 && (
                          <select
                            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) assignCity(group.id, e.target.value);
                            }}
                          >
                            <option value="" disabled>Pick city…</option>
                            {cities.map((c) => (
                              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                            ))}
                          </select>
                        )}
                        {/* New city inline */}
                        <input
                          ref={newCityRef}
                          type="text"
                          value={newCityInput}
                          onChange={(e) => setNewCityInput(e.target.value.toLowerCase())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newCityInput.trim()) assignCity(group.id, newCityInput.trim());
                            if (e.key === "Escape") { setAssigningGroup(null); setNewCityInput(""); }
                          }}
                          placeholder="new city…"
                          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 w-28 placeholder-gray-600"
                        />
                        {newCityInput.trim() && (
                          <button
                            onClick={() => assignCity(group.id, newCityInput.trim())}
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            Create
                          </button>
                        )}
                        <button
                          onClick={() => { setAssigningGroup(null); setNewCityInput(""); }}
                          className="text-xs text-gray-600 hover:text-gray-400"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startNewCity(group.id)}
                        className="text-xs text-gray-500 hover:text-gray-300 shrink-0 border border-gray-700 rounded px-2.5 py-1.5"
                      >
                        Assign city
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Events ── */}
        {activeTab !== "unassigned" && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Extracted Events
            </h2>

            {visibleEvents.length === 0 ? (
              <p className="text-sm text-gray-600 py-4">
                No events yet. Click Process once messages are in the DB.
              </p>
            ) : (
              <div className="space-y-6">
                {[...grouped.entries()].map(([date, dayEvents]) => (
                  <div key={date}>
                    <p className="text-xs text-gray-500 mb-2">{formatEventDate(date)}</p>
                    <div className="space-y-2">
                      {dayEvents.map((ev) => (
                        <div key={ev.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-semibold text-white text-sm">{ev.title}</p>
                            {ev.start_time && (
                              <span className="text-xs text-gray-400 shrink-0">{formatTime(ev.start_time)}</span>
                            )}
                          </div>
                          {ev.venue && <p className="text-xs text-gray-400 mt-0.5">{ev.venue}</p>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {ev.dance_styles.map((s) => (
                              <span key={s} className={`text-xs px-2 py-0.5 rounded capitalize ${STYLE_COLORS[s] ?? "bg-gray-800 text-gray-400"}`}>
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
        )}

        {/* ── Raw Messages ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
            Raw Messages ({visibleMessages.length})
          </h2>

          {visibleMessages.length === 0 && (
            <p className="text-sm text-gray-600 py-4">
              {activeTab === "unassigned"
                ? "No messages from unassigned groups."
                : activeTab === "all"
                ? <>No messages in DB yet.{" "}{!listenerOnline && <span>Start the listener: <code className="text-gray-500">cd listener && npm run dev:local</code></span>}</>
                : `No messages from ${activeTab} groups yet.`}
            </p>
          )}

          <div className="space-y-2">
            {visibleMessages.map((msg) => {
              const source = sourceFromJid(msg.group_jid);
              return (
                <div key={msg.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {source === "telegram"
                        ? <span className="text-blue-500 font-medium">TG</span>
                        : <span className="text-green-600 font-medium">WA</span>
                      }
                      <span className="text-gray-400">{displayName(msg)}</span>
                      {msg.whatsapp_groups?.city && (
                        <span className="text-gray-700">· {msg.whatsapp_groups.city}</span>
                      )}
                      {msg.processed && <span className="text-gray-700">· processed</span>}
                    </div>
                    <span className="text-gray-600" title={msg.created_at}>
                      {relativeTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">
                    {msg.message_text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </main>
  );
}
