import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, InspectionReport, OrderSummary, Timeline } from "@/components/ui";
import { requireAdmin, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Order details" };

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const o = s.orders.find(x => x.id === decodeURIComponent(id));
  if (!o) notFound();
  return <>
    <Flash sp={sp} />
    <div className="row mb"><Link className="btn btn-light btn-sm" href="/admin/orders">← All orders</Link></div>
    <div className="card">
      <OrderSummary o={o} opts={{ contacts: true, driverPhone: true, driver: s.drivers.find(d => d.id === o.driverId) }} />
      <p className="muted">Customer: {o.customer.name} · {o.customer.email} · {o.customer.phone}</p>
      <h3>Status</h3><Timeline o={o} />
      {o.payment && <Link className="btn btn-light" href={`/invoice/${o.id}`}>Invoice</Link>}
      <InspectionReport o={o} />
    </div>
  </>;
}
