import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { photoLinks } from "@/app/driver-actions";
import { TripScreen } from "@/components/driver/trip";
import { Flash } from "@/components/ui";
import { eur } from "@/lib/domain";
import { one, requireDriver, type SearchParams } from "@/lib/state";
import { Gate, fiDate, payOf, when } from "../common";

export const metadata: Metadata = { title: "Ajo" };

export default async function Trip({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const o = s.orders.find(x => x.id === one(sp.order) && x.driverId === d.id);
  if (!o || !["assigned", "picked_up", "in_transit"].includes(o.status)) redirect("/driver/my-jobs");
  // Start photos are saved but GPS is not on yet: the map page asks for GPS.
  if (o.status === "picked_up") redirect(`/driver/map?order=${encodeURIComponent(o.id)}`);
  const stage = o.status === "assigned" ? "pickup" : "delivery";
  const saved = o.inspection.pickup;
  const links = saved ? await photoLinks(saved.photos) : {};
  return <div className="grid">
    <TripScreen key={`${o.id}-${stage}`} o={{
      uuid: o.uuid, id: o.id, stage, from: o.pickup.city, to: o.dropoff.city, fromAddr: o.pickup.address, toAddr: o.dropoff.address,
      fromContact: o.pickup.contact, toContact: o.dropoff.contact,
      when: when(o), car: `${o.car.model} (${o.car.plate})`, km: o.price.km, minutes: o.route?.minutes ?? null, pay: eur(payOf(o, s)), inspected: !!saved,
      customer: { name: o.customer.name, company: o.customer.company, phone: o.customer.phone, email: o.customer.email }
    }} />
    <div className="card">
      <h2>Tallennetut raportit</h2>
      <p className="sub">Viimeisimmät tarkastukset.</p>
      {!saved ? <p className="empty">Ei vielä raportteja tälle siirrolle.</p> :
        <div className="job" id="pickupReport">
          <div>
            <div className="job-route">#{o.id} · Nouto</div>
            <div className="job-meta">{fiDate(saved.at.slice(0, 10))} · {saved.odo} km · {saved.fuel}{saved.notes ? ` · ${saved.notes}` : ""}</div>
            <div className="log-photos">{saved.photos.map(p => links[p] &&
              // eslint-disable-next-line @next/next/no-img-element
              <a key={p} href={links[p]} target="_blank" rel="noopener noreferrer"><img src={links[p]} alt={p.split("/").pop()} /></a>)}</div>
          </div>
          <span className="pill green">OK</span>
        </div>}
    </div>
  </div>;
}
