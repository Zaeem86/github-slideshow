// GET /api/health – quick check after a deployment: is the app configured and can it reach the database?
// Reveals only yes/no flags, never secrets.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { trustlyEnabled } from "@/lib/trustly";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = {
    supabaseConfigured: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    serviceKeyConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    appUrlConfigured: !!process.env.APP_URL,
    trustlyConfigured: trustlyEnabled(),
    database: false,
    migrationsApplied: false
  };
  let demoPayments: boolean | null = null;
  if (checks.supabaseConfigured) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
        { auth: { persistSession: false } });
      const { data, error } = await sb.rpc("get_app_state");
      checks.database = !error;
      checks.migrationsApplied = !error && !!data?.settings && "demoPayments" in data.settings;
      demoPayments = data?.settings?.demoPayments ?? null;
    } catch { /* unreachable */ }
  }
  const ok = checks.supabaseConfigured && checks.database && checks.migrationsApplied && checks.serviceKeyConfigured && checks.appUrlConfigured;
  return NextResponse.json({ ok, checks, demoPayments }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
