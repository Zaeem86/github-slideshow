import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { payOrder } from "@/app/actions";
import { PaymentForm } from "@/components/client";
import { Flash } from "@/components/ui";
import { eur } from "@/lib/domain";
import { requireCustomer, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Payment" };

export default async function Pay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const { id } = await params;
  const sp = await searchParams;
  const o = s.orders.find(x => x.id === decodeURIComponent(id) && x.customerId === user.id);
  if (!o) notFound();
  if (o.status !== "pending_payment") redirect(`/customer/tracking?id=${o.id}`);
  return <>
    <Flash sp={sp} />
    <div className="card narrow">
      <h1>Payment – {o.id}</h1>
      <p className="muted">{o.pickup.city} → {o.dropoff.city} · {o.price.km} km · {o.car.model} ({o.car.plate})</p>
      <div className="price-box"><div className="row"><span>Total incl. VAT</span><span className="spacer" /><span className="total">{eur(o.price.total)}</span></div>
        <div className="muted">Excl. VAT {eur(o.price.net)} + VAT {o.price.vatRate}% {eur(o.price.vat)}</div></div>
      <PaymentForm order={o} action={payOrder} />
    </div>
  </>;
}
