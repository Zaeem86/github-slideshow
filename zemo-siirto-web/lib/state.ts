// Server-only: load what the signed-in user may see, and guard portal pages.
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { DEFAULT_SETTINGS } from "./domain";
import type { AppState, Customer, Driver } from "./types";

/** One get_app_state() call per request (React cache dedupes layout + page). */
export const getState = cache(async (): Promise<AppState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_app_state");
  if (error) throw new Error(error.message);
  return data as AppState;
});

/** For public pages: fall back to default pricing if the backend is unreachable. */
export async function getStateOrDefaults(): Promise<AppState | null> {
  try { return await getState(); } catch { return null; }
}
export const settingsOf = (s: AppState | null) => s?.settings ?? DEFAULT_SETTINGS;

export async function requireCustomer(): Promise<{ s: AppState; user: Customer }> {
  const s = await getState();
  const user = s.customers.find(c => c.id === s.session.customerId);
  if (!user) redirect("/customer/login");
  return { s, user };
}

export async function requireDriver(): Promise<{ s: AppState; user: Driver }> {
  const s = await getState();
  const user = s.drivers.find(d => d.id === s.session.driverId);
  if (!user) redirect("/driver/login");
  return { s, user };
}

export async function requireAdmin(): Promise<{ s: AppState; user: { email: string } }> {
  const s = await getState();
  if (!s.session.admin || !s.admin) redirect("/admin/login");
  return { s, user: s.admin };
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type DriverNews = { id: string; kind: "news" | "decision"; title: string; body: string; publishedAt: string };
/** News and decisions for drivers, newest first (RLS: drivers and admins only). */
export async function getDriverNews(): Promise<DriverNews[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_driver_news");
  if (error) return [];
  return (data ?? []) as DriverNews[];
}
