import type { Metadata } from "next";
import Link from "next/link";
import { markRefunded, payDriver } from "@/app/actions";
import { ActionButton, AutoRefresh } from "@/components/client";
import { Flash, Stat } from "@/components/ui";
import { driverPay, dt, eur, mask } from "@/lib/domain";
import { requireAdmin, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Payments" };
const HERE = "/admin/payments";
const METHODS = { card: "Card", mobilepay: "MobilePay", invoice: "Invoice" } as const;

export default async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  const pay = (o: Parameters<typeof driverPay>[0]) => driverPay(o, s.settings);
  const paid = s.orders.filter(o => o.payment).reverse();
  const refundsDue = s.orders.filter(o => o.status === "cancelled" && o.payment && !o.refundedAt);
  const payoutsDue = s.orders.filter(o => o.status === "delivered" && !o.driverPaidAt);
  const drivers = s.drivers.map(d => {
    const due = payoutsDue.filter(o => o.driverId === d.id);
    const out = s.orders.filter(o => o.driverId === d.id && o.driverPaidAt).reduce((t, o) => t + pay(o), 0);
    return { d, due, dueAmount: due.reduce((t, o) => t + pay(o), 0), out };
  }).filter(x => x.due.length || x.out);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Payments</h1>
      <div className="stat-grid">
        <Stat label="Received" value={eur(paid.filter(o => !o.refundedAt).reduce((t, o) => t + o.price.total, 0))} />
        <Stat label="Refunds due" value={eur(refundsDue.reduce((t, o) => t + o.price.total, 0))} />
        <Stat label="Driver payouts due" value={eur(payoutsDue.reduce((t, o) => t + pay(o), 0))} />
      </div></div>
    <div className="card"><h2>Customer payments</h2>
      {!paid.length ? <div className="empty">No payments yet.</div> : <div className="table-scroll"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Amount</th><th>Date</th><th>Status</th><th /></tr></thead>
        <tbody>{paid.map(o => <tr key={o.id}>
          <td>{o.id}</td><td>{o.customer.name}</td><td>{METHODS[o.payment!.method]}{o.payment!.last4 && ` •••• ${o.payment!.last4}`}</td>
          <td>{eur(o.price.total)}</td><td>{dt(o.payment!.paidAt)}</td>
          <td>{o.status !== "cancelled" ? <span className="badge ok">Paid</span> : o.refundedAt ? <span className="badge">Refunded</span> : <span className="badge bad">Refund due</span>}</td>
          <td><div className="row nowrap"><Link className="btn btn-light btn-sm" href={`/invoice/${o.id}`}>Invoice</Link>
            {o.status === "cancelled" && !o.refundedAt && <ActionButton action={markRefunded} fields={{ uuid: o.uuid }} from={HERE} kind="btn-gold btn-sm">Mark refunded</ActionButton>}</div></td>
        </tr>)}</tbody>
      </table></div>}</div>
    <div className="card"><h2>Driver payouts</h2>
      {!drivers.length ? <div className="empty">Nothing to pay out.</div> : <div className="table-scroll"><table>
        <thead><tr><th>Driver</th><th>IBAN</th><th>Jobs due</th><th>Amount due</th><th>Paid out</th><th /></tr></thead>
        <tbody>{drivers.map(({ d, due, dueAmount, out }) => <tr key={d.id}>
          <td>{d.name}</td><td>{mask(d.iban)}</td><td>{due.length}</td><td><b>{eur(dueAmount)}</b></td><td>{eur(out)}</td>
          <td>{due.length > 0 && <ActionButton action={payDriver} fields={{ driverId: d.id }} from={HERE} kind="btn-gold btn-sm"
            confirm={`Mark ${eur(dueAmount)} as paid to ${d.name}?`}>Mark paid out</ActionButton>}</td>
        </tr>)}</tbody>
      </table></div>}</div>
  </>;
}
