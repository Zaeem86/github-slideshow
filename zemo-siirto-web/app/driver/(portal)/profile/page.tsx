import type { Metadata } from "next";
import Link from "next/link";
import { changePassword, updateDriverProfile } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { CITY_NAMES } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";
import { fiDate } from "../common";

export const metadata: Metadata = { title: "Profiili" };
const HERE = "/driver/profile";

export default async function Profile({ searchParams }: { searchParams: SearchParams }) {
  const { user: d } = await requireDriver();
  const sp = await searchParams;
  return <div style={{ maxWidth: 650 }}>
    <Flash sp={sp} />
    <div className="card">
      <h2>Kuljettajaprofiili</h2>
      <p className="sub">Henkilötiedot, ajokortti ja tilitystiedot.</p>
      <form id="driverProfile" className="fields" action={updateDriverProfile}>
        <input type="hidden" name="from" value={HERE} />
        <div className="field"><label htmlFor="pName">Koko nimi</label><input id="pName" value={d.name} readOnly /></div>
        <div className="field"><label htmlFor="pPhone">Puhelinnumero</label><input id="pPhone" name="phone" type="tel" required defaultValue={d.phone} /></div>
        <div className="field"><label htmlFor="pCity">Kotikaupunki</label><select id="pCity" name="city" defaultValue={d.city || "Helsinki"}>{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="pIban">IBAN</label><input id="pIban" name="iban" required defaultValue={d.iban} /></div>
        <div className="field"><label htmlFor="pLic">Ajokorttiluokka</label><input id="pLic" value={`${d.licenseClass || "B"} · voimassa ${d.licenseExpiry ? fiDate(d.licenseExpiry) : "–"}`} readOnly /></div>
        <div className="field"><label htmlFor="pMail">Sähköposti</label><input id="pMail" value={d.email || ""} readOnly /></div>
        <div className="field full"><SubmitButton kind="" busy="Tallennetaan…">Tallenna profiili</SubmitButton></div>
      </form>
      <Link className="btn outline block" href="/driver/earnings" id="earningsLink">Ansiot →</Link>
      <details style={{ marginTop: 14 }}>
        <summary className="btn outline" style={{ width: "100%", listStyle: "none" }}>Vaihda salasana</summary>
        <form id="passwordForm" className="fields" action={changePassword} style={{ marginTop: 14 }}>
          <input type="hidden" name="from" value={HERE} />
          <div className="field"><label htmlFor="pwOld">Nykyinen salasana</label><input id="pwOld" name="current" type="password" required autoComplete="current-password" /></div>
          <div className="field"><label htmlFor="pwNew">Uusi salasana (väh. 8)</label><input id="pwNew" name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
          <div className="field full"><SubmitButton kind="" busy="Tallennetaan…">Vaihda salasana</SubmitButton></div>
        </form>
      </details>
      <form action="/auth/signout" method="post">
        <input type="hidden" name="portal" value="driver" />
        <button className="btn danger block" id="signOut">Kirjaudu ulos</button>
      </form>
    </div>
  </div>;
}
