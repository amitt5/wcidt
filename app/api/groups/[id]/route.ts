import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createServiceClient();
  const { id } = await params;
  const body = await req.json();
  const city: string | null = body.city ?? null;

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .update({ city })
    .eq("id", id)
    .select("id, group_jid, group_name, city")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
