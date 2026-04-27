import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fetch in-memory messages from listener and unprocessed count from DB in parallel
  const [listenerResult, dbResult] = await Promise.allSettled([
    fetch("http://localhost:3001/messages", {
      signal: AbortSignal.timeout(2000),
    }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    createServiceClient()
      .from("raw_messages")
      .select("id", { count: "exact", head: true })
      .eq("processed", false),
  ]);

  if (listenerResult.status === "rejected") {
    return NextResponse.json(
      { error: "Listener not reachable — is it running? (cd listener && npm run dev:local)" },
      { status: 503 }
    );
  }

  const unprocessedCount =
    dbResult.status === "fulfilled" ? (dbResult.value.count ?? 0) : 0;

  return NextResponse.json({
    messages: listenerResult.value,
    unprocessedCount,
  });
}
