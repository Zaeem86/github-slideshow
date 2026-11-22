import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/client";
import { Flash } from "@/components/ui";
import { ACTIVE, eur, mask } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import type { Order } from "@/lib/types";
import { fiDate, payOf } from "../common";

export const metadata: Metadata = { title: "Ansiot" };

export default async function Earnings({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  const mine = s.orders.filter(o => o.driverId === d.id);
  const done = mine.filter(o => o.status === "delivered");
  const sum = (arr: Order[]) => arr.reduce((t, o) => t + payOf(o, s), 0);
  return <>
    <AutoRefresh />
    <Flash sp={sp} />
    <div className="statgrid">
      <div className="stat"><b style={{ color: "var(--green)" }}>{eur(sum(done))}</b><span>Ansaittu</span></div>
      <div className="stat"><b>{eur(sum(done.filter(o => !o.driverPaidAt)))}</b><span>Odottaa tilitystä</span></div>
      <div className="stat"><b>{eur(sum(mine.filter(o => ACTIVE.includes(o.status))))}</b><span>Aktiiviset tehtävät</span></div>
    </div>
    <div className="card">
      <h2>Tilityshistoria</h2>
      <p className="sub">Suoritetut kuljetukset ja palkkiot. Saat {s.settings.driverShare} % siirron verottomasta hinnasta. Tilitykset tilille {mask(d.iban)}.</p>
      {!done.length ? <p className="empty">Ei vielä suoritettuja siirtoja.</p> : <div className="table-scroll"><table>
        <thead><tr><th>ID</th><th>Reitti</th><th>Toimitettu</th><th>Tila</th><th>Palkkio</th></tr></thead>
        <tbody>{[...done].reverse().map(o => <tr key={o.id}>
          <td>#{o.id}</td><td>{o.pickup.city} → {o.dropoff.city}</td><td>{fiDate((o.history.at(-1)?.at || "").slice(0, 10))}</td>
          <td>{o.driverPaidAt ? <span className="pill green">Maksettu</span> : <span className="pill orange">Odottaa tilitystä</span>}</td>
          <td><b>{eur(payOf(o, s))}</b></td></tr>)}</tbody>
      </table></div>}
      <Link className="btn outline block" href="/driver/profile">← Profiili</Link>
    </div>
  </>;
}
