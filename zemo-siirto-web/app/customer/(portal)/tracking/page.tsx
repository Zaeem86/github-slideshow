import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh, GotoSelect } from "@/components/client";
import { Empty, Flash, InspectionReport, OrderSummary, Timeline } from "@/components/ui";
import { ACTIVE, STATUS_LABEL } from "@/lib/domain";
import { one, requireCustomer, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Tracking" };

export default async function Tracking({ searchParams }: { searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const sp = await searchParams;
  const mine = s.orders.filter(o => o.customerId === user.id).reverse();
  if (!mine.length) return <Empty action={<Link className="btn btn-gold" href="/customer/create-order">Create your first transfer</Link>}>No orders to track yet.</Empty>;
  const id = one(sp.id) || (mine.find(o => !["delivered", "cancelled"].includes(o.status)) ?? mine[0]).id;
  const o = mine.find(x => x.id === id);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Track your transfer</h1>
      <GotoSelect label="Order" value={o ? `/customer/tracking?id=${o.id}` : ""}
        options={mine.map(x => [`/customer/tracking?id=${x.id}`, `${x.id} · ${x.pickup.city} → ${x.dropoff.city} · ${STATUS_LABEL[x.status]}`])} />
    </div>
    {!o ? <Empty>Order not found.</Empty> : <div className="card">
      <OrderSummary o={o} opts={{ contacts: true, driverPhone: ACTIVE.includes(o.status), driver: s.drivers.find(d => d.id === o.driverId) }} />
      <h3>Status</h3><Timeline o={o} />
      <div className="row">
        {o.status === "pending_payment" && <Link className="btn btn-gold" href={`/customer/pay/${o.id}`}>Pay now</Link>}
        {o.payment && <Link className="btn btn-light" href={`/invoice/${o.id}`}>Invoice</Link>}
      </div>
      <InspectionReport o={o} />
    </div>}
  </>;
}
