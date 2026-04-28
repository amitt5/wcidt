import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ExtractedEvent = {
  event_name: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  styles: string[];
  ticket_price: string | null;
  others: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();

  const body = await req.json().catch(() => ({}));
  const cityFilter: string | null = body.city ?? null;

  // 1. Fetch unprocessed messages with their group info
  let query = supabase
    .from("raw_messages")
    .select("id, message_text, message_timestamp, group_jid, whatsapp_groups(group_name, city)")
    .eq("processed", false)
    .order("message_timestamp", { ascending: true })
    .limit(200);

  if (cityFilter) {
    // Filter to messages whose group is assigned to the selected city
    const { data: groupJids } = await supabase
      .from("whatsapp_groups")
      .select("group_jid")
      .eq("city", cityFilter);
    const jids = (groupJids ?? []).map((g: { group_jid: string }) => g.group_jid);
    if (jids.length === 0) {
      return NextResponse.json({ processed: 0, events: [] });
    }
    query = query.in("group_jid", jids);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ processed: 0, events: [] });
  }

  // 2. Format messages for the LLM
  const messageIds = rows.map((r: { id: string }) => r.id);
  const today = new Date().toISOString().split("T")[0];

  type RawRow = {
    id: string;
    message_timestamp: string;
    group_jid: string;
    message_text: string;
    whatsapp_groups: { group_name: string; city: string | null }[] | { group_name: string; city: string | null } | null;
  };

  // Build a per-message map of group city for use when inserting events
  const messageGroupCity = new Map<string, string | null>();

  const formatted = (rows as RawRow[])
    .map((r) => {
      const ts = new Date(r.message_timestamp).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      const group = Array.isArray(r.whatsapp_groups)
        ? r.whatsapp_groups[0]
        : r.whatsapp_groups;
      const groupName = group?.group_name ?? r.group_jid;
      messageGroupCity.set(r.id, group?.city ?? null);
      return `[${ts}] ${groupName}\n${r.message_text}`;
    })
    .join("\n\n---\n\n");

  const cityLabel = cityFilter ?? "unknown city";

  // 3. Call OpenAI — JSON mode requires the response to be an object, so we wrap in { events: [] }
  const systemPrompt = `You extract dance events from WhatsApp messages.
Return ONLY valid JSON in the format: { "events": [...] }
Today's date is ${today}. Resolve relative dates ("this Saturday", "vanavond") from the message timestamp shown.
If there are no events, return { "events": [] }.`;

  const userPrompt = `These are WhatsApp messages from ${cityLabel} dance groups. Extract all dance events.

${formatted}

Return { "events": [...] } where each event has exactly these fields:
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
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.choices[0].message.content ?? '{"events":[]}';
    const parsed = JSON.parse(text);
    extracted = Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    console.error("OpenAI extraction failed:", err);
    return NextResponse.json({ error: "Extraction failed — check OPENAI_API_KEY" }, { status: 500 });
  }

  // 4. Insert valid events into DB
  const insertedEvents = [];
  for (const ev of extracted) {
    if (!ev.event_name && !ev.date) continue;

    const { data: inserted, error: insertError } = await supabase
      .from("events")
      .insert({
        title: ev.event_name ?? "Dance Event",
        city: cityFilter ?? "unknown",
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
