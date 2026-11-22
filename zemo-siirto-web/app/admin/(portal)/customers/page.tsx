import type { Metadata } from "next";
import { dt, eur } from "@/lib/domain";
import { requireAdmin } from "@/lib/state";

export const metadata: Metadata = { title: "Customers" };

export default async function Customers() {
  const { s } = await requireAdmin();
  return <div className="card"><h1>Customers</h1>
    {!s.customers.length ? <div className="empty">No customers yet.</div> : <div className="table-scroll"><table>
      <thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spent</th><th>Joined</th></tr></thead>
      <tbody>{s.customers.map(c => {
        const list = s.orders.filter(o => o.customerId === c.id);
        const spent = list.filter(o => o.payment && o.status !== "cancelled").reduce((t, o) => t + o.price.total, 0);
        return <tr key={c.id}><td>{c.name}{c.company && <><br /><span className="muted">{c.company}</span></>}</td>
          <td>{c.email}<br /><span className="muted">{c.phone}</span></td><td>{list.length}</td><td>{eur(spent)}</td><td>{dt(c.createdAt)}</td></tr>;
      })}</tbody>
    </table></div>}
  </div>;
}
