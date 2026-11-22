"use client";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { CircleMarker, FeatureGroup, Map as LeafletMap } from "leaflet";
import { beginTrip } from "@/app/driver-actions";
import { CITIES } from "@/lib/domain";
import { useGps, useToast } from "./shell";

export type MapOrder = { uuid: string; id: string; status: string; from: string; to: string; fromAddr: string; toAddr: string; km: number };

export function TripMap({ o }: { o: MapOrder }) {
  const router = useRouter();
  const gps = useGps();
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<FeatureGroup | null>(null);
  const me = useRef<CircleMarker | null>(null);
  const asked = useRef(false);
  const driving = o.status === "in_transit";

  // Map with pickup (A), destination (B) and the dashed route line.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(L => {
      if (cancelled || !box.current || map.current) return;
      const m = L.map(box.current).setView([62.5, 25.5], 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(m);
      const a = CITIES[o.from], b = CITIES[o.to], parts: L.Layer[] = [];
      if (a) parts.push(L.circleMarker(a, { radius: 8, color: "#f28a45", fillOpacity: 1 }).bindTooltip(`A · ${o.from}`, { permanent: true, direction: "top" }));
      if (b) parts.push(L.circleMarker(b, { radius: 8, color: "#6bd1a0", fillOpacity: 1 }).bindTooltip(`B · ${o.to}`, { permanent: true, direction: "top" }));
      if (a && b) parts.push(L.polyline([a, b], { color: "#f28a45", weight: 4, dashArray: "8 8" }));
      layer.current = L.featureGroup(parts as never[]).addTo(m);
      if (parts.length) m.fitBounds(layer.current.getBounds(), { padding: [40, 40], maxZoom: 11 });
      map.current = m;
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; me.current = null; };
  }, [o.from, o.to]);

  // The driver's live position.
  useEffect(() => {
    if (!gps.fix || !map.current) return;
    const ll: [number, number] = [gps.fix.lat, gps.fix.lng];
    import("leaflet").then(L => {
      if (!map.current) return;
      if (!me.current) me.current = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#3f8cff", fillOpacity: 1 }).bindTooltip("Sinä").addTo(map.current);
      else me.current.setLatLng(ll);
    });
  }, [gps.fix]);

  // GPS is required: start the trip once it is on (start photos already saved), or turn it on again during the trip.
  useEffect(() => {
    if (asked.current || (o.status !== "picked_up" && !(driving && !gps.on))) return;
    asked.current = true;
    (async () => {
      const ok = await gps.ask();
      if (o.status === "picked_up") {
        if (!ok) { toast("Ajoa ei voi aloittaa ilman GPS:ää.", true); router.push("/driver/my-jobs"); return; }
        const r = await beginTrip(o.uuid);
        if (!r.ok) { toast(r.error, true); return; }
        toast("Ajo aloitettu. Hyvää matkaa!");
        router.refresh();
      } else if (!ok) toast("GPS on pidettävä päällä koko ajon ajan.", true);
    })();
  }, [o.status, o.uuid, driving, gps, toast, router]);

  const place = (addr: string, city: string) => encodeURIComponent(`${addr}, ${city}, Finland`);
  return <div className="card">
    <div className="map-head">
      <h2 id="navTitle">{driving ? "Ajo käynnissä" : "Reitti"}</h2>
      {driving && <span className={`gps-pill ${gps.on ? "on" : "off"}`} id="navGps">{gps.on ? "GPS päällä" : "GPS pois"}</span>}
    </div>
    <div className="trip-map" id="tripMap" ref={box} />
    <div className="nav-box">
      <div className="step-line"><span className="step-num">A</span><div><strong>{o.fromAddr}, {o.from} — Noutopiste</strong><div className="job-meta">Noutopiste</div></div></div>
      <div className="step-line"><span className="step-num">B</span><div><strong>{o.toAddr}, {o.to} — Toimituspiste ({o.km} km)</strong><div className="job-meta">Toimituspiste · Ota luovutuskuvat saapuessa</div></div></div>
      <div style={{ marginTop: 18 }}>
        <a className="btn blue" target="_blank" rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&origin=${place(o.fromAddr, o.from)}&destination=${place(o.toAddr, o.to)}&travelmode=driving`}>Avaa Google Mapsissa ↗</a>
      </div>
    </div>
    {driving && <Link className="btn green block" id="arriveBtn" href={`/driver/trip?order=${o.id}`}>Olen perillä – luovuta auto →</Link>}
  </div>;
}
