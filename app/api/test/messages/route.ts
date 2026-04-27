import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function fetchListener(port: number) {
  const res = await fetch(`http://localhost:${port}/messages`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`port ${port} responded ${res.status}`);
  return res.json();
}

export async function GET() {
  // Fetch from both listeners and DB count in parallel — each is optional
  const [waResult, tgResult, dbResult] = await Promise.allSettled([
    fetchListener(3001),
    fetchListener(3002),
    createServiceClient()
      .from("raw_messages")
      .select("id", { count: "exact", head: true })
      .eq("processed", false),
  ]);

  const waMessages = waResult.status === "fulfilled" ? waResult.value : [];
  const tgMessages = tgResult.status === "fulfilled" ? tgResult.value : [];

  if (waMessages.length === 0 && tgMessages.length === 0 && waResult.status === "rejected") {
    return NextResponse.json(
      { error: "Listener not reachable — is it running? (cd listener && npm run dev:local)" },
      { status: 503 }
    );
  }

  // Tag each message with its source if not already tagged
  const tagged = [
    ...waMessages.map((m: Record<string, unknown>) => ({ source: "whatsapp", ...m })),
    ...tgMessages.map((m: Record<string, unknown>) => ({ source: "telegram", ...m })),
  ].sort(
    (a, b) =>
      new Date(b.receivedAt as string).getTime() -
      new Date(a.receivedAt as string).getTime()
  );

  const unprocessedCount =
    dbResult.status === "fulfilled" ? (dbResult.value.count ?? 0) : 0;

  return NextResponse.json({ messages: tagged, unprocessedCount });
}
