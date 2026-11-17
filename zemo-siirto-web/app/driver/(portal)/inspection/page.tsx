import type { Metadata } from "next";
import Link from "next/link";
import { recordInspection } from "@/app/actions";
import { GotoSelect, InspectionForm } from "@/components/client";
import { Empty, Flash, InspectionReport, OrderSummary } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/domain";
import { one, requireDriver, type SearchParams } from "@/lib/state";
import { Gate, activeJobs } from "../common";

export const metadata: Metadata = { title: "Inspection" };

export default async function Inspection({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const jobs = activeJobs(s, d);
  const id = one(sp.order);
  const o = id ? s.orders.find(x => x.id === id && x.driverId === d.id) : jobs[0];
  if (!o) return <><Flash sp={sp} /><Empty action={<Link className="btn btn-gold" href="/driver/my-jobs">My jobs</Link>}>No job needs an inspection right now.</Empty></>;
  const stage = o.status === "assigned" ? "pickup" : ["picked_up", "in_transit"].includes(o.status) ? "delivery" : null;
  return <>
    <Flash sp={sp} />
    <div className="card">
      {jobs.length > 1 && <div className="mb"><GotoSelect label="Job" value={`/driver/inspection?order=${o.id}`}
        options={jobs.map(x => [`/driver/inspection?order=${x.id}`, `${x.id} · ${x.pickup.city} → ${x.dropoff.city} · ${STATUS_LABEL[x.status]}`])} /></div>}
      <OrderSummary o={o} opts={{ hidePrice: true, hideDriver: true, contacts: true }} />
    </div>
    {stage ? <InspectionForm key={`${o.id}-${stage}`} order={o} stage={stage} action={recordInspection} /> : null}
    {(!stage || stage === "delivery") && <div className="card"><InspectionReport o={o} />{!o.inspection.pickup && <div className="empty">No inspection recorded.</div>}</div>}
  </>;
}
