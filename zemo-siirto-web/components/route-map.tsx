"use client";
// One map for the whole app: pickup (A), destination (B), the road route and (for the driver) the live position.
// Google Maps when NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is set; otherwise OpenStreetMap (Leaflet) with a straight line.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export type LatLng = { lat: number; lng: number };
export type MapPoint = LatLng & { label: string };

const BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || "";

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;
let googleLoad: Promise<G> | null = null;
function loadGoogle(): Promise<G> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve(w.google);
  if (!googleLoad) googleLoad = new Promise((resolve, reject) => {
    w.__zemoMapsReady = () => resolve(w.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(BROWSER_KEY)}&libraries=geometry&language=fi&region=FI&loading=async&callback=__zemoMapsReady`;
    s.async = true;
    s.onerror = () => { googleLoad = null; reject(new Error("Google Maps did not load")); };
    document.head.appendChild(s);
  });
  return googleLoad;
}

export function RouteMap({ from, to, polyline, me, className, id }: {
  from?: MapPoint | null; to?: MapPoint | null; polyline?: string; me?: LatLng | null; className?: string; id?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ setRoute: (a?: MapPoint | null, b?: MapPoint | null, poly?: string) => void; setMe: (p?: LatLng | null) => void; destroy: () => void } | null>(null);
  const pending = useRef({ from, to, polyline, me });
  useEffect(() => { pending.current = { from, to, polyline, me }; });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    const el = box.current!;
    (async () => {
      if (BROWSER_KEY) {
        const google = await loadGoogle().catch(() => null);
        if (google && !cancelled) {
          const map = new google.maps.Map(el, { center: { lat: 64.5, lng: 26 }, zoom: 4, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
          let shapes: G[] = [], dot: G = null;
          api.current = {
            setRoute(a, b, poly) {
              shapes.forEach(s => s.setMap(null)); shapes = [];
              const bounds = new google.maps.LatLngBounds();
              const path = poly ? google.maps.geometry.encoding.decodePath(poly) : a && b ? [a, b] : [];
              if (path.length) {
                shapes.push(new google.maps.Polyline({ map, path, strokeColor: "#f28a45", strokeWeight: 5, strokeOpacity: .9 }));
                path.forEach((p: G) => bounds.extend(p));
              }
              [[a, "A"], [b, "B"]].forEach(([p, l]) => {
                if (!p) return;
                const pt = p as MapPoint;
                shapes.push(new google.maps.Marker({ map, position: { lat: pt.lat, lng: pt.lng }, label: { text: l as string, color: "#17110d", fontWeight: "800" }, title: pt.label }));
                bounds.extend({ lat: pt.lat, lng: pt.lng });
              });
              if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
            },
            setMe(p) {
              if (!p) { dot?.setMap(null); dot = null; return; }
              if (!dot) dot = new google.maps.Marker({ map, position: p, title: "Sinä",
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#3f8cff", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } });
              else dot.setPosition(p);
            },
            destroy() { shapes.forEach(s => s.setMap(null)); dot?.setMap(null); }
          };
        }
      }
      if (!api.current && !cancelled) {
        const L = await import("leaflet");
        if (cancelled) return;
        const map = L.map(el, { scrollWheelZoom: false }).setView([64.5, 26], 4);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
        let group: G = null, dot: G = null;
        api.current = {
          setRoute(a, b) {
            group?.remove();
            const parts: G[] = [];
            if (a) parts.push(L.circleMarker([a.lat, a.lng], { radius: 8, color: "#f28a45", fillOpacity: 1 }).bindTooltip(`A · ${a.label}`, { permanent: true, direction: "top" }));
            if (b) parts.push(L.circleMarker([b.lat, b.lng], { radius: 8, color: "#6bd1a0", fillOpacity: 1 }).bindTooltip(`B · ${b.label}`, { permanent: true, direction: "top" }));
            if (a && b) parts.push(L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: "#f28a45", weight: 4, dashArray: "8 8" }));
            group = L.featureGroup(parts).addTo(map);
            if (parts.length) map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 12 });
          },
          setMe(p) {
            if (!p) { dot?.remove(); dot = null; return; }
            if (!dot) dot = L.circleMarker([p.lat, p.lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#3f8cff", fillOpacity: 1 }).bindTooltip("Sinä").addTo(map);
            else dot.setLatLng([p.lat, p.lng]);
          },
          destroy() { map.remove(); }
        };
        setTimeout(() => map.invalidateSize(), 50);
      }
      const p = pending.current;
      api.current?.setRoute(p.from, p.to, p.polyline);
      api.current?.setMe(p.me);
    })();
    return () => { cancelled = true; api.current?.destroy(); api.current = null; };
  }, []);

  useEffect(() => { api.current?.setRoute(from, to, polyline); },
    [from?.lat, from?.lng, to?.lat, to?.lng, polyline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.setMe(me); }, [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={className} id={id} role="img" aria-label="Kartta" />;
}
