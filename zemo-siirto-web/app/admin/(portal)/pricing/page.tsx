import type { Metadata } from "next";
import { updateSettings } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash, From } from "@/components/ui";
import { eur, priceFor } from "@/lib/domain";
import { requireAdmin, type SearchParams } from "@/lib/state";
import type { Settings } from "@/lib/types";

export const metadata: Metadata = { title: "Pricing" };

const FIELDS: [keyof Settings, string, string][] = [
  ["baseFee", "Base fee € (excl. VAT)", "0.01"], ["perKm", "Price per km €", "0.01"], ["minPrice", "Minimum price €", "0.01"],
  ["vatRate", "VAT %", "0.1"], ["driverShare", "Driver share %", "1"], ["roadFactor", "Road factor (straight line → road)", "0.01"],
  ["sameCityKm", "Same-city distance km", "1"]
];

export default async function Pricing({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  const st = s.settings;
  return <>
    <Flash sp={sp} />
    <form className="card" id="pricingForm" action={updateSettings}><h1>Pricing rules</h1><From path="/admin/pricing" />
      <div className="grid">{FIELDS.map(([k, label, step]) =>
        <label key={k} className="field">{label}<input name={k} type="number" step={step} min="0" defaultValue={String(st[k])} required /></label>)}</div>
      <p className="muted">Commission = 100% − driver share. Example: driver share 85% → 15% commission.</p>
      <h3>Examples with the current rules</h3>
      <div className="table-scroll"><table><thead><tr><th>Distance</th><th>Excl. VAT</th><th>Incl. VAT</th><th>Driver pay</th><th>Commission</th></tr></thead><tbody>
        {[15, 50, 180, 400, 800].map(km => { const p = priceFor(km, st); const pay = Math.round(p.net * st.driverShare) / 100;
          return <tr key={km}><td>{km} km</td><td>{eur(p.net)}</td><td>{eur(p.total)}</td><td>{eur(pay)}</td><td>{eur(p.net - pay)}</td></tr>; })}
      </tbody></table></div>
      <p className="muted">New prices apply to new orders only.</p>
      <div className="row mt"><span className="spacer" /><SubmitButton>Save pricing</SubmitButton></div>
    </form>
  </>;
}
