import type { Metadata } from "next";
import { AutoRefresh } from "@/components/client";
import { Flash, Stat } from "@/components/ui";
import { ACTIVE, driverPay, dt, eur, mask } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import type { Order } from "@/lib/types";

export const metadata: Metadata = { title: "Earnings" };

export default async function Earnings({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  const mine = s.orders.filter(o => o.driverId === d.id);
  const done = mine.filter(o => o.status === "delivered");
  const active = mine.filter(o => ACTIVE.includes(o.status));
  const sum = (arr: Order[]) => arr.reduce((t, o) => t + driverPay(o, s.settings), 0);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Earnings</h1>
      <div className="stat-grid">
        <Stat label="Earned" value={eur(sum(done))} />
        <Stat label="Paid out" value={eur(sum(done.filter(o => o.driverPaidAt)))} />
        <Stat label="Awaiting payout" value={eur(sum(done.filter(o => !o.driverPaidAt)))} />
        <Stat label="Pending (active jobs)" value={eur(sum(active))} />
        <Stat label="Completed jobs" value={done.length} />
        <Stat label="Kilometres driven" value={done.reduce((t, o) => t + o.price.km, 0)} />
      </div>
      <p className="muted">You earn {s.settings.driverShare}% of the transfer price excl. VAT. Payouts go to {mask(d.iban)}.</p>
      {done.length > 0 && <div className="table-scroll"><table>
        <thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Pay</th><th>Payout</th></tr></thead>
        <tbody>{[...done].reverse().map(o => <tr key={o.id}><td>{o.id}</td><td>{o.pickup.city} → {o.dropoff.city}</td><td>{dt(o.history.at(-1)?.at)}</td>
          <td>{eur(driverPay(o, s.settings))}</td>
          <td>{o.driverPaidAt ? <span className="badge ok">Paid {dt(o.driverPaidAt)}</span> : <span className="badge warn">Pending</span>}</td></tr>)}</tbody>
      </table></div>}
    </div>
  </>;
}
