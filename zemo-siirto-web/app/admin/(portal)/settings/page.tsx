import type { Metadata } from "next";
import { updateCompany } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { PasswordForm } from "@/components/forms";
import { Flash, From } from "@/components/ui";
import { requireAdmin, type SearchParams } from "@/lib/state";
import type { Company } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };
const HERE = "/admin/settings";
const FIELDS: [keyof Company, string][] = [["name", "Company name"], ["businessId", "Business ID (Y-tunnus)"], ["email", "Email"],
  ["phone", "Phone"], ["address", "Address"], ["iban", "IBAN for invoice payments"]];

export default async function Settings({ searchParams }: { searchParams: SearchParams }) {
  const { s } = await requireAdmin();
  const sp = await searchParams;
  return <>
    <Flash sp={sp} />
    <form className="card" id="companyForm" action={updateCompany}><h1>Company details</h1><From path={HERE} />
      <p className="muted">Shown on invoices.</p>
      <div className="grid">{FIELDS.map(([k, l]) => <label key={k} className="field">{l}<input name={k} defaultValue={s.company[k]} /></label>)}</div>
      <div className="row mt"><span className="spacer" /><SubmitButton>Save</SubmitButton></div>
    </form>
    <PasswordForm from={HERE} />
    <div className="card"><h2>Payments</h2>
      {s.settings.demoPayments
        ? <p className="m0"><span className="badge warn">Demo payments ON</span> Customers can mark orders paid without paying. Turn off before going live:
          <br /><code>update public.app_settings set allow_demo_payments = false;</code></p>
        : <p className="m0"><span className="badge ok">Demo payments off</span></p>}
    </div>
  </>;
}
