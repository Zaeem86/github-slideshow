import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TripMap } from "@/components/driver/map";
import { Flash } from "@/components/ui";
import { one, requireDriver, type SearchParams } from "@/lib/state";
import { Gate } from "../common";

export const metadata: Metadata = { title: "Kartta" };

export default async function MapPage({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const o = s.orders.find(x => x.id === one(sp.order) && x.driverId === d.id);
  if (!o || !["assigned", "picked_up", "in_transit"].includes(o.status)) redirect("/driver/my-jobs");
  return <div className="grid">
    <TripMap key={`${o.id}-${o.status}`} o={{ uuid: o.uuid, id: o.id, status: o.status, from: o.pickup.city, to: o.dropoff.city, fromAddr: o.pickup.address, toAddr: o.dropoff.address, km: o.price.km }} />
    <div className="card">
      <h2>Ajonaikaiset ohjeet</h2>
      <p className="sub">Turvallisuus ja protokolla.</p>
      <ul className="guidelines">
        <li>Noudata nopeusrajoituksia ja taloudellista ajotapaa.</li>
        <li>Tupakointi ja lemmikit autossa on ehdottomasti kielletty.</li>
        <li>Säilytä polttoaine- tai latauskuitit kulukorvausta varten.</li>
        <li>Ota luovutuskuvat heti pysäköinnin jälkeen.</li>
      </ul>
      {o.notes && <p className="notice" style={{ marginTop: 14 }}>{o.notes}</p>}
    </div>
  </div>;
}
