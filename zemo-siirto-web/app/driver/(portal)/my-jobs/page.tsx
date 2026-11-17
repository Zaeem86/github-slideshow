import type { Metadata } from "next";
import Link from "next/link";
import { releaseJob, startDriving } from "@/app/actions";
import { ActionButton, AutoRefresh } from "@/components/client";
import { Empty, Flash, StatusBadge } from "@/components/ui";
import { driverPay, dt, eur } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import type { Order } from "@/lib/types";
import { Gate, JobCard, activeJobs } from "../common";

export const metadata: Metadata = { title: "My jobs" };
const HERE = "/driver/my-jobs";

function Actions({ o }: { o: Order }) {
  const nav = <Link className="btn btn-light" href={`/driver/navigation?order=${o.id}`}>Navigation</Link>;
  const insp = (label: string) => <Link className="btn btn-gold" href={`/driver/inspection?order=${o.id}`}>{label}</Link>;
  if (o.status === "assigned") return <>
    <ActionButton action={releaseJob} fields={{ uuid: o.uuid }} from={HERE} kind="btn-danger" confirm="Release this job back to other drivers?">Release</ActionButton>
    <span className="spacer" />{nav}{insp("Pickup inspection")}</>;
  if (o.status === "picked_up") return <><span className="spacer" />
    <ActionButton action={startDriving} fields={{ uuid: o.uuid }} from={HERE} kind="btn-light">Start driving</ActionButton>{nav}</>;
  return <><span className="spacer" />{nav}{insp("Delivery inspection")}</>;
}

export default async function MyJobs({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  if (d.status !== "approved") return <><Flash sp={sp} /><Gate d={d} /></>;
  const active = activeJobs(s, d).reverse();
  const done = s.orders.filter(o => o.driverId === d.id && o.status === "delivered").reverse();
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1 className="m0">Active jobs ({active.length})</h1></div>
    {!active.length ? <Empty action={<Link className="btn btn-gold" href="/driver/available-jobs">Find jobs</Link>}>No active jobs.</Empty>
      : active.map(o => <JobCard key={o.id} o={o} s={s} extra={<div className="mt"><StatusBadge status={o.status} /></div>}><Actions o={o} /></JobCard>)}
    {done.length > 0 && <div className="card"><h2>Completed</h2><div className="table-scroll"><table>
      <thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Pay</th></tr></thead>
      <tbody>{done.map(o => <tr key={o.id}><td>{o.id}</td><td>{o.pickup.city} → {o.dropoff.city}</td><td>{dt(o.history.at(-1)?.at)}</td><td>{eur(driverPay(o, s.settings))}</td></tr>)}</tbody>
    </table></div></div>}
  </>;
}
