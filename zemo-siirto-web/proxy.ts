import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

// Refreshes the Supabase session cookie on every page request.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Skip static files and the server-to-server endpoints (payment notifications, health check).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/trustly|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
