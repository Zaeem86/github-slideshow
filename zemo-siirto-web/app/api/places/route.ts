import { NextResponse, type NextRequest } from "next/server";
import { autocomplete, googleEnabled } from "@/lib/google";

// Address suggestions for the address fields (the Google key stays on the server).
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 100);
  const s = (req.nextUrl.searchParams.get("s") || "").slice(0, 64);
  if (!googleEnabled()) return NextResponse.json({ suggestions: [] }, { status: 503 });
  if (q.length < 3 || !/^[A-Za-z0-9-]{8,64}$/.test(s)) return NextResponse.json({ suggestions: [] });
  try {
    return NextResponse.json({ suggestions: await autocomplete(q, s) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ suggestions: [], error: "Osoitehaku ei juuri nyt toimi" }, { status: 502 });
  }
}
