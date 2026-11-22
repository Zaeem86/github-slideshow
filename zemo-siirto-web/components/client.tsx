"use client";
// Small interactive pieces. Everything else is rendered on the server.
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CITY_NAMES, NAV, estimateKm, eur, luhn, priceFor, todayFi, type Portal
} from "@/lib/domain";
import type { Order, Settings } from "@/lib/types";
import { quoteRoute } from "@/app/route-actions";
import { AddressInput, newSession } from "./address";

export type InitialQuote = { id: string; from: string; to: string; km: number; minutes: number; total: number };
type ShownQuote = { id: string; km: number; minutes: number; total: number; net?: number; vat?: number; vatRate?: number };

/** Pickup + delivery address with the road route price from Google (Server Action → route quote). */
function RouteFields({ initial }: { initial?: InitialQuote | null }) {
  const [session] = useState(() => newSession());
  const [a, setA] = useState<{ placeId: string; text: string } | null>(initial ? { placeId: "", text: initial.from } : null);
  const [b, setB] = useState<{ placeId: string; text: string } | null>(initial ? { placeId: "", text: initial.to } : null);
  const [q, setQ] = useState<ShownQuote | null>(initial ?? null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function recalc(na: typeof a, nb: typeof b) {
    setQ(null); setErr("");
    if (!na?.placeId || !nb?.placeId) return;
    setBusy(true);
    const r = await quoteRoute(na.placeId, nb.placeId, session);
    setBusy(false);
    if (r.ok) setQ(r.quote); else setErr(r.error);
  }
  return <>
    <h3>Pickup</h3>
    <label className="field">Address<AddressInput id="fromAddr" session={session} value={a} required placeholder="Street address and city"
      onPick={p => { setA(p); void recalc(p, b); }} /></label>
    <h3>Delivery</h3>
    <label className="field">Address<AddressInput id="toAddr" session={session} value={b} required placeholder="Street address and city"
      onPick={p => { setB(p); void recalc(a, p); }} /></label>
    <input type="hidden" name="quoteId" value={q?.id ?? ""} />
    <h3>Price (real driving distance by road)</h3>
    <div className="price-box" id="quoteBox">{busy ? <span className="muted">Calculating…</span>
      : q ? <div className="row"><div>
          <div className="muted">Road distance: <b>{q.km} km</b> · driving time ≈ {q.minutes >= 60 ? `${Math.floor(q.minutes / 60)} h ${q.minutes % 60} min` : `${q.minutes} min`}</div>
          {q.net != null && <div className="muted">Excl. VAT {eur(q.net)} + VAT {q.vatRate}% {eur(q.vat)}</div>}
        </div><span className="spacer" /><div className="total">{eur(q.total)}</div></div>
      : <span className="muted">{err || "Choose both addresses from the suggestions to see the price."}</span>}</div>
  </>;
}

/** Submit button that disables itself while the Server Action runs. */
export function SubmitButton({ children, kind = "btn-gold", busy = "Please wait…", ...rest }: { children: React.ReactNode; kind?: string; busy?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return <button className={`btn ${kind}`} disabled={pending || rest.disabled} {...rest}>{pending ? busy : children}</button>;
}

/** A one-button form for a Server Action, with an optional confirmation question. */
export function ActionButton({ action, fields, confirm: question, children, kind = "btn-light btn-sm", from, busy }: {
  action: (fd: FormData) => Promise<void>; fields: Record<string, string>; confirm?: string;
  children: React.ReactNode; kind?: string; from: string; busy?: string;
}) {
  return <form action={action} onSubmit={e => { if (question && !window.confirm(question)) e.preventDefault(); }} className="inline">
    {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    <input type="hidden" name="from" value={from} />
    <SubmitButton kind={kind} busy={busy}>{children}</SubmitButton>
  </form>;
}

/** Select whose options are URLs; choosing one navigates there. */
export function GotoSelect({ options, value, label }: { options: [string, string][]; value: string; label: string }) {
  const router = useRouter();
  return <select aria-label={label} value={value} onChange={e => e.target.value && router.push(e.target.value)}>
    {!options.some(([u]) => u === value) && <option value="">Choose…</option>}
    {options.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
  </select>;
}

/** Re-fetch server data every few seconds unless the user is typing or a dialog is open. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      const a = document.activeElement;
      if (document.visibilityState === "visible" && !(a && a.closest("form"))) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function NavLinks({ portal }: { portal: Portal }) {
  const path = usePathname();
  return <nav className="pagenav">{NAV[portal].map(([p, l]) => {
    const href = `/${portal}/${p}`;
    return <Link key={p} href={href} className={path.startsWith(href) ? "active" : ""}>{l}</Link>;
  })}</nav>;
}

export const PrintButton = () => <button className="btn btn-light" onClick={() => window.print()}>Print / Save PDF</button>;

function Quote({ km, s }: { km: number | null; s: Settings }) {
  if (km == null) return <span className="muted">Choose cities to see the price.</span>;
  const q = priceFor(km, s);
  return <div className="row"><div>
    <div className="muted">Estimated road distance: <b>{q.km} km</b></div>
    <div className="muted">Excl. VAT {eur(q.net)} + VAT {q.vatRate}% {eur(q.vat)}</div>
  </div><span className="spacer" /><div className="total">{eur(q.total)}</div></div>;
}

const CityOptions = () => <>{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</>;

export function OrderForm({ settings, action, google = false, initial }: { settings: Settings; action: (fd: FormData) => Promise<void>; google?: boolean; initial?: InitialQuote | null }) {
  const [from, setFrom] = useState("Helsinki"), [to, setTo] = useState("Tampere");
  const today = todayFi();
  if (google) return <form action={action} className="card" id="orderForm">
    <h2>Create a car transfer request</h2>
    <RouteFields initial={initial} />
    <h3>Pickup time and contacts</h3>
    <div className="grid">
      <label className="field">Date<input name="date" type="date" min={today} defaultValue={today} required /></label>
      <label className="field">Time<input name="time" type="time" defaultValue="09:00" required /></label>
      <label className="field">Contact at pickup (optional)<input name="fromContact" maxLength={200} placeholder="Name, phone" /></label>
      <label className="field">Contact at delivery (optional)<input name="toContact" maxLength={200} placeholder="Name, phone" /></label>
    </div>
    <VehicleFields />
    <div className="row mt"><span className="spacer" /><SubmitButton>Continue to payment</SubmitButton></div>
  </form>;
  return <form action={action} className="card" id="orderForm">
    <h2>Create a car transfer request</h2>
    <h3>Pickup</h3>
    <div className="grid">
      <label className="field">City<select name="fromCity" value={from} onChange={e => setFrom(e.target.value)}><CityOptions /></select></label>
      <label className="field">Address<input name="fromAddr" required maxLength={200} placeholder="Street, postcode" /></label>
      <label className="field">Date<input name="date" type="date" min={today} defaultValue={today} required /></label>
      <label className="field">Time<input name="time" type="time" defaultValue="09:00" required /></label>
      <label className="field">Contact at pickup (optional)<input name="fromContact" maxLength={200} placeholder="Name, phone" /></label>
    </div>
    <h3>Delivery</h3>
    <div className="grid">
      <label className="field">City<select name="toCity" value={to} onChange={e => setTo(e.target.value)}><CityOptions /></select></label>
      <label className="field">Address<input name="toAddr" required maxLength={200} placeholder="Street, postcode" /></label>
      <label className="field">Contact at delivery (optional)<input name="toContact" maxLength={200} placeholder="Name, phone" /></label>
    </div>
    <VehicleFields />
    <h3>Price (calculated from the distance)</h3>
    <div className="price-box" id="quoteBox"><Quote km={estimateKm(from, to, settings)} s={settings} /></div>
    <div className="row mt"><span className="spacer" /><SubmitButton>Continue to payment</SubmitButton></div>
  </form>;
}

function VehicleFields() {
  return <>
    <h3>Vehicle</h3>
    <div className="grid">
      <label className="field">Make & model<input name="car" required maxLength={100} placeholder="e.g. Volvo V60" /></label>
      <label className="field">Registration plate<input name="plate" required maxLength={20} placeholder="ABC-123" className="upper" /></label>
      <label className="field">Gearbox<select name="gearbox"><option>Automatic</option><option>Manual</option></select></label>
      <label className="field">Fuel / power<select name="fuel"><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label>
    </div>
    <label className="field">Notes for the driver<textarea name="notes" maxLength={2000} placeholder="Key handover, parking, special instructions…" /></label>
  </>;
}

/** DEMO payment form. The card number is checked here and never sent to the server – only the last 4 digits. */
export function PaymentForm({ order, action }: { order: Order; action: (fd: FormData) => Promise<void> }) {
  const [method, setMethod] = useState("card");
  const [card, setCard] = useState(""), [exp, setExp] = useState(""), [cvc, setCvc] = useState("");
  const [error, setError] = useState("");
  const digits = card.replace(/\D/g, "");
  return <form id="payForm" action={action} onSubmit={e => {
    setError("");
    if (method !== "card") return;
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(exp);
    const msg = !luhn(digits) ? "Invalid card number"
      : !m || +m[1] < 1 || +m[1] > 12 || new Date(2000 + +m[2], +m[1]) < new Date() ? "Invalid expiry date"
      : !/^\d{3,4}$/.test(cvc) ? "Invalid CVC" : "";
    if (msg) { e.preventDefault(); setError(msg); }
  }}>
    <input type="hidden" name="uuid" value={order.uuid} />
    <input type="hidden" name="id" value={order.id} />
    <input type="hidden" name="from" value={`/customer/pay/${order.id}`} />
    <input type="hidden" name="method" value={method} />
    <input type="hidden" name="last4" value={method === "card" ? digits.slice(-4) : ""} />
    <label className="field">Payment method<select id="payMethod" value={method} onChange={e => setMethod(e.target.value)}>
      <option value="card">Card</option><option value="mobilepay">MobilePay</option><option value="invoice">Company invoice (14 days)</option></select></label>
    {method === "card" && <div className="grid">
      {/* No `name` attributes: these values are never submitted. */}
      <label className="field">Card number<input id="cardNumber" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={card} onChange={e => setCard(e.target.value)} /></label>
      <label className="field">Expiry (MM/YY)<input id="cardExp" autoComplete="cc-exp" placeholder="12/28" value={exp} onChange={e => setExp(e.target.value)} /></label>
      <label className="field">CVC<input id="cardCvc" inputMode="numeric" autoComplete="cc-csc" placeholder="123" value={cvc} onChange={e => setCvc(e.target.value)} /></label>
    </div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <p className="notice">Demo mode: payment is simulated. Connect a real provider (e.g. Stripe, Paytrail) before going live.</p>
    <div className="row"><Link className="btn btn-light" href="/customer/dashboard">Pay later</Link><span className="spacer" />
      <SubmitButton>Pay {eur(order.price.total)}</SubmitButton></div>
  </form>;
}

/** Admin: pick a driver for an open order; submits immediately. */
export function AssignSelect({ order, drivers, action, from }: { order: Order; drivers: { id: string; name: string }[]; action: (fd: FormData) => Promise<void>; from: string }) {
  return <form action={action} className="inline">
    <input type="hidden" name="uuid" value={order.uuid} /><input type="hidden" name="from" value={from} />
    <select name="driverId" aria-label={`Assign driver to ${order.id}`} defaultValue="" onChange={e => e.target.value && e.target.form?.requestSubmit()}>
      <option value="">Assign…</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  </form>;
}
