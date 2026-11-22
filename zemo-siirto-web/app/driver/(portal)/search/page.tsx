import type { Metadata } from "next";
import { acceptJob } from "@/app/actions";
import { ActionButton, AutoRefresh } from "@/components/client";
import { JobSearch } from "@/components/driver/search";
import { Flash } from "@/components/ui";
import { eur } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import { Gate, byTime, isSoon, payOf, requestTime, when } from "../common";

export const metadata: Metadata = { title: "Hae" };
const HERE = "/driver/search";

export default async function Search({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const now = requestTime();
  const jobs = s.orders.filter(o => o.status === "open" && !o.rejectedBy.includes(d.id)).sort(byTime).map(o => ({
    id: o.id, from: o.pickup.city, to: o.dropoff.city, car: `${o.car.model} (${o.car.plate})`, km: o.price.km,
    when: when(o), date: o.pickup.date, pay: eur(payOf(o, s)), soon: isSoon(o, now),
    accept: <ActionButton action={acceptJob} fields={{ uuid: o.uuid }} from={HERE} kind="" busy="Odota…">Hyväksy tehtävä</ActionButton>
  }));
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card">
      <h2>Hae tehtäviä</h2>
      <p className="sub">Hae avoimia siirtoja kaupungin, tilausnumeron tai auton mukaan.</p>
      <JobSearch jobs={jobs} />
    </div>
  </>;
}
