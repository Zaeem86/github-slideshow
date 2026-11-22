import type { Metadata } from "next";
import { createOrder } from "@/app/actions";
import { OrderForm } from "@/components/client";
import { Flash } from "@/components/ui";
import { googleEnabled } from "@/lib/google";
import { one, requireCustomer, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "New transfer" };

// Price checked on the main page: ?quote=…&a=…&b=…&km=…&min=…&t=… (display only; the database prices the order from the quote).
function initialQuote(sp: Record<string, string | string[] | undefined>) {
  const id = one(sp.quote);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return { id, from: one(sp.a).slice(0, 200), to: one(sp.b).slice(0, 200), km: Number(one(sp.km)) || 0, minutes: Number(one(sp.min)) || 0, total: Number(one(sp.t)) || 0 };
}

export default async function CreateOrder({ searchParams }: { searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const sp = await searchParams;
  return <>
    <Flash sp={sp} />
    <p className="muted">Booking as {user.name} · {user.email} · {user.phone}</p>
    <div className="notice">Service model: an approved independent driver drives your own car to the destination. This is not vehicle transport by truck.</div>
    <OrderForm settings={s.settings} action={createOrder} google={googleEnabled()} initial={initialQuote(sp)} />
  </>;
}
