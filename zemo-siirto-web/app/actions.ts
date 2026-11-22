"use server";
// Every change in the app goes through these Server Actions. Each one calls a
// role-checked database function (supabase/migrations/*_app_api.sql) with the
// signed-in user's session; the database decides what is allowed.
// Result messages travel back in the URL (?ok=… / ?error=…) and are shown by <Flash>.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PAGE, todayFi, validIban, yearsSince, type Portal } from "@/lib/domain";
import type { AppState } from "@/lib/types";
import { amountString, trustlyCall, trustlyConfig, trustlyEnabled } from "@/lib/trustly";
import { serviceRpc } from "@/lib/supabase/service";
import { googleEnabled } from "@/lib/google";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const PORTALS: Portal[] = ["customer", "driver", "admin"];

/** Only allow redirects to paths on this site. */
function safePath(p: string, fallback: string) {
  return p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : fallback;
}
function withMsg(path: string, kind: "ok" | "error", msg: string) {
  const [base, q = ""] = path.split("?");
  const sp = new URLSearchParams(q);
  sp.delete("ok"); sp.delete("error"); sp.set(kind, msg);
  return `${base}?${sp}`;
}
async function attempt<T>(fn: () => Promise<T>): Promise<{ data?: T; error?: string }> {
  try { return { data: await fn() }; } catch (e) { return { error: e instanceof Error ? e.message : "Something went wrong" }; }
}
async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Run fn; on error go back to the form's page with the message, otherwise to `to` (default: same page). */
async function step(fd: FormData, fn: () => Promise<unknown>, okMsg: string, to?: string): Promise<never> {
  const from = safePath(str(fd, "from"), "/");
  const { error } = await attempt(fn);
  if (error) redirect(withMsg(from, "error", error));
  revalidatePath("/", "layout");
  redirect(withMsg(to ?? from, "ok", okMsg));
}

// ---------------------------------------------------------------- auth
export async function signIn(fd: FormData) {
  const portal = str(fd, "portal") as Portal;
  if (!PORTALS.includes(portal)) redirect("/");
  const login = `/${portal}/login`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(fd, "email"), password: String(fd.get("password") ?? "") });
  if (error) redirect(withMsg(login, "error", /confirm/i.test(error.message) ? "Please confirm your email first (check your inbox)" : "Wrong email or password"));

  const { data } = await supabase.rpc("get_app_state");
  const s = data as AppState | null;
  const ok = portal === "admin" ? !!s?.session.admin : portal === "driver" ? !!s?.session.driverId : !!s?.session.customerId;
  if (!ok) {
    await supabase.auth.signOut();
    redirect(withMsg(login, "error", `This is not a ${portal} account`));
  }
  const next = str(fd, "next");
  redirect(next.startsWith(`/${portal}/`) ? safePath(next, `/${portal}`) : `/${portal}/${DEFAULT_PAGE[portal]}`);
}

export async function signUp(fd: FormData) {
  const role = str(fd, "role") === "driver" ? "driver" : "customer";
  const login = `/${role}/login`;
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) redirect(withMsg(login, "error", "Password must be at least 8 characters"));

  let data: Record<string, string> = { full_name: str(fd, "name"), phone: str(fd, "phone") };
  if (role === "customer") {
    data.company = str(fd, "company");
  } else {
    const dob = str(fd, "dob"), expiry = str(fd, "licenseExpiry"), iban = str(fd, "iban");
    if (!dob || yearsSince(dob) < 20) redirect(withMsg(login, "error", "Drivers must be at least 20 years old"));
    if (!expiry || expiry < todayFi()) redirect(withMsg(login, "error", "Driving licence has expired"));
    if (!validIban(iban)) redirect(withMsg(login, "error", "Invalid IBAN"));
    data = { ...data, home_city: str(fd, "city"), date_of_birth: dob, license_number: str(fd, "licenseNo"),
      license_class: str(fd, "licenseClass"), license_expiry: expiry, iban };
  }

  const h = await headers();
  const origin = h.get("origin") || `https://${h.get("host")}`;
  const supabase = await createClient();
  const { data: res, error } = await supabase.auth.signUp({
    email: str(fd, "email"), password,
    options: { data: { ...data, role }, emailRedirectTo: `${origin}/auth/callback?next=/${role}` }
  });
  if (error) redirect(withMsg(login, "error", error.message));
  if (!res.session) redirect(withMsg(login, "ok", "Check your email and open the confirmation link, then sign in."));
  revalidatePath("/", "layout");
  redirect(role === "customer"
    ? withMsg("/customer/create-order", "ok", "Account created – welcome!")
    : withMsg("/driver/profile", "ok", "Registration submitted – awaiting verification"));
}

