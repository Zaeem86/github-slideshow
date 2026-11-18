// SERVER ONLY. Supabase client with the service role key, for the few database functions that
// only trusted server code may call (recording verified payment notifications and refunds).
// Never import this from a client component, and never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(supabaseEnv().url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function serviceRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createServiceClient().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
