"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewQueueItem } from "@/lib/types";

export default function ReviewCard({ item }: { item: ReviewQueueItem }) {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const router = useRouter();

  const msg = item.raw_messages;
  const group = msg?.whatsapp_groups;
  const ex = item.extracted_data;

  async function act(action: "approve" | "reject") {
    setLoading(action);
    await fetch(`/api/events/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4">
      {/* Source message */}
      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-xs text-gray-400 mb-1">
          {group?.group_name} · {group?.city} ·{" "}
          {new Date(msg?.message_timestamp).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg?.message_text}</p>
      </div>

      {/* Extracted data */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Type" value={ex.event_type} />
        <Row label="Confidence" value={`${Math.round(ex.confidence * 100)}%`} />
        <Row label="Title" value={ex.title} />
        <Row label="Date" value={ex.date} />
        <Row label="Time" value={ex.start_time ?? null} />
        <Row label="Venue" value={ex.venue} />
        <Row
          label="Styles"
          value={ex.dance_styles.length ? ex.dance_styles.join(", ") : null}
        />
        {ex.notes && <Row label="Notes" value={ex.notes} span />}
      </div>

      {/* Reason tag */}
      <p className="text-xs text-gray-400">
        Reason: <span className="font-medium">{item.reason}</span>
      </p>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={() => act("approve")}
          disabled={!!loading}
          className="flex-1 bg-gray-900 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-gray-700"
        >
          {loading === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={!!loading}
          className="flex-1 bg-white border border-gray-200 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-gray-50"
        >
          {loading === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  span,
}: {
  label: string;
  value: string | null | undefined;
  span?: boolean;
}) {
  if (!value) return null;
  return (
    <>
      <span className={`text-gray-400 ${span ? "col-span-2" : ""}`}>{label}</span>
      <span className={`text-gray-900 ${span ? "col-span-2 -mt-4" : ""}`}>{value}</span>
    </>
  );
}