export async function changePassword(fd: FormData) {
  return step(fd, async () => {
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) throw new Error("New password must be at least 8 characters");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error("Please sign in first");
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: String(fd.get("current") ?? "") });
    if (check.error) throw new Error("Current password is wrong");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }, "Password changed");
}

// ---------------------------------------------------------------- customer
export async function updateMyProfile(fd: FormData) {
  return step(fd, () => rpc("update_my_profile", { p: { name: str(fd, "name"), phone: str(fd, "phone"), company: str(fd, "company") } }), "Saved");
}

export async function createOrder(fd: FormData) {
  if (googleEnabled() && !str(fd, "quoteId")) redirect(withMsg("/customer/create-order", "error", "Choose both addresses from the suggestions to get the price"));
  const { data, error } = await attempt(() => rpc<{ id: string }>("create_order", { p: {
    pickup_city: str(fd, "fromCity"), pickup_address: str(fd, "fromAddr"), pickup_date: str(fd, "date"),
    pickup_time: str(fd, "time"), pickup_contact: str(fd, "fromContact"),
    dropoff_city: str(fd, "toCity"), dropoff_address: str(fd, "toAddr"), dropoff_contact: str(fd, "toContact"),
    car_model: str(fd, "car"), car_plate: str(fd, "plate").toUpperCase(), gearbox: str(fd, "gearbox"), fuel: str(fd, "fuel"),
    notes: str(fd, "notes"), quote_id: str(fd, "quoteId")
  } }));
  if (error || !data) redirect(withMsg("/customer/create-order", "error", error || "Could not create the order"));
  revalidatePath("/", "layout");
  redirect(`/customer/pay/${encodeURIComponent(data.id)}`);
}

/** DEMO payment: card details never leave the browser; only the method and last 4 digits are sent. */
export async function payOrder(fd: FormData) {
  const method = str(fd, "method"), last4 = str(fd, "last4");
  return step(fd, () => rpc("demo_pay_order", { p_order: str(fd, "uuid"), p_method: method, p_last4: method === "card" ? last4 : null }),
    "Booking confirmed – thank you!", `/customer/tracking?id=${encodeURIComponent(str(fd, "id"))}`);
}

/**
 * Real bank payment with Trustly: create a payment attempt, ask Trustly for a payment link
 * (Deposit), store Trustly's order id, and send the customer to Trustly. The order becomes paid
 * only when Trustly's signed "credit" notification arrives (app/api/trustly/notifications).
 */
export async function startTrustlyPayment(fd: FormData) {
  const id = str(fd, "id");
  const from = `/customer/pay/${encodeURIComponent(id)}`;
  if (!trustlyEnabled()) redirect(withMsg(from, "error", "Bank payment is not available yet"));
  const { data: checkoutUrl, error } = await attempt(async () => {
    const p = await rpc<{ payment_id: string; order_number: string; amount_cents: number; currency: string; customer_id: string; email: string; full_name: string }>(
      "start_payment", { p_order: str(fd, "uuid"), p_provider: "trustly" });
    const c = trustlyConfig();
    const [first = "", ...rest] = (p.full_name || "").trim().split(/\s+/);
    const back = (result: string) => `${c.appUrl}/customer/pay/${encodeURIComponent(p.order_number)}?result=${result}`;
    const r = await trustlyCall("Deposit",
      { NotificationURL: `${c.appUrl}/api/trustly/notifications`, EndUserID: p.customer_id, MessageID: p.payment_id },
      { Currency: p.currency, Amount: amountString(p.amount_cents), Firstname: first, Lastname: rest.join(" "), Email: p.email,
        Country: "FI", Locale: "fi_FI", SuccessURL: back("success"), FailURL: back("fail"), ShopperStatement: "Zemo Siirto" });
    const url = String(r.url ?? ""), orderid = String(r.orderid ?? "");
    if (!url.startsWith("https://") && c.env === "production") throw new Error("Payment provider returned an invalid link");
    if (!url || !orderid) throw new Error("Payment provider did not return a payment link");
    await serviceRpc("attach_provider_order", { p_payment: p.payment_id, p_provider_order_id: orderid, p_checkout_url: url });
    return url;
  });
  if (error || !checkoutUrl) redirect(withMsg(from, "error", error || "Could not start the payment"));
  redirect(checkoutUrl);
}

