import type { Metadata } from "next";
import { acceptJob, rejectJob } from "@/app/actions";
import { ActionButton, AutoRefresh } from "@/components/client";
import { Empty, Flash } from "@/components/ui";
import { estimateKm } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import { Gate, JobCard } from "../common";

export const metadata: Metadata = { title: "Available jobs" };
const HERE = "/driver/available-jobs";

export default async function AvailableJobs({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const jobs = s.orders.filter(o => o.status === "open" && !o.rejectedBy.includes(d.id))
    .map(o => ({ o, away: estimateKm(d.city, o.pickup.city, s.settings) }))
    .sort((a, b) => (a.away ?? 1e9) - (b.away ?? 1e9));
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Available transfer jobs</h1>
      <p className="muted m0">Paid orders waiting for a driver{d.city && `, nearest to ${d.city} first`}.</p></div>
    {!jobs.length ? <Empty>No open jobs right now.</Empty> : jobs.map(({ o, away }) =>
      <JobCard key={o.id} o={o} s={s} extra={away != null && <p className="muted m0">Pickup is ~{away} km from {d.city}</p>}>
        <ActionButton action={rejectJob} fields={{ uuid: o.uuid }} from={HERE} kind="btn-danger">Reject</ActionButton>
        <span className="spacer" />
        <ActionButton action={acceptJob} fields={{ uuid: o.uuid }} from={HERE} kind="btn-gold">Accept job</ActionButton>
      </JobCard>)}
  </>;
}
