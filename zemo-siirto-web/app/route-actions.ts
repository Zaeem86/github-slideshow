"use server";
// Price from the real road route (Google Maps). The route is saved as a quote with the service role;
// an order made from the quote gets its distance and price from the database, not from the browser.
import { computeRoute, googleEnabled, placeDetails } from "@/lib/google";
import { serviceRpc } from "@/lib/supabase/service";

export type RouteQuote = {
  id: string; km: number; minutes: number; net: number; vat: number; total: number; vatRate: number;
  from: { address: string; city: string; lat: number; lng: number };
  to: { address: string; city: string; lat: number; lng: number };
  polyline: string;
};

export async function quoteRoute(fromPlaceId: string, toPlaceId: string, session: string): Promise<{ ok: true; quote: RouteQuote } | { ok: false; error: string }> {
  try {
    if (!googleEnabled()) throw new Error("Osoitehaku ei ole käytössä");
    if (!fromPlaceId || !toPlaceId) throw new Error("Valitse molemmat osoitteet listasta");
    if (fromPlaceId === toPlaceId) throw new Error("Valitse kaksi eri osoitetta");
    const sess = /^[A-Za-z0-9-]{8,64}$/.test(session) ? session : crypto.randomUUID();
    const [a, b] = await Promise.all([placeDetails(fromPlaceId, sess), placeDetails(toPlaceId, sess)]);
    const r = await computeRoute(a, b);
    const saved = await serviceRpc<{ id: string; km: number; minutes: number; net: number; vat: number; total: number; vatRate: number }>("save_route_quote", { p: {
      from_address: a.address, from_city: a.city, from_lat: a.lat, from_lng: a.lng,
      to_address: b.address, to_city: b.city, to_lat: b.lat, to_lng: b.lng,
      distance_m: r.distanceM, duration_s: r.durationS, polyline: r.polyline
    } });
    return { ok: true, quote: { ...saved, from: { address: a.address, city: a.city, lat: a.lat, lng: a.lng },
      to: { address: b.address, city: b.city, lat: b.lat, lng: b.lng }, polyline: r.polyline } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Hintaa ei voitu laskea" };
  }
}
