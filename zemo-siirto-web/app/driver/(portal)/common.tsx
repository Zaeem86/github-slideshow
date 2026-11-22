// Helpers shared by the driver pages (ZEMO driver app, Finnish).
import { ACTIVE, driverPay } from "@/lib/domain";
import type { AppState, Driver, Order } from "@/lib/types";

/** Shown instead of job pages until the driver is approved. */
export function Gate({ d }: { d: Driver }) {
  const msg = {
    pending: "Hakemuksesi on ZEMOn tarkistettavana. Voit ottaa tehtäviä vastaan, kun hakemus on hyväksytty.",
    rejected: "Hakemustasi ei hyväksytty. Ota yhteyttä tukeen: tuki@zemosiirto.fi",
    suspended: "Tilisi on jäädytetty. Ota yhteyttä tukeen: tuki@zemosiirto.fi", approved: ""
  }[d.status];
  return <div className="card" id="driverGate"><h2>Ei vielä käytettävissä</h2><p className="sub" style={{ margin: 0 }}>{msg}</p></div>;
}

export const activeJobs = (s: AppState, d: Driver) => s.orders.filter(o => o.driverId === d.id && ACTIVE.includes(o.status));
export const payOf = (o: Order, s: AppState) => driverPay(o, s.settings);

/** "2026-11-23" → "23.11.2026" */
export const fiDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso; };
export const when = (o: Order) => fiDate(o.pickup.date) + (o.pickup.time ? ` klo ${o.pickup.time.slice(0, 5)}` : "");

/** Pickup moment (Helsinki time) as a timestamp. */
export function pickupAt(o: Order): number {
  const [y, m, d] = o.pickup.date.split("-").map(Number), [hh, mm] = (o.pickup.time || "23:59").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (wall - guess);
}
/** Pickup within 24 hours (or overdue): red frame. */
export const isSoon = (o: Order, now: number) => pickupAt(o) - now <= 24 * 3600 * 1000;
export const byTime = (a: Order, b: Order) => pickupAt(a) - pickupAt(b);
/** Request time (server components render once per request). */
export const requestTime = () => Date.now();
