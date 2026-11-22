// SERVER ONLY. Google Maps Platform: address search (Places API New) and road routes (Routes API).
// The key (GOOGLE_MAPS_SERVER_KEY) stays on the server; the browser only talks to our own endpoints.
// GOOGLE_PLACES_URL / GOOGLE_ROUTES_URL can point to a local mock in tests.

const PLACES = () => (process.env.GOOGLE_PLACES_URL || "https://places.googleapis.com").replace(/\/$/, "");
const ROUTES = () => (process.env.GOOGLE_ROUTES_URL || "https://routes.googleapis.com").replace(/\/$/, "");
const key = () => process.env.GOOGLE_MAPS_SERVER_KEY || "";

export const googleEnabled = () => !!key();

export type Suggestion = { placeId: string; main: string; secondary: string };
export type Place = { placeId: string; address: string; city: string; lat: number; lng: number };
export type Route = { distanceM: number; durationS: number; polyline: string };

async function call<T>(url: string, init: RequestInit & { fieldMask?: string }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-goog-api-key": key(), ...(init.fieldMask ? { "x-goog-fieldmask": init.fieldMask } : {}) },
    signal: AbortSignal.timeout(10000),
    cache: "no-store"
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Maps: ${body?.error?.message || res.status}`);
  return body as T;
}

/** Address suggestions in Finland while the user types. */
export async function autocomplete(input: string, session: string): Promise<Suggestion[]> {
  type R = { suggestions?: { placePrediction?: { placeId: string; text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] };
  const r = await call<R>(`${PLACES()}/v1/places:autocomplete`, {
    method: "POST",
    body: JSON.stringify({ input, includedRegionCodes: ["fi"], languageCode: "fi", regionCode: "fi", sessionToken: session })
  });
  return (r.suggestions || []).flatMap(s => s.placePrediction ? [{
    placeId: s.placePrediction.placeId,
    main: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text?.text || "",
    secondary: s.placePrediction.structuredFormat?.secondaryText?.text || ""
  }] : []).slice(0, 6);
}

/** Full address, city and coordinates of a suggestion. */
export async function placeDetails(placeId: string, session: string): Promise<Place> {
  type R = { id: string; formattedAddress?: string; location?: { latitude: number; longitude: number };
    addressComponents?: { longText: string; types: string[] }[] };
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new Error("Tuntematon osoite");
  const r = await call<R>(`${PLACES()}/v1/places/${encodeURIComponent(placeId)}?languageCode=fi&regionCode=fi&sessionToken=${encodeURIComponent(session)}`, {
    method: "GET", fieldMask: "id,formattedAddress,location,addressComponents"
  });
  const comp = (t: string) => r.addressComponents?.find(c => c.types.includes(t))?.longText;
  const city = comp("locality") || comp("postal_town") || comp("administrative_area_level_3") || comp("administrative_area_level_2") || "";
  if (!r.location || !r.formattedAddress) throw new Error("Osoitetta ei löytynyt");
  return {
    placeId: r.id, address: r.formattedAddress.replace(/, (Suomi|Finland)$/, "").slice(0, 200), city: city.slice(0, 100) || "Suomi",
    lat: r.location.latitude, lng: r.location.longitude
  };
}

/** Driving route by road between two places. */
export async function computeRoute(a: Place, b: Place): Promise<Route> {
  type R = { routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] };
  const r = await call<R>(`${ROUTES()}/directions/v2:computeRoutes`, {
    method: "POST",
    fieldMask: "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    body: JSON.stringify({
      origin: { placeId: a.placeId }, destination: { placeId: b.placeId },
      travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", languageCode: "fi", regionCode: "fi", units: "METRIC"
    })
  });
  const route = r.routes?.[0];
  if (!route?.distanceMeters) throw new Error("Reittiä ei löytynyt näiden osoitteiden välille");
  return { distanceM: route.distanceMeters, durationS: parseInt(route.duration || "0", 10) || 0, polyline: route.polyline?.encodedPolyline || "" };
}
