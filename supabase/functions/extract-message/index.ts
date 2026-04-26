import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// Keyword filter — discard messages with no event signal before hitting Claude
const EVENT_PATTERNS = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i, // Dutch days
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i,
  /\b\d{1,2}[\/\-.]\d{1,2}\b/,
  /\b\d{1,2}(:\d{2})?\s*(pm|am|uur)\b/i,
  /\b(social|class|workshop|festival|party|night|evening)\b/i,
  /\b(salsa|bachata|zouk|kizomba|tango|dance|dancing)\b/i,
  /\b(cancelled|cancel|afgelast|afgestel|off|postponed|rescheduled|verzet)\b/i,
  /\b(tonight|vanavond|this week|deze week|morgen|tomorrow)\b/i,
];

function passesKeywordFilter(text: string): boolean {
  return EVENT_PATTERNS.some((re) => re.test(text));
}

type ExtractionResult = {
  event_type: "new_event" | "cancellation" | "reschedule" | "noise";
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  dance_styles: string[];
  confidence: number;
  notes: string | null;
};

async function extractWithClaude(
  messageText: string,
  messageTimestamp: string,
  groupName: string,
  city: string,
  organizerName: string | null
): Promise<ExtractionResult> {
  const today = new Date(messageTimestamp);
  const dateContext = today.toISOString().split("T")[0];

  const prompt = `Group: ${groupName} (${city})
Organizer: ${organizerName ?? "unknown"}
Message sent at: ${messageTimestamp} (use this to resolve relative dates like "this Saturday" or "vanavond")
Today's date for reference: ${dateContext}

Message:
${messageText}

Extract event information and return ONLY valid JSON with this exact shape:
{
  "event_type": "new_event" | "cancellation" | "reschedule" | "noise",
  "title": string | null,
  "date": "YYYY-MM-DD" | null,
  "start_time": "HH:MM" | null,
  "end_time": "HH:MM" | null,
  "venue": string | null,
  "dance_styles": string[],
  "confidence": number between 0.0 and 1.0,
  "notes": string | null
}

Rules:
- dance_styles values must be lowercase: "salsa", "bachata", "zouk", "kizomba", "tango"
- confidence reflects certainty that this describes a real event with a date
- For cancellations with no explicit date, infer "tonight" means the message date
- If the message is just chat/questions/reactions, use event_type "noise" with confidence < 0.3`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system:
      "You are an event extraction assistant for a social dance platform. Extract event info from WhatsApp messages. Return ONLY valid JSON, no other text.",
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip markdown code fences if model wraps the JSON
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned) as ExtractionResult;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();

    // Supabase DB webhook sends { type, table, record, old_record }
    const record = payload?.record;
    if (!record) {
      return new Response("No record in payload", { status: 400 });
    }

    const { id: messageId, group_jid, message_text, message_timestamp, processed, skipped } = record;

    if (processed || skipped) {
      return new Response("Already handled", { status: 200 });
    }

    // Keyword pre-filter — mark and skip noise without calling Claude
    if (!passesKeywordFilter(message_text)) {
      await supabase
        .from("raw_messages")
        .update({ skipped: true, processed: true })
        .eq("id", messageId);
      return new Response("Skipped (no event keywords)", { status: 200 });
    }

    // Fetch group metadata for context
    const { data: group } = await supabase
      .from("whatsapp_groups")
      .select("group_name, city, organizer_name")
      .eq("group_jid", group_jid)
      .single();

    if (!group) {
      await supabase
        .from("raw_messages")
        .update({ processed: true })
        .eq("id", messageId);
      return new Response("Group not found", { status: 200 });
    }

    let extraction: ExtractionResult;
    try {
      extraction = await extractWithClaude(
        message_text,
        message_timestamp,
        group.group_name,
        group.city,
        group.organizer_name
      );
    } catch (err) {
      console.error("Claude extraction failed:", err);
      // Don't mark processed — allow retry
      return new Response("Extraction failed", { status: 500 });
    }

    if (extraction.event_type === "noise" || extraction.confidence < 0.3) {
      await supabase
        .from("raw_messages")
        .update({ processed: true, skipped: true })
        .eq("id", messageId);
      return new Response("Noise — discarded", { status: 200 });
    }

    if (!extraction.date) {
      // Can't publish an event without a date — send to review
      await supabase.from("review_queue").insert({
        raw_message_id: messageId,
        extracted_data: extraction,
        reason: "no_date",
      });
      await supabase
        .from("raw_messages")
        .update({ processed: true })
        .eq("id", messageId);
      return new Response("Queued for review (no date)", { status: 200 });
    }

    if (extraction.confidence >= 0.8) {
      // Auto-publish
      await supabase.from("events").insert({
        source_message_id: messageId,
        title: extraction.title ?? "Dance Event",
        city: group.city,
        venue: extraction.venue,
        event_date: extraction.date,
        start_time: extraction.start_time,
        end_time: extraction.end_time,
        dance_styles: extraction.dance_styles,
        description: extraction.notes,
        organizer_name: group.organizer_name,
        status:
          extraction.event_type === "cancellation"
            ? "cancelled"
            : extraction.event_type === "reschedule"
            ? "rescheduled"
            : "active",
        confidence: extraction.confidence,
        published: extraction.event_type !== "cancellation",
      });
    } else {
      // Low confidence — queue for human review
      await supabase.from("review_queue").insert({
        raw_message_id: messageId,
        extracted_data: extraction,
        reason: "low_confidence",
      });
    }

    await supabase
      .from("raw_messages")
      .update({ processed: true })
      .eq("id", messageId);

    return new Response(
      JSON.stringify({ event_type: extraction.event_type, confidence: extraction.confidence }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
