"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { beginTrip } from "@/app/driver-actions";
import { RouteMap, type MapPoint } from "../route-map";
import { useGps, useToast } from "./shell";

export type MapOrder = { uuid: string; id: string; status: string; from: string; to: string; fromAddr: string; toAddr: string; km: number;
  a: MapPoint | null; b: MapPoint | null; polyline: string; minutes: number | null };

export function TripMap({ o }: { o: MapOrder }) {
  const router = useRouter();
  const gps = useGps();
  const toast = useToast();
  const asked = useRef(false);
  const driving = o.status === "in_transit";

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
    <RouteMap className="trip-map" id="tripMap" from={o.a} to={o.b} polyline={o.polyline} me={gps.fix} />
    <div className="nav-box">
      <div className="step-line"><span className="step-num">A</span><div><strong>{o.fromAddr}, {o.from} — Noutopiste</strong><div className="job-meta">Noutopiste</div></div></div>
      <div className="step-line"><span className="step-num">B</span><div><strong>{o.toAddr}, {o.to} — Toimituspiste ({o.km} km{o.minutes ? ` · ≈ ${o.minutes >= 60 ? `${Math.floor(o.minutes / 60)} h ${o.minutes % 60} min` : `${o.minutes} min`}` : ""})</strong><div className="job-meta">Toimituspiste · Ota luovutuskuvat saapuessa</div></div></div>
      <div style={{ marginTop: 18 }}>
        <a className="btn blue" target="_blank" rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&origin=${place(o.fromAddr, o.from)}&destination=${place(o.toAddr, o.to)}&travelmode=driving`}>Avaa Google Mapsissa ↗</a>
      </div>
    </div>
    {driving && <Link className="btn green block" id="arriveBtn" href={`/driver/trip?order=${o.id}`}>Olen perillä – luovuta auto →</Link>}
  </div>;
}
