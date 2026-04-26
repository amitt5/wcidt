import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("http://localhost:3001/messages", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`Listener responded ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Listener not reachable — is it running? (cd listener && npm run dev:local)" },
      { status: 503 }
    );
  }
}
