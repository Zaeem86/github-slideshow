// LOCAL TESTING ONLY – a small stand-in for Google Maps Platform (Places API New + Routes API),
// with the same request/response shapes the app uses. Never deploy.
//
//   node server.js [port] [api-key]
//
// Places:  POST /v1/places:autocomplete, GET /v1/places/<id>
// Routes:  POST /directions/v2:computeRoutes  – distance = straight line × 1.15 (whole km), 80 km/h
const http = require("http");
const PORT = +(process.argv[2] || 8792), KEY = process.argv[3] || "test-google-key";

const PLACES = [
  ["PLACE_helsinki_mannerheimintie", "Mannerheimintie 1", "00100 Helsinki", "Helsinki", 60.1699, 24.9384],
  ["PLACE_helsinki_kauppatori", "Kauppatori 1", "00170 Helsinki", "Helsinki", 60.1675, 24.9531],
  ["PLACE_turku_aurakatu", "Aurakatu 1", "20100 Turku", "Turku", 60.4518, 22.2666],
  ["PLACE_tampere_hameenkatu", "Hämeenkatu 1", "33100 Tampere", "Tampere", 61.4978, 23.761],
  ["PLACE_oulu_kauppurienkatu", "Kauppurienkatu 2", "90100 Oulu", "Oulu", 65.0121, 25.4651]
].map(([id, street, post, city, lat, lng]) => ({ id, street, post, city, lat, lng }));

function km(a, b) {
  const R = 6371, r = x => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function encode(points) {          // Google encoded polyline
  let out = "", pLat = 0, pLng = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lng] of points) { const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5); out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b; }
  return out;
}
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = req => new Promise(r => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.headers["x-goog-api-key"] !== KEY) return send(res, 403, { error: { code: 403, message: "API key not valid" } });
  if (req.method === "POST" && u.pathname === "/v1/places:autocomplete") {
    const q = String((await read(req)).input || "").toLowerCase();
    const hits = PLACES.filter(p => `${p.street}, ${p.post}`.toLowerCase().includes(q));
    return send(res, 200, { suggestions: hits.map(p => ({ placePrediction: { placeId: p.id, text: { text: `${p.street}, ${p.post}, Suomi` },
      structuredFormat: { mainText: { text: p.street }, secondaryText: { text: `${p.post}, Suomi` } } } })) });
  }
  if (req.method === "GET" && u.pathname.startsWith("/v1/places/")) {
    const p = PLACES.find(x => x.id === decodeURIComponent(u.pathname.slice("/v1/places/".length)));
    if (!p) return send(res, 404, { error: { code: 404, message: "Not found" } });
    return send(res, 200, { id: p.id, formattedAddress: `${p.street}, ${p.post}, Suomi`, location: { latitude: p.lat, longitude: p.lng },
      addressComponents: [{ longText: p.city, types: ["locality", "political"] }, { longText: "Suomi", types: ["country"] }] });
  }
  if (req.method === "POST" && u.pathname === "/directions/v2:computeRoutes") {
    const b = await read(req);
    const a = PLACES.find(x => x.id === b.origin?.placeId), c = PLACES.find(x => x.id === b.destination?.placeId);
    if (!a || !c) return send(res, 400, { error: { code: 400, message: "Invalid place" } });
    const dist = Math.max(1, Math.round(km(a, c) * 1.15));
    return send(res, 200, { routes: [{ distanceMeters: dist * 1000, duration: `${Math.round((dist / 80) * 3600)}s`,
      polyline: { encodedPolyline: encode([[a.lat, a.lng], [(a.lat + c.lat) / 2 + 0.05, (a.lng + c.lng) / 2], [c.lat, c.lng]]) } }] });
  }
  send(res, 404, { error: { code: 404, message: "Not found" } });
}).listen(PORT, () => console.log(`fake google on http://localhost:${PORT}`));
