"use client";

import { useEffect, useState, useCallback } from "react";

type Message = {
  id: string;
  groupJid: string;
  senderJid: string;
  text: string;
  timestamp: string;
  receivedAt: string;
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

export default function TestPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"connecting" | "ok" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastPoll, setLastPoll] = useState<Date | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/test/messages");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }
      const data: Message[] = await res.json();
      setMessages(data);
      setStatus("ok");
      setLastPoll(new Date());
    } catch {
      setErrorMsg("Could not reach the API route");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <header className="border-b border-gray-800 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-white">WCIDT · Local Test</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              WhatsApp → Listener (port 3001) → this page · polls every 3s
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                status === "ok"
                  ? "bg-green-400"
                  : status === "error"
                  ? "bg-red-400"
                  : "bg-yellow-400 animate-pulse"
              }`}
            />
            <span className="text-gray-400">
              {status === "ok"
                ? `${messages.length} messages`
                : status === "error"
                ? "listener offline"
                : "connecting…"}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {status === "error" && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-sm text-red-300">
            <p className="font-semibold mb-1">Listener not running</p>
            <p className="text-red-400 mb-3">{errorMsg}</p>
            <p className="text-xs text-red-500 font-mono bg-red-900/50 rounded px-3 py-2">
              cd listener && npm run dev:local
            </p>
          </div>
        )}

        {status === "ok" && messages.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <p>Listener is running. Waiting for messages…</p>
            <p className="text-xs mt-1">
              Send something to a WhatsApp group you&apos;re in.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 space-y-1"
          >
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                {msg.groupJid.endsWith("@g.us") ? "group" : "dm"}{" "}
                <span className="text-gray-400">{shortJid(msg.groupJid)}</span>
              </span>
              <span title={msg.receivedAt}>{relativeTime(msg.receivedAt)}</span>
            </div>
            <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">
              {msg.text}
            </p>
            <p className="text-xs text-gray-600">from {shortJid(msg.senderJid)}</p>
          </div>
        ))}

        {lastPoll && status === "ok" && (
          <p className="text-xs text-center text-gray-700 pt-2">
            last updated {lastPoll.toLocaleTimeString()}
          </p>
        )}
      </div>
    </main>
  );
}
