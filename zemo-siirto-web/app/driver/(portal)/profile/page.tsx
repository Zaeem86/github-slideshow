import type { Metadata } from "next";
import { updateDriverProfile } from "@/app/actions";
import { PasswordForm } from "@/components/forms";
import { SubmitButton } from "@/components/client";
import { DriverBadge, Flash, From } from "@/components/ui";
import { CITY_NAMES, dt } from "@/lib/domain";
import { requireDriver, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Profile" };
const HERE = "/driver/profile";

export default async function Profile({ searchParams }: { searchParams: SearchParams }) {
  const { user: d } = await requireDriver();
  const sp = await searchParams;
  return <>
    <Flash sp={sp} />
    <div className="card"><div className="row"><h1 className="m0">{d.name}</h1><DriverBadge d={d} /></div>
      <div className="grid mt">
        <div><div className="muted">Email</div>{d.email}</div>
        <div><div className="muted">Driving licence</div>{d.licenseNo} (class {d.licenseClass}), valid until {d.licenseExpiry || "–"}</div>
        <div><div className="muted">Registered</div>{dt(d.createdAt)}</div>
      </div></div>
    <form className="card" id="driverProfile" action={updateDriverProfile}><h2>Contact & payout details</h2><From path={HERE} />
      <div className="grid">
        <label className="field">Phone<input name="phone" type="tel" required defaultValue={d.phone} /></label>
        <label className="field">Home city<select name="city" defaultValue={d.city || "Helsinki"}>{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field">IBAN<input name="iban" required defaultValue={d.iban} /></label>
      </div>
      <div className="row mt"><span className="spacer" /><SubmitButton kind="btn-light">Save</SubmitButton></div></form>
    <PasswordForm from={HERE} />
  </>;
}

