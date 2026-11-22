"use client";
import { useMemo, useState } from "react";

export type SearchJob = { id: string; from: string; to: string; car: string; km: number; when: string; date: string; pay: string; soon: boolean; accept: React.ReactNode };

/** Hae: search open jobs by order number, city, car or date; filter by pickup city. */
export function JobSearch({ jobs }: { jobs: SearchJob[] }) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const cities = useMemo(() => [...new Set(jobs.map(j => j.from))].sort((a, b) => a.localeCompare(b, "fi")), [jobs]);
  const needle = q.trim().toLowerCase();
  const hits = jobs.filter(j => (!city || j.from === city) &&
    (!needle || [j.id, j.from, j.to, j.car, j.date, j.when].join(" ").toLowerCase().includes(needle)));
  return <>
    <div className="fields" style={{ marginBottom: 16 }}>
      <div className="field"><input type="search" id="searchInput" placeholder="Helsinki, ZS-1042, Toyota…" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} aria-label="Hae" /></div>
      <div className="field"><select id="cityFilter" aria-label="Kaupunki" value={city} onChange={e => setCity(e.target.value)}>
        <option value="">Kaikki kaupungit ({jobs.length})</option>
        {cities.map(c => <option key={c} value={c}>{c} ({jobs.filter(j => j.from === c).length})</option>)}
      </select></div>
    </div>
    <div id="searchResults">
      {!hits.length ? <p className="empty">{jobs.length ? "Ei hakutuloksia." : "Ei avoimia tehtäviä juuri nyt."}</p> : hits.map(j =>
        <div className={`job${j.soon ? " soon" : ""}`} key={j.id}>
          <div>
            <div className="job-route">#{j.id} · {j.from} → {j.to}</div>
            <div className="job-meta">{j.car} · {j.km} km · {j.when}</div>
          </div>
          <div className="job-actions"><span className="job-pay">{j.pay}</span>{j.accept}</div>
        </div>)}
    </div>
  </>;
}
