import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireDriver, type SearchParams } from "@/lib/state";
import type { Order } from "@/lib/types";
import { Gate, activeJobs, byTime, isSoon, requestTime, when } from "../common";

export const metadata: Metadata = { title: "Omat ajot" };

// One button per step: start the trip → (GPS) → drive → hand over.
function Step({ o }: { o: Order }) {
  const map = <Link className="btn outline" href={`/driver/map?order=${o.id}`}>Kartta</Link>;
  if (o.status === "in_transit") return <>{map}<Link className="btn green" href={`/driver/trip?order=${o.id}`}>Olen perillä</Link></>;
  if (o.status === "picked_up") return <>{map}<Link className="btn" href={`/driver/map?order=${o.id}`}>Ota GPS käyttöön ja aja</Link></>;
  return <>{map}<Link className="btn" href={`/driver/trip?order=${o.id}`}>Aloita ajo</Link></>;
}
const Pill = ({ o }: { o: Order }) => o.status === "in_transit" ? <span className="pill blue">Ajossa</span>
  : o.status === "picked_up" ? <span className="pill orange">GPS puuttuu</span> : <span className="pill orange">Odottaa lähtöä</span>;

export default async function MyJobs({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const now = requestTime();
  const mine = activeJobs(s, d).sort(byTime);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card">
      <h2>Omat aktiiviset tehtävät</h2>
      <p className="sub">Suorita tarkastus ennen ajoa ja merkitse auto toimitetuksi perillä.</p>
      <div id="myJobsList">
        {!mine.length ? <p className="empty">Sinulla ei ole aktiivisia tehtäviä.</p> : mine.map(o =>
          <div className={`job${isSoon(o, now) && o.status === "assigned" ? " soon" : ""}`} key={o.id} data-order={o.id}>
            <div>
              <div className="job-route">#{o.id} · {o.pickup.city} → {o.dropoff.city}</div>
              <div className="job-meta">{o.car.model} ({o.car.plate}) · {o.price.km} km · {when(o)} · <Pill o={o} /></div>
            </div>
            <div className="job-actions"><Step o={o} /></div>
          </div>)}
      </div>
    </div>
  </>;
}
