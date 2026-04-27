import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("published", true)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
