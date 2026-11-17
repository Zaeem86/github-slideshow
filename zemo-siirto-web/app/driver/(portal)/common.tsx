// Helpers shared by the driver pages.
import { DriverBadge, OrderSummary } from "@/components/ui";
import { ACTIVE, driverPay, eur } from "@/lib/domain";
import type { AppState, Driver, Order } from "@/lib/types";

/** Shown instead of job pages until the driver is approved. */
export function Gate({ d }: { d: Driver }) {
  const msg = {
    pending: "Your documents are being reviewed by Zemo Siirto. You can take jobs once you are approved.",
    rejected: "Your application was not approved. Please contact support.",
    suspended: "Your account is suspended. Please contact support.", approved: ""
  }[d.status];
  return <div className="card"><div className="row"><h1 className="m0">Not available yet</h1><DriverBadge d={d} /></div><p className="muted">{msg}</p></div>;
}

export const activeJobs = (s: AppState, d: Driver) => s.orders.filter(o => o.driverId === d.id && ACTIVE.includes(o.status));

export function JobCard({ o, s, children, extra }: { o: Order; s: AppState; children?: React.ReactNode; extra?: React.ReactNode }) {
  return <div className="card">
    <OrderSummary o={o} opts={{ hidePrice: true, hideDriver: true, contacts: ACTIVE.includes(o.status) }} />
    <div className="row mt"><span className="muted">{o.price.km} km · your pay</span><b>{eur(driverPay(o, s.settings))}</b></div>
    {extra}
    <div className="row mt">{children}</div>
  </div>;
}
