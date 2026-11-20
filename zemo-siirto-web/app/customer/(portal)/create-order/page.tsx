import type { Metadata } from "next";
import { createOrder } from "@/app/actions";
import { OrderForm } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireCustomer, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "New transfer" };

export default async function CreateOrder({ searchParams }: { searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const sp = await searchParams;
  return <>
    <Flash sp={sp} />
    <p className="muted">Booking as {user.name} · {user.email} · {user.phone}</p>
    <div className="notice">Service model: an approved independent driver drives your own car to the destination. This is not vehicle transport by truck.</div>
    <OrderForm settings={s.settings} action={createOrder} />
  </>;
}