/** Admin: return a Trustly payment for a cancelled order through Trustly's Refund API. */
export async function refundViaTrustly(fd: FormData) {
  return step(fd, async () => {
    if (!trustlyEnabled()) throw new Error("Trustly is not configured");
    const info = await rpc<{ payment_id: string; provider_order_id: string; amount_cents: number; currency: string }>(
      "admin_refund_info", { p_order: str(fd, "uuid") });
    const r = await trustlyCall("Refund", { OrderID: info.provider_order_id, Amount: amountString(info.amount_cents), Currency: info.currency }, null);
    if (String(r.result) !== "1") throw new Error("The refund was not accepted by the payment provider");
    await serviceRpc("complete_refund", { p_payment: info.payment_id });
  }, "Refund sent via Trustly");
}

export async function cancelOrder(fd: FormData) {
  return step(fd, () => rpc("cancel_order", { p_order: str(fd, "uuid") }), "Order cancelled");
}

// ---------------------------------------------------------------- driver
export async function updateDriverProfile(fd: FormData) {
  return step(fd, async () => {
    if (!validIban(str(fd, "iban"))) throw new Error("Invalid IBAN");
    await rpc("update_driver_profile", { p: { phone: str(fd, "phone"), city: str(fd, "city"), iban: str(fd, "iban") } });
  }, "Tallennettu");
}

export async function acceptJob(fd: FormData) {
  return step(fd, async () => {
    const r = await rpc<{ success: boolean; message: string }>("accept_transfer", { p_order_id: str(fd, "uuid") });
    if (!r?.success) throw new Error(r?.message || "Could not accept the job");
  }, "Tehtävä hyväksytty", "/driver/my-jobs");
}

// ---------------------------------------------------------------- admin
export async function setDriverStatus(fd: FormData) {
  const status = str(fd, "status");
  return step(fd, () => rpc("admin_set_driver_status", { p_driver: str(fd, "driverId"), p_status: status }), `Driver ${status}`);
}

export async function assignDriver(fd: FormData) {
  return step(fd, () => rpc("admin_assign_driver", { p_order: str(fd, "uuid"), p_driver: str(fd, "driverId") }), "Driver assigned");
}

export async function markRefunded(fd: FormData) {
  return step(fd, () => rpc("admin_mark_refunded", { p_order: str(fd, "uuid") }), "Marked refunded");
}

export async function payDriver(fd: FormData) {
  return step(fd, () => rpc("create_driver_payout", { p_driver: str(fd, "driverId"), p_mark_paid: true }), "Payout recorded");
}

export async function updateSettings(fd: FormData) {
  const keys = ["baseFee", "perKm", "minPrice", "vatRate", "driverShare", "roadFactor", "sameCityKm"];
  return step(fd, () => rpc("admin_update_settings", { p: Object.fromEntries(keys.map(k => [k, Number(str(fd, k))])) }), "Pricing saved");
}

export async function updateCompany(fd: FormData) {
  const keys = ["name", "businessId", "email", "phone", "address", "iban"];
  return step(fd, () => rpc("admin_update_company", { p: Object.fromEntries(keys.map(k => [k, str(fd, k)])) }), "Company details saved");
}
