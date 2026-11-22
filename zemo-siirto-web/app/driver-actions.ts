"use server";
// Server Actions for the driver's trip screen. They return a result (instead of redirecting)
// so the screen can go on to the next step: confirm → GPS → map.
// The database functions and storage policies decide what is allowed (see 20261122000000_driver_trip.sql).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

const STAGES = ["pickup", "delivery"] as const;
const SLOTS = ["odometer", "front", "right", "left", "rear", "extra1", "extra2"] as const;
const FUEL = ["Full", "3/4", "1/2", "1/4", "Reserve"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 1_500_000;

const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e || "Jokin meni pieleen") });

/** One inspection photo (JPEG, already shrunk in the browser) → storage, as the signed-in driver. */
export async function uploadTripPhoto(order: string, stage: string, slot: string, dataUrl: string): Promise<Result> {
  try {
    if (!UUID.test(order) || !STAGES.includes(stage as never) || !SLOTS.includes(slot as never)) throw new Error("Virheellinen kuva");
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new Error("Kuvan pitää olla JPEG");
    const bytes = Buffer.from(m[1], "base64");
    if (bytes.length > MAX_PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Virheellinen kuva");
    const supabase = await createClient();
    const { error } = await supabase.storage.from("inspection-photos")
      .upload(`${order}/${stage}/${slot}.jpg`, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Save the pickup or delivery inspection. Pickup → status picked_up; delivery → the transfer is completed. */
export async function submitTripInspection(order: string, stage: string, odo: number, fuel: string, notes: string): Promise<Result> {
  try {
    if (!UUID.test(order) || !STAGES.includes(stage as never)) throw new Error("Virheellinen tehtävä");
    if (!Number.isInteger(odo) || odo < 0) throw new Error("Matkamittarin lukema puuttuu");
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_inspection", {
      p_order: order, p_stage: stage,
      p: { odometer_km: odo, fuel_level: FUEL.includes(fuel) ? fuel : "Full", notes: notes.slice(0, 2000) }
    });
    if (error) throw new Error(error.message);
    revalidatePath("/driver", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** GPS is on: the car is on its way (status in_transit). */
export async function beginTrip(order: string): Promise<Result> {
  try {
    if (!UUID.test(order)) throw new Error("Virheellinen tehtävä");
    const supabase = await createClient();
    const { error } = await supabase.rpc("start_transfer", { p_order: order });
    if (error) throw new Error(error.message);
    revalidatePath("/driver", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** The phone's position during the trip. */
export async function reportLocation(order: string, lat: number, lng: number, accuracy: number | null): Promise<Result> {
  try {
    if (!UUID.test(order) || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Virheellinen sijainti");
    const supabase = await createClient();
    const { error } = await supabase.rpc("report_location", {
      p_order: order, p_lat: lat, p_lng: lng, p_accuracy: accuracy != null && Number.isFinite(accuracy) ? Math.round(accuracy) : null
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Short-lived links to the photos of the driver's own inspections (storage RLS decides). */
export async function photoLinks(paths: string[]): Promise<Record<string, string>> {
  const clean = paths.filter(p => /^[0-9a-f-]{36}\/(pickup|delivery)\/[a-z0-9]+\.jpg$/.test(p)).slice(0, 40);
  if (!clean.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from("inspection-photos").createSignedUrls(clean, 600);
  return Object.fromEntries((data || []).flatMap(x => (x.signedUrl && x.path ? [[x.path, x.signedUrl] as [string, string]] : [])));
}
