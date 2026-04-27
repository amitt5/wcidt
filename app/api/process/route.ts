import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow up to 60s for the Claude call

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ExtractedEvent = {
  event_name: string | null;
  date: string | null;        // YYYY-MM-DD
  time: string | null;        // HH:MM
  location: string | null;
  styles: string[];
  ticket_price: string | null;
  others: Record<string, unknown>;
};

export async function POST() {
  const supabase = createServiceClient();

  // 1. Fetch unprocessed messages with their group info
  const { data: rows, error } = await supabase
    .from("raw_messages")
    .select("id, message_text, message_timestamp, group_jid, whatsapp_groups(group_name, city)")
    .eq("processed", false)
    .order("message_timestamp", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ processed: 0, events: [] });
  }

  // 2. Format messages for Claude
  const messageIds = rows.map((r: { id: string }) => r.id);
  const today = new Date().toISOString().split("T")[0];

  type RawRow = {
    message_timestamp: string;
    group_jid: string;
    message_text: string;
    whatsapp_groups: { group_name: string }[] | { group_name: string } | null;
  };

  const formatted = (rows as RawRow[])
    .map((r) => {
      const ts = new Date(r.message_timestamp).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      const group = Array.isArray(r.whatsapp_groups)
        ? r.whatsapp_groups[0]
        : r.whatsapp_groups;
      const groupName = group?.group_name ?? r.group_jid;
      return `[${ts}] ${groupName}\n${r.message_text}`;
    })
    .join("\n\n---\n\n");

  // 3. Call Claude
  const systemPrompt = `You extract dance events from WhatsApp messages.
Return ONLY a valid JSON array. No markdown, no explanation, just JSON.
Today's date is ${today}. Resolve relative dates ("this Saturday", "vanavond") from the message timestamp shown.
If there are no events in the messages, return an empty array [].`;

  const userPrompt = `These are WhatsApp messages from Amsterdam dance groups. Extract all dance events.

${formatted}

Return a JSON array where each event has exactly these fields:
{
  "event_name": string or null,
  "date": "YYYY-MM-DD" or null,
  "time": "HH:MM" or null,
  "location": string or null,
  "styles": array of strings from ["salsa","bachata","zouk","kizomba","tango"] (empty array if unknown),
  "ticket_price": string or null,
  "others": object with any other relevant details (organizer, description, url, etc.)
}

Only include real events. Skip chat messages, questions, reactions, and spam.`;

  let extracted: ExtractedEvent[] = [];
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    extracted = JSON.parse(cleaned);
    if (!Array.isArray(extracted)) extracted = [];
  } catch (err) {
    console.error("Claude extraction failed:", err);
    return NextResponse.json({ error: "Extraction failed — check ANTHROPIC_API_KEY" }, { status: 500 });
  }

  // 4. Insert valid events into DB
  const insertedEvents = [];
  for (const ev of extracted) {
    if (!ev.event_name && !ev.date) continue; // skip completely empty

    const { data: inserted, error: insertError } = await supabase
      .from("events")
      .insert({
        title: ev.event_name ?? "Dance Event",
        city: "amsterdam",
        venue: ev.location,
        event_date: ev.date ?? today,
        start_time: ev.time,
        dance_styles: ev.styles ?? [],
        ticket_price: ev.ticket_price,
        extras: ev.others ?? {},
        confidence: 1.0,
        published: true,
        status: "active",
      })
      .select()
      .single();

    if (!insertError && inserted) {
      insertedEvents.push(inserted);
    }
  }

  // 5. Mark all fetched messages as processed
  await supabase
    .from("raw_messages")
    .update({ processed: true })
    .in("id", messageIds);

  return NextResponse.json({
    processed: messageIds.length,
    events: insertedEvents,
  });
}
