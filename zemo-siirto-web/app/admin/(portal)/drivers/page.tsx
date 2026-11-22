import type { Metadata } from "next";
import { setDriverStatus } from "@/app/actions";
import { ActionButton, AutoRefresh } from "@/components/client";
import { DriverBadge, Flash } from "@/components/ui";
import { todayFi, yearsSince } from "@/lib/domain";
import { requireAdmin, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Drivers" };
const HERE = "/admin/drivers";

export default async function Drivers({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="card"><h1>Drivers</h1>
      {!s.drivers.length ? <div className="empty">No drivers registered.</div> : <div className="table-scroll"><table>
        <thead><tr><th>Driver</th><th>Licence</th><th>City</th><th>Jobs</th><th>Status</th><th /></tr></thead>
        <tbody>{s.drivers.map(d => {
          const expired = !d.licenseExpiry || d.licenseExpiry < todayFi();
          const jobs = s.orders.filter(o => o.driverId === d.id && o.status === "delivered").length;
          const age = d.dob ? `${Math.floor(yearsSince(d.dob))} y` : "age unknown";
          return <tr key={d.id}>
            <td>{d.name}<br /><span className="muted">{d.email} · {d.phone} · {age}</span></td>
            <td>{d.licenseNo} ({d.licenseClass})<br /><span className="muted">valid until {d.licenseExpiry || "–"}{expired && " – EXPIRED"}</span></td>
            <td>{d.city}</td><td>{jobs}</td><td><DriverBadge d={d} /></td>
            <td><div className="row nowrap">
              {d.status !== "approved" && <ActionButton action={setDriverStatus} fields={{ driverId: d.id, status: "approved" }} from={HERE} kind="btn-gold btn-sm">Approve</ActionButton>}
              {d.status === "pending" && <ActionButton action={setDriverStatus} fields={{ driverId: d.id, status: "rejected" }} from={HERE} kind="btn-danger btn-sm">Reject</ActionButton>}
              {d.status === "approved" && <ActionButton action={setDriverStatus} fields={{ driverId: d.id, status: "suspended" }} from={HERE} kind="btn-danger btn-sm" confirm={`Suspend ${d.name}?`}>Suspend</ActionButton>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </div>
  </>;
}
