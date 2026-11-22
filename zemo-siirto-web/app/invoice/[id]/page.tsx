import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/client";
import { dt, eur } from "@/lib/domain";
import { getState } from "@/lib/state";

export const metadata: Metadata = { title: "Invoice" };
const METHODS = { card: "Card", mobilepay: "MobilePay", invoice: "Invoice, 14 days net", trustly: "Bank payment (Trustly)" } as const;

// Visible to the order's customer and to admins (get_app_state only returns orders the user may see).
export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const s = await getState();
  if (!s.session.customerId && !s.session.admin) redirect("/customer/login");
  const { id } = await params;
  const o = s.orders.find(x => x.id === decodeURIComponent(id));
  if (!o || !o.payment) notFound();
  const co = s.company;
  const back = s.session.admin ? `/admin/orders/${o.id}` : "/customer/dashboard";
  return <main className="shell portal-main narrow">
    <div className="row no-print"><Link className="btn btn-light" href={back}>← Back</Link><span className="spacer" /><PrintButton /></div>
    <div className="invoice">
      <div className="row"><div><b className="inv-name">{co.name}</b>
        <div className="muted">{[co.address, co.businessId && `Y-tunnus ${co.businessId}`, co.email, co.phone].filter(Boolean).map(l => <div key={String(l)}>{l}</div>)}</div></div>
        <span className="spacer" />
        <div className="right"><b>INVOICE / LASKU</b><div className="muted">No. {o.id.replace("ZS-", "INV-")}</div><div className="muted">{dt(o.payment.paidAt)}</div></div></div>
      <hr />
      <p><b>Bill to:</b> {o.customer.name}{o.customer.company && `, ${o.customer.company}`}<br /><span className="muted">{o.customer.email} · {o.customer.phone}</span></p>
      <table><thead><tr><th>Description</th><th className="right">Amount</th></tr></thead><tbody>
        <tr><td>Car transfer {o.pickup.city} → {o.dropoff.city} ({o.price.km} km)<br /><span className="muted">{o.car.model}, {o.car.plate} · {o.pickup.date}</span></td><td className="right">{eur(o.price.net)}</td></tr>
        <tr><td>VAT {o.price.vatRate}%</td><td className="right">{eur(o.price.vat)}</td></tr>
        <tr><td><b>Total</b></td><td className="right"><b>{eur(o.price.total)}</b></td></tr>
      </tbody></table>
      <p className="muted">Payment: {METHODS[o.payment.method]}{o.payment.last4 && ` •••• ${o.payment.last4}`}
        {o.payment.method === "invoice" && co.iban && <><br />Pay to IBAN {co.iban}, reference {o.id}</>}
        {o.status === "cancelled" && <><br />ORDER CANCELLED – {o.refundedAt ? `refunded ${dt(o.refundedAt)}` : "refund due"}</>}</p>
    </div>
  </main>;
}
