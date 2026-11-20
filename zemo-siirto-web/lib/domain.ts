// Business rules shared by server and client components.
// The pricing formula must stay identical to public._quote() in the database
// (the database is the source of truth; this is only for the live quote).
import type { Order, Settings } from "./types";

export type Portal = "customer" | "driver" | "admin";
export type Status = "pending_payment" | "open" | "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled";

export const CITIES: Record<string, [number, number]> = {
  Helsinki: [60.1699, 24.9384], Espoo: [60.2055, 24.6559], Vantaa: [60.2934, 25.0378],
  Porvoo: [60.3923, 25.6651], Tampere: [61.4978, 23.761], Turku: [60.4518, 22.2666],
  Salo: [60.3831, 23.1286], "Hämeenlinna": [60.9959, 24.4643], Lahti: [60.9827, 25.6612],
  Kotka: [60.4664, 26.9458], Kouvola: [60.8681, 26.7042], Lappeenranta: [61.0587, 28.1887],
  Mikkeli: [61.6886, 27.2723], "Jyväskylä": [62.2426, 25.7473], Kuopio: [62.8924, 27.677],
  Joensuu: [62.601, 29.7636], Pori: [61.4851, 21.7974], Rauma: [61.1272, 21.5113],
  Vaasa: [63.0951, 21.6165], "Seinäjoki": [62.7903, 22.8403], Kokkola: [63.8385, 23.1307],
  Oulu: [65.0121, 25.4651], Kajaani: [64.2222, 27.7278], Rovaniemi: [66.5039, 25.7294]
};
export const CITY_NAMES = Object.keys(CITIES).sort((a, b) => a.localeCompare(b, "fi"));

export const STATUS_FLOW: Status[] = ["pending_payment", "open", "assigned", "picked_up", "in_transit", "delivered"];
export const STATUS_LABEL: Record<Status, string> = {
  pending_payment: "Awaiting payment", open: "Paid – finding driver", assigned: "Driver assigned",
  picked_up: "Car picked up", in_transit: "In transit", delivered: "Delivered", cancelled: "Cancelled"
};
export const STATUS_TONE: Record<Status, string> = {
  pending_payment: "warn", open: "info", assigned: "info", picked_up: "info", in_transit: "info", delivered: "ok", cancelled: "bad"
};
export const ACTIVE: Status[] = ["assigned", "picked_up", "in_transit"];

export const DRIVER_STATUS = {
  pending: ["Pending verification", "warn"], approved: ["Approved", "ok"],
  rejected: ["Rejected", "bad"], suspended: ["Suspended", "bad"]
} as const;

export const AREAS = ["Front", "Rear", "Left side", "Right side", "Roof", "Wheels & tyres", "Windscreen & glass", "Interior"];
export const CONDITIONS = ["OK", "Scratch", "Dent", "Crack / chip", "Other damage"];
export const FUEL_LEVELS = ["Full", "3/4", "1/2", "1/4", "Reserve"];

export const NAV: Record<Portal, [string, string][]> = {
  customer: [["dashboard", "Dashboard"], ["create-order", "New transfer"], ["tracking", "Tracking"]],
  driver: [["available-jobs", "Available jobs"], ["my-jobs", "My jobs"], ["inspection", "Inspection"],
    ["navigation", "Navigation"], ["earnings", "Earnings"], ["profile", "Profile"]],
  admin: [["dashboard", "Dashboard"], ["drivers", "Drivers"], ["customers", "Customers"], ["orders", "Orders"],
    ["pricing", "Pricing"], ["payments", "Payments"], ["settings", "Settings"]]
};
export const DEFAULT_PAGE: Record<Portal, string> = { customer: "dashboard", driver: "available-jobs", admin: "dashboard" };
export const PORTAL_LABEL: Record<Portal, string> = { customer: "Customer", driver: "Driver", admin: "Admin" };

export const DEFAULT_SETTINGS: Settings = {
  baseFee: 49, perKm: 0.95, minPrice: 79, vatRate: 25.5, driverShare: 65, roadFactor: 1.15, sameCityKm: 15
};

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateKm(from: string | undefined, to: string | undefined, s: Settings): number | null {
  if (!from || !to || !CITIES[from] || !CITIES[to]) return null;
  if (from === to) return +s.sameCityKm;
  return Math.round(haversine(CITIES[from], CITIES[to]) * s.roadFactor);
}

export function priceFor(km: number, s: Settings) {
  const netCents = Math.max(Math.round(s.minPrice * 100), Math.round(s.baseFee * 100) + Math.round(s.perKm * 100) * km);
  const vatCents = Math.round((netCents * s.vatRate) / 100);
  return { km, net: netCents / 100, vat: vatCents / 100, total: (netCents + vatCents) / 100, vatRate: +s.vatRate };
}

export const driverPay = (o: Order, s: Settings) => Math.round(o.price.net * (o.price.driverShare ?? s.driverShare)) / 100;

export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n || 0);

export const dt = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("fi-FI", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Helsinki" }).format(new Date(iso)) : "–";

/** Today's date in Finland as YYYY-MM-DD. */
export const todayFi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date());

export const yearsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 31557600000;
export const validIban = (s: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s.replace(/\s/g, "").toUpperCase());
export const mask = (s: string | undefined) => String(s || "").replace(/.(?=.{4})/g, "•");

export function luhn(num: string) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = +num[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return num.length >= 12 && sum % 10 === 0;
}
