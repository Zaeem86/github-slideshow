import { changePassword } from "@/app/actions";
import { SubmitButton } from "./client";
import { From } from "./ui";

export function PasswordForm({ from }: { from: string }) {
  return <form className="card" id="passwordForm" action={changePassword}><h2>Change password</h2><From path={from} />
    <div className="grid">
      <label className="field">Current password<input name="current" type="password" required autoComplete="current-password" /></label>
      <label className="field">New password (min. 8)<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
    </div>
    <div className="row mt"><span className="spacer" /><SubmitButton kind="btn-light">Change password</SubmitButton></div></form>;
}
