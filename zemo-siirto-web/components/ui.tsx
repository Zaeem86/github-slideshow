// Presentational server components shared by all portals.
import Link from "next/link";
import { AREAS, DRIVER_STATUS, STATUS_FLOW, STATUS_LABEL, STATUS_TONE, dt, type Status } from "@/lib/domain";
import type { Driver, Inspection, Order } from "@/lib/types";

export const StatusBadge = ({ status }: { status: Status }) =>
  <span className={`badge ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;

export const DriverBadge = ({ d }: { d: Driver }) => {
  const [label, tone] = DRIVER_STATUS[d.status] ?? [d.status, ""];
  return <span className={`badge ${tone}`}>{label}</span>;
};

export const Stat = ({ label, value }: { label: string; value: React.ReactNode }) =>
  <div className="stat"><span className="muted">{label}</span><strong>{value}</strong></div>;

export const Empty = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) =>
  <div className="card empty">{children}{action && <div className="mt">{action}</div>}</div>;

/** Hidden field telling a Server Action where to send the user back to. */
export const From = ({ path }: { path: string }) => <input type="hidden" name="from" value={path} />;

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : "", error = typeof sp.error === "string" ? sp.error : "";
  return <>
    {ok && <div className="notice ok" role="status">{ok}</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
  </>;
}

export function Timeline({ o }: { o: Order }) {
  if (o.status === "cancelled") return <p><StatusBadge status="cancelled" /> <span className="muted">{dt(o.history.at(-1)?.at)}</span></p>;
  const idx = STATUS_FLOW.indexOf(o.status);
  return <ul className="timeline">{STATUS_FLOW.map((s, i) => {
    const h = [...o.history].reverse().find(x => x.status === s);
    const cls = i < idx || o.status === "delivered" ? "done" : i === idx ? "done current" : "";
    return <li key={s} className={cls}>{STATUS_LABEL[s]}{h && <span className="muted"> · {dt(h.at)}</span>}</li>;
  })}</ul>;
}

type SummaryOpts = { hidePrice?: boolean; hideDriver?: boolean; contacts?: boolean; driverPhone?: boolean; driver?: Driver };

export function OrderSummary({ o, opts = {} }: { o: Order; opts?: SummaryOpts }) {
  const d = opts.driver;
  return <>
    <div className="row"><h2 className="m0">{o.id}</h2><StatusBadge status={o.status} /><span className="spacer" />
      {!opts.hidePrice && <b>{new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(o.price.total)}</b>}</div>
    <div className="grid mt">
      <div><div className="muted">Pickup</div>{o.pickup.address}, {o.pickup.city}<br />{o.pickup.date} {o.pickup.time}
        {opts.contacts && o.pickup.contact && <><br /><span className="muted">Contact: {o.pickup.contact}</span></>}</div>
      <div><div className="muted">Delivery</div>{o.dropoff.address}, {o.dropoff.city}
        {opts.contacts && o.dropoff.contact && <><br /><span className="muted">Contact: {o.dropoff.contact}</span></>}</div>
      <div><div className="muted">Vehicle</div>{o.car.model} · {o.car.plate}<br />{o.car.gearbox}, {o.car.fuel}</div>
      {!opts.hideDriver && <div><div className="muted">Driver</div>{d ? <>{d.name}{opts.driverPhone && d.phone && <><br /><a href={`tel:${d.phone}`}>{d.phone}</a></>}</> : <span className="muted">Not yet assigned</span>}</div>}
    </div>
    {o.notes && <p className="notice">{o.notes}</p>}
  </>;
}

function Cond({ v }: { v?: string }) {
  if (!v) return <span className="muted">–</span>;
  return v === "OK" ? <span className="badge ok">OK</span> : <span className="badge warn">{v}</span>;
}
function InspectionMeta({ s, label, who }: { s?: Inspection; label: string; who: string }) {
  if (!s) return null;
  return <div><div className="muted">{label} · {dt(s.at)}</div>
    {s.odo} km · fuel {s.fuel}{s.keys != null && ` · ${s.keys} key(s)`}{s.docs && " · documents ✓"}
    <br />{who}: {s.person}{s.photos?.length > 0 && <><br />📷 {s.photos.length} photo(s)</>}{s.notes && <><br /><i>{s.notes}</i></>}</div>;
}

export function InspectionReport({ o }: { o: Order }) {
  const { pickup, delivery } = o.inspection || {};
  if (!pickup && !delivery) return null;
  return <>
    <h3>Inspection report</h3>
    <div className="grid"><InspectionMeta s={pickup} label="Pickup" who="Handed over by" /><InspectionMeta s={delivery} label="Delivery" who="Received by" /></div>
    <div className="table-scroll mt"><table><thead><tr><th>Area</th><th>Pickup</th><th>Delivery</th></tr></thead><tbody>
      {AREAS.map(a => {
        const p = pickup?.areas[a], d = delivery?.areas[a];
        return <tr key={a}><td>{a}</td><td><Cond v={p} /></td><td><Cond v={d} />{p === "OK" && d && d !== "OK" && <> <span className="badge bad">New damage</span></>}</td></tr>;
      })}
    </tbody></table></div>
  </>;
}

export const LinkButton = ({ href, children, kind = "" }: { href: string; children: React.ReactNode; kind?: string }) =>
  <Link className={`btn ${kind}`} href={href}>{children}</Link>;
