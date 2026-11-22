import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { payOrder, startTrustlyPayment } from "@/app/actions";
import { AutoRefresh, PaymentForm, SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { eur } from "@/lib/domain";
import { one, requireCustomer, type SearchParams } from "@/lib/state";
import { trustlyEnabled } from "@/lib/trustly";

export const metadata: Metadata = { title: "Payment" };

export default async function Pay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const { id } = await params;
  const sp = await searchParams;
  const o = s.orders.find(x => x.id === decodeURIComponent(id) && x.customerId === user.id);
  if (!o) notFound();
  if (o.status !== "pending_payment") {
    redirect(`/customer/tracking?id=${o.id}${one(sp.result) === "success" ? "&ok=" + encodeURIComponent("Payment received – thank you!") : ""}`);
  }

  const bank = trustlyEnabled();
  const demo = !!s.settings.demoPayments;
  const result = one(sp.result);
  const waiting = o.paymentStatus === "pending" || (result === "success" && o.paymentStatus === "initiated");

  return <>
    <Flash sp={sp} />
    {result === "fail" && <div className="notice error" role="alert">The bank payment was cancelled or did not go through. You can try again.</div>}
    <div className="card narrow">
      <h1>Payment – {o.id}</h1>
      <p className="muted">{o.pickup.city} → {o.dropoff.city} · {o.price.km} km · {o.car.model} ({o.car.plate})</p>
      <div className="price-box"><div className="row"><span>Total incl. VAT</span><span className="spacer" /><span className="total">{eur(o.price.total)}</span></div>
        <div className="muted">Excl. VAT {eur(o.price.net)} + VAT {o.price.vatRate}% {eur(o.price.vat)}</div></div>

      {waiting ? <>
        <AutoRefresh seconds={5} />
        <div className="notice" role="status" id="paymentWaiting">⏳ Waiting for your bank to confirm the payment. This page updates automatically.</div>
        <Link className="btn btn-light" href="/customer/dashboard">Back to dashboard</Link>
      </> : <>
        {bank && <form action={startTrustlyPayment} id="trustlyForm">
          <input type="hidden" name="uuid" value={o.uuid} /><input type="hidden" name="id" value={o.id} />
          <h3>Pay with your bank</h3>
          <p className="muted">You will be sent to Trustly to log in to your own online bank (Nordea, OP, Danske Bank, S-Pankki…) and approve the payment. No card needed.</p>
          <SubmitButton style={{ width: "100%" }}>Pay {eur(o.price.total)} with your bank</SubmitButton>
        </form>}
        {demo && <>
          <h3>{bank ? "Or: demo payment (testing only)" : "Demo payment"}</h3>
          <PaymentForm order={o} action={payOrder} />
        </>}
        {!bank && !demo && <div className="notice error">Online payment is not available at the moment. Please contact us.</div>}
      </>}
    </div>
  </>;
}
