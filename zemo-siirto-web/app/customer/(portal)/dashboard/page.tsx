import type { Metadata } from "next";
import Link from "next/link";
import { cancelOrder, updateMyProfile } from "@/app/actions";
import { ActionButton, AutoRefresh, SubmitButton } from "@/components/client";
import { Flash, From, Stat, StatusBadge } from "@/components/ui";
import { eur } from "@/lib/domain";
import { requireCustomer, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Dashboard" };
const HERE = "/customer/dashboard";

export default async function CustomerDashboard({ searchParams }: { searchParams: SearchParams }) {
  const { s, user } = await requireCustomer();
  const sp = await searchParams;
  const list = s.orders.filter(o => o.customerId === user.id).reverse();
  const active = list.filter(o => !["delivered", "cancelled"].includes(o.status));
  const spent = list.filter(o => o.payment && o.status !== "cancelled").reduce((t, o) => t + o.price.total, 0);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card">
      <div className="row"><h1 className="m0">Hei, {user.name.split(" ")[0]}!</h1><span className="spacer" />
        <Link className="btn btn-gold" href="/customer/create-order">+ New transfer</Link></div>
      <div className="stat-grid">
        <Stat label="Active transfers" value={active.length} />
        <Stat label="Delivered" value={list.filter(o => o.status === "delivered").length} />
        <Stat label="Total spent" value={eur(spent)} />
      </div>
    </div>
    <div className="card">
      <h2>My orders & invoices</h2>
      {!list.length ? <div className="empty">No orders yet.</div> :
        <div className="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Date</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>
          {list.map(o => <tr key={o.id}>
            <td>{o.id}</td><td>{o.pickup.city} → {o.dropoff.city}</td><td>{o.pickup.date}</td><td>{eur(o.price.total)}</td>
            <td><StatusBadge status={o.status} /></td>
            <td><div className="row nowrap">
              <Link className="btn btn-light btn-sm" href={`/customer/tracking?id=${o.id}`}>Track</Link>
              {o.payment ? <Link className="btn btn-light btn-sm" href={`/invoice/${o.id}`}>Invoice</Link>
                : o.status !== "cancelled" && <Link className="btn btn-gold btn-sm" href={`/customer/pay/${o.id}`}>Pay</Link>}
              {["pending_payment", "open"].includes(o.status) &&
                <ActionButton action={cancelOrder} fields={{ uuid: o.uuid }} from={HERE} kind="btn-danger btn-sm"
                  confirm={`Cancel order ${o.id}?${o.payment ? " The payment will be refunded." : ""}`}>Cancel</ActionButton>}
            </div></td>
          </tr>)}
        </tbody></table></div>}
    </div>
    <form className="card" id="customerProfile" action={updateMyProfile}>
      <h2>Account</h2><From path={HERE} />
      <div className="grid">
        <label className="field">Full name<input name="name" required defaultValue={user.name} /></label>
        <label className="field">Phone<input name="phone" type="tel" required defaultValue={user.phone} /></label>
        <label className="field">Company<input name="company" defaultValue={user.company} /></label>
        <label className="field">Email<input value={user.email} disabled /></label>
      </div>
      <div className="row mt"><span className="spacer" /><SubmitButton kind="btn-light">Save</SubmitButton></div>
    </form>
  </>;
}
