import Link from "next/link";
import { assignDriver, cancelOrder } from "@/app/actions";
import { ActionButton, AssignSelect } from "@/components/client";
import { StatusBadge } from "@/components/ui";
import { eur } from "@/lib/domain";
import type { AppState, Order } from "@/lib/types";

export function OrdersTable({ s, list, from }: { s: AppState; list: Order[]; from: string }) {
  if (!list.length) return <div className="empty">No orders.</div>;
  const approved = s.drivers.filter(d => d.status === "approved");
  return <div className="table-scroll"><table>
    <thead><tr><th>Order</th><th>Customer</th><th>Route</th><th>Total</th><th>Status</th><th>Driver</th><th /></tr></thead>
    <tbody>{list.map(o => <tr key={o.id}>
      <td>{o.id}<br /><span className="muted">{o.pickup.date}</span></td>
      <td>{o.customer.name}<br /><span className="muted">{o.customer.phone}</span></td>
      <td>{o.pickup.city} → {o.dropoff.city}<br /><span className="muted">{o.price.km} km</span></td>
      <td>{eur(o.price.total)}</td>
      <td><StatusBadge status={o.status} /></td>
      <td>{o.status === "open" && approved.length
        ? <AssignSelect order={o} drivers={approved} action={assignDriver} from={from} />
        : s.drivers.find(d => d.id === o.driverId)?.name ?? "–"}</td>
      <td><div className="row nowrap">
        <Link className="btn btn-light btn-sm" href={`/admin/orders/${o.id}`}>Details</Link>
        {!["delivered", "cancelled"].includes(o.status) &&
          <ActionButton action={cancelOrder} fields={{ uuid: o.uuid }} from={from} kind="btn-danger btn-sm"
            confirm={`Cancel order ${o.id}?${o.payment ? " The payment will be refunded." : ""}`}>Cancel</ActionButton>}
      </div></td>
    </tr>)}</tbody>
  </table></div>;
}
