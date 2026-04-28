import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function checkListenerHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = createServiceClient();

  const [messagesResult, unprocessedResult, groupsResult, waOnline, tgOnline] =
    await Promise.allSettled([
      supabase
        .from("raw_messages")
        .select("*, whatsapp_groups(group_name, city)")
        .order("message_timestamp", { ascending: false })
        .limit(200),
      supabase
        .from("raw_messages")
        .select("id", { count: "exact", head: true })
        .eq("processed", false),
      supabase
        .from("whatsapp_groups")
        .select("id, group_jid, group_name, city")
        .order("group_name"),
      checkListenerHealth(3001),
      checkListenerHealth(3002),
    ]);

  const messages =
    messagesResult.status === "fulfilled"
      ? (messagesResult.value.data ?? [])
      : [];

  const unprocessedCount =
    unprocessedResult.status === "fulfilled"
      ? (unprocessedResult.value.count ?? 0)
      : 0;

  const groups =
    groupsResult.status === "fulfilled"
      ? (groupsResult.value.data ?? [])
      : [];

  const listenerOnline =
    (waOnline.status === "fulfilled" && waOnline.value) ||
    (tgOnline.status === "fulfilled" && tgOnline.value);

  return NextResponse.json({ messages, unprocessedCount, groups, listenerOnline });
}
