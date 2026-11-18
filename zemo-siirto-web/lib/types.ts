// Shape of the JSON returned by public.get_app_state() (see supabase/migrations/*_app_api.sql).
import type { Status } from "./domain";

export type Settings = {
  baseFee: number; perKm: number; minPrice: number; vatRate: number;
  driverShare: number; roadFactor: number; sameCityKm: number; demoPayments?: boolean;
};

export type Company = { name: string; businessId: string; email: string; phone: string; address: string; iban: string };

export type Inspection = {
  at: string; odo: number; fuel: string; keys: number | null; docs: boolean;
  areas: Record<string, string>; notes: string; photos: string[]; person: string;
};

export type Order = {
  id: string; uuid: string; createdAt: string; customerId: string;
  customer: { name: string; email: string; phone: string; company: string };
  pickup: { city: string; address: string; date: string; time: string; contact: string };
  dropoff: { city: string; address: string; contact: string };
  car: { model: string; plate: string; gearbox: string; fuel: string };
  notes: string;
  price: { km: number; net: number; vat: number; total: number; vatRate: number; driverShare: number };
  status: Status;
  history: { status: Status; at: string }[];
  driverId: string;
  rejectedBy: string[];
  inspection: { pickup?: Inspection; delivery?: Inspection };
  payment: null | { method: "card" | "mobilepay" | "invoice" | "trustly"; last4: string | null; paidAt: string };
  /** Latest online payment attempt (Trustly): initiated | pending | paid | cancelled | failed | debited | refunded */
  paymentStatus?: string | null;
  refundedAt: string | null;
  driverPaidAt: string | null;
};

export type DriverStatus = "pending" | "approved" | "rejected" | "suspended";

export type Driver = {
  id: string; status: DriverStatus; name: string; phone: string;
  email?: string; city?: string; dob?: string; licenseNo?: string; licenseClass?: string;
  licenseExpiry?: string; iban?: string; licensePhoto?: string; createdAt?: string;
};

export type Customer = { id: string; name: string; email: string; phone: string; company: string; createdAt: string };

export type AppState = {
  settings: Settings;
  company: Company;
  session: { customerId: string; driverId: string; admin: boolean };
  admin: { email: string } | null;
  orders: Order[];
  drivers: Driver[];
  customers: Customer[];
};
