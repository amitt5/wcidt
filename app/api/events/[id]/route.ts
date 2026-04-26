import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get("admin_token")?.value === process.env.ADMIN_SECRET;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { action } = await req.json() as { action: "approve" | "reject" };

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (action === "reject") {
    await supabase
      .from("review_queue")
      .update({ status: "rejected" })
      .eq("id", id);
    return NextResponse.json({ ok: true });
  }

  // Approve: fetch queue item + create event
  const { data: queueItem, error } = await supabase
    .from("review_queue")
    .select("*, raw_messages(group_jid, whatsapp_groups(city, organizer_name))")
    .eq("id", id)
    .single();

  if (error || !queueItem) {
    return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  }

  const ex = queueItem.extracted_data;
  const group = queueItem.raw_messages?.whatsapp_groups;

  if (!ex.date) {
    return NextResponse.json({ error: "No date in extracted data" }, { status: 422 });
  }

  await supabase.from("events").insert({
    source_message_id: queueItem.raw_message_id,
    title: ex.title ?? "Dance Event",
    city: group?.city ?? "amsterdam",
    venue: ex.venue,
    event_date: ex.date,
    start_time: ex.start_time,
    end_time: ex.end_time,
    dance_styles: ex.dance_styles ?? [],
    description: ex.notes,
    organizer_name: group?.organizer_name ?? null,
    status:
      ex.event_type === "cancellation"
        ? "cancelled"
        : ex.event_type === "reschedule"
        ? "rescheduled"
        : "active",
    confidence: ex.confidence,
    published: ex.event_type !== "cancellation",
  });

  await supabase
    .from("review_queue")
    .update({ status: "approved" })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
