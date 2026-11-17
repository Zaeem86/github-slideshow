import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const form = await request.formData().catch(() => null);
  const portal = String(form?.get("portal") ?? "");
  const to = ["customer", "driver", "admin"].includes(portal) ? `/${portal}/login` : "/";
  return NextResponse.redirect(new URL(to, request.url), { status: 303 });
}
