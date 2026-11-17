import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signIn, signUp } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { AuthShell } from "@/components/shell";
import { Flash } from "@/components/ui";
import { CITY_NAMES } from "@/lib/domain";
import { getStateOrDefaults, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Driver sign in" };

export default async function DriverLogin({ searchParams }: { searchParams: SearchParams }) {
  const s = await getStateOrDefaults();
  if (s?.session.driverId) redirect("/driver/available-jobs");
  const sp = await searchParams;
  return <AuthShell portal="driver">
    <Flash sp={sp} />
    <form className="card" id="driverSignIn" action={signIn}>
      <h2>Driver sign in</h2>
      <input type="hidden" name="portal" value="driver" />
      <div className="grid">
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
      </div>
      <div className="row mt"><span className="spacer" /><SubmitButton>Sign in</SubmitButton></div>
    </form>
    <form className="card" id="driverRegister" action={signUp}>
      <h2>New driver? Register</h2>
      <p className="muted">You drive the customer&apos;s own car from pickup to destination. Applications are reviewed by the Zemo Siirto team.</p>
      <input type="hidden" name="role" value="driver" />
      <div className="grid">
        <label className="field">Full name<input name="name" required autoComplete="name" /></label>
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Phone<input name="phone" type="tel" required autoComplete="tel" /></label>
        <label className="field">Home city<select name="city" defaultValue="Helsinki">{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Date of birth<input name="dob" type="date" required /></label>
        <label className="field">Driving licence number<input name="licenseNo" required /></label>
        <label className="field">Licence class<select name="licenseClass"><option>B</option><option>BE</option><option>C1</option><option>C</option></select></label>
        <label className="field">Licence valid until<input name="licenseExpiry" type="date" required /></label>
        <label className="field">IBAN (for payouts)<input name="iban" required placeholder="FI.." /></label>
        <label className="field">Password (min. 8 characters)<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
      </div>
      <label className="check"><input type="checkbox" name="consent" required /> I confirm the details are correct and consent to a background / licence check.</label>
      <div className="row mt"><span className="spacer" /><SubmitButton>Submit for verification</SubmitButton></div>
    </form>
  </AuthShell>;
}
