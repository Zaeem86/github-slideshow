import type { Metadata } from "next";
import Link from "next/link";
import { startDriving } from "@/app/actions";
import { ActionButton, GotoSelect } from "@/components/client";
import { Empty, Flash, Stat, StatusBadge } from "@/components/ui";
import { CITIES, STATUS_LABEL, driverPay, eur } from "@/lib/domain";
import { one, requireDriver, type SearchParams } from "@/lib/state";
import { Gate, activeJobs } from "../common";

export const metadata: Metadata = { title: "Navigation" };

export default async function Navigation({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const jobs = activeJobs(s, d);
  const id = one(sp.order);
  const o = (id && jobs.find(x => x.id === id)) || jobs[0];
  if (!o) return <><Flash sp={sp} /><Empty action={<Link className="btn btn-gold" href="/driver/available-jobs">Find jobs</Link>}>No active job to navigate.</Empty></>;

  const toPickup = o.status === "assigned";
  const target = toPickup ? o.pickup : o.dropoff;
  const place = (p: { address: string; city: string }) => `${p.address}, ${p.city}, Finland`;
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place(target))}&travelmode=driving`;
  const route = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(place(o.pickup))}&destination=${encodeURIComponent(place(o.dropoff))}&travelmode=driving`;
  const a = CITIES[o.pickup.city], b = CITIES[o.dropoff.city], m = CITIES[target.city];
  const pad = 0.25;
  const bbox = [Math.min(a[1], b[1]) - pad, Math.min(a[0], b[0]) - pad / 2, Math.max(a[1], b[1]) + pad, Math.max(a[0], b[0]) + pad / 2].map(n => n.toFixed(4)).join("%2C");
  const map = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${m[0]}%2C${m[1]}`;
  const hrs = o.price.km / 75;
  const contact = target.contact || `${o.customer.name}, ${o.customer.phone}`;
  const phone = (contact.match(/\+?[\d\s-]{6,}/)?.[0] ?? o.customer.phone).replace(/[\s-]/g, "");
  const here = `/driver/navigation?order=${o.id}`;

  return <>
    <Flash sp={sp} />
    <div className="card">
      {jobs.length > 1 && <div className="mb"><GotoSelect label="Job" value={here}
        options={jobs.map(x => [`/driver/navigation?order=${x.id}`, `${x.id} · ${x.pickup.city} → ${x.dropoff.city} · ${STATUS_LABEL[x.status]}`])} /></div>}
      <div className="row"><h1 className="m0">{toPickup ? "Leg 1 · Go to pickup" : "Leg 2 · Deliver the car"}</h1><StatusBadge status={o.status} /></div>
      <p className="big-addr">{target.address}<br /><span className="muted">{target.city}</span></p>
      <div className="row">
        <a className="btn btn-gold" href={gmaps} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
        <a className="btn btn-light" href={`tel:${phone}`}>Call contact</a>
        <span className="spacer" />
        {o.status === "assigned" && <Link className="btn btn-gold" href={`/driver/inspection?order=${o.id}`}>Arrived – pickup inspection</Link>}
        {o.status === "picked_up" && <ActionButton action={startDriving} fields={{ uuid: o.uuid }} from={here} kind="btn-gold">Start driving</ActionButton>}
        {o.status === "in_transit" && <Link className="btn btn-gold" href={`/driver/inspection?order=${o.id}`}>Arrived – delivery inspection</Link>}
      </div>
      <p className="muted">Contact: {contact}</p>
    </div>
    <div className="card">
      <iframe className="map" title="Route map" src={map} loading="lazy" />
      <div className="stat-grid">
        <Stat label="Transfer distance" value={`${o.price.km} km`} />
        <Stat label="Est. driving time" value={`${Math.floor(hrs)} h ${Math.round((hrs % 1) * 60)} min`} />
        <Stat label="Your pay" value={eur(driverPay(o, s.settings))} />
      </div>
      <div className="row"><span className="muted">{o.pickup.city} → {o.dropoff.city} · {o.car.model} {o.car.plate}</span><span className="spacer" />
        <a className="btn btn-light btn-sm" href={route} target="_blank" rel="noopener noreferrer">Full route</a></div>
      {o.notes && <p className="notice">{o.notes}</p>}
    </div>
  </>;
}
