import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/client";
import { Flash, Stat } from "@/components/ui";
import { ACTIVE, driverPay, eur } from "@/lib/domain";
import { requireAdmin, type SearchParams } from "@/lib/state";
import { OrdersTable } from "../orders-table";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboard({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  const paid = s.orders.filter(o => o.payment && o.status !== "cancelled");
  const revenue = paid.reduce((t, o) => t + o.price.net, 0);
  const payouts = paid.reduce((t, o) => t + driverPay(o, s.settings), 0);
  const todo: [number, string, string][] = ([
    [s.drivers.filter(d => d.status === "pending").length, "driver(s) waiting for verification", "/admin/drivers"],
    [s.orders.filter(o => o.status === "open").length, "paid order(s) without a driver", "/admin/orders?status=open"],
    [s.orders.filter(o => o.status === "cancelled" && o.payment && !o.refundedAt).length, "refund(s) due", "/admin/payments"],
    [s.orders.filter(o => o.status === "delivered" && !o.driverPaidAt).length, "delivered job(s) awaiting driver payout", "/admin/payments"]
  ] as [number, string, string][]).filter(t => t[0] > 0);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Dashboard</h1>
      <div className="stat-grid">
        <Stat label="Revenue (excl. VAT)" value={eur(revenue)} />
        <Stat label="Driver payouts" value={eur(payouts)} />
        <Stat label="Gross margin" value={eur(revenue - payouts)} />
        <Stat label="Orders" value={s.orders.length} />
        <Stat label="Active transfers" value={s.orders.filter(o => ACTIVE.includes(o.status)).length} />
        <Stat label="Customers" value={s.customers.length} />
        <Stat label="Approved drivers" value={s.drivers.filter(d => d.status === "approved").length} />
      </div></div>
    <div className="card"><h2>Needs attention</h2>
      {todo.length ? <ul className="todo">{todo.map(([n, l, h]) => <li key={l}><Link href={h}><b>{n}</b> {l} →</Link></li>)}</ul> : <p className="muted m0">All clear 🎉</p>}</div>
    <div className="card"><div className="row"><h2 className="m0">Latest orders</h2><span className="spacer" /><Link className="btn btn-light btn-sm" href="/admin/orders">All orders</Link></div>
      <div className="mt"><OrdersTable s={s} list={[...s.orders].reverse().slice(0, 5)} from="/admin/dashboard" /></div></div>
  </>;
}
