import type { Metadata } from "next";
import Link from "next/link";
import { Flash } from "@/components/ui";
import { getDriverNews, requireDriver, type SearchParams } from "@/lib/state";
import { Gate, activeJobs, fiDate, requestTime } from "../common";

export const metadata: Metadata = { title: "Koti" };

export default async function DriverHome({ searchParams }: { searchParams: SearchParams }) {
  const { s, user: d } = await requireDriver();
  const sp = await searchParams;
  const approved = d.status === "approved";
  const open = approved ? s.orders.filter(o => o.status === "open" && !o.rejectedBy.includes(d.id)).length : 0;
  const done = s.orders.filter(o => o.driverId === d.id && o.status === "delivered").length;
  const news = await getDriverNews();
  const now = requestTime();
  return <>
    <Flash sp={sp} />
    {!approved && <Gate d={d} />}
    <div className="statgrid">
      <Link className="stat" href="/driver/search" id="statOpen"><b>{open}</b><span>Avoimet siirrot</span></Link>
      <div className="stat"><b>{activeJobs(s, d).length}</b><span>Omat aktiiviset</span></div>
      <div className="stat"><b style={{ color: "var(--green)" }}>{done}</b><span>Suoritetut siirrot</span></div>
    </div>
    <div className="card" id="newsCard">
      <h2>Uutiset ja päätökset</h2>
      <p className="sub">Uusimmat tiedotteet ja ohjeet kuljettajille.</p>
      {!news.length ? <p className="empty">Ei uusia tiedotteita.</p> : news.map(n => {
        const fresh = now - new Date(n.publishedAt).getTime() < 7 * 864e5;
        return <div className="news-item" key={n.id}>
          <div className="news-head">
            <span className={`pill ${n.kind === "decision" ? "orange" : "green"}`}>{n.kind === "decision" ? "Päätös" : "Uutinen"}</span>
            {fresh && <span className="pill">Uusi</span>}
            <span className="news-date">{fiDate(n.publishedAt.slice(0, 10))}</span>
          </div>
          <div className="news-title">{n.title}</div>
          {n.body && <div className="news-text">{n.body}</div>}
        </div>;
      })}
    </div>
  </>;
}
