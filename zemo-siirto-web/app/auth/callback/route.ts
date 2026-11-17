// Email confirmation / magic links land here and are turned into a session.
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const supabase = await createClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  const portal = safeNext.split("/")[1] || "customer";
  const dest = ok ? safeNext : `/${["customer", "driver", "admin"].includes(portal) ? portal : "customer"}/login?error=${encodeURIComponent("The link is invalid or has expired. Please sign in.")}`;
  return NextResponse.redirect(new URL(dest, request.url));
}
