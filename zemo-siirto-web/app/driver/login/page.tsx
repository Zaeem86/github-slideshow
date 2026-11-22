import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn, signUp } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Emblem, SwipeGate } from "@/components/swipe";
import { Flash } from "@/components/ui";
import { CITY_NAMES } from "@/lib/domain";
import { getStateOrDefaults, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Kuljettaja" };

export default async function DriverLogin({ searchParams }: { searchParams: SearchParams }) {
  const s = await getStateOrDefaults();
  if (s?.session.driverId) redirect("/driver/available-jobs");
  const sp = await searchParams;
  // After a sign-in attempt or registration (a message to show), go straight to the sign-in screen.
  const hasMessage = typeof sp.ok === "string" || typeof sp.error === "string";
  return <div className="ds-page">
    <SwipeGate skip={hasMessage}>
      <Emblem small />
      <Flash sp={sp} />
      <form className="ds-box" id="driverSignIn" action={signIn}>
        <input type="hidden" name="portal" value="driver" />
        <input className="ds-input" name="email" type="email" required autoComplete="email" placeholder="Sähköposti" aria-label="Sähköposti" />
        <input className="ds-input" name="password" type="password" required autoComplete="current-password" placeholder="Salasana" aria-label="Salasana" />
        <a className="ds-forgot" href="mailto:tuki@zemosiirto.fi?subject=Salasana%20unohtunut">Salasana unohtunut?</a>
        <SubmitButton kind="ds-submit">Kirjaudu</SubmitButton>
      </form>

      <details className="ds-apply" id="driverApply">
        <summary>Uusi kuljettaja? Hae kuljettajaksi</summary>
        <form id="driverRegister" action={signUp}>
          <p>Ajat asiakkaan omaa autoa noutopaikasta perille. ZEMO tarkistaa hakemukset ennen hyväksyntää.</p>
          <input type="hidden" name="role" value="driver" />
          <div className="grid">
            <label className="field">Koko nimi<input name="name" required autoComplete="name" /></label>
            <label className="field">Sähköposti<input name="email" type="email" required autoComplete="email" /></label>
            <label className="field">Puhelin<input name="phone" type="tel" required autoComplete="tel" /></label>
            <label className="field">Kotikaupunki<select name="city" defaultValue="Helsinki">{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label className="field">Syntymäaika<input name="dob" type="date" required /></label>
            <label className="field">Ajokortin numero<input name="licenseNo" required /></label>
            <label className="field">Ajokorttiluokka<select name="licenseClass"><option>B</option><option>C1</option><option>C</option></select></label>
            <label className="field">Ajokortti voimassa<input name="licenseExpiry" type="date" required /></label>
            <label className="field">IBAN (tilityksiä varten)<input name="iban" required placeholder="FI.." /></label>
            <label className="field">Salasana (väh. 8 merkkiä)<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
          </div>
          <label className="check"><input type="checkbox" name="consent" required /> Vahvistan tiedot oikeiksi ja hyväksyn ajokortin ja taustojen tarkistuksen.</label>
          <div className="row mt"><span className="spacer" /><SubmitButton>Lähetä hakemus</SubmitButton></div>
        </form>
      </details>
      <Link className="ds-back" href="/">← Etusivulle</Link>
    </SwipeGate>
  </div>;
}
