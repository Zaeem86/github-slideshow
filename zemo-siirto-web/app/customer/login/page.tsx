import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signIn, signUp } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { AuthShell } from "@/components/shell";
import { Flash } from "@/components/ui";
import { getStateOrDefaults, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Customer sign in" };

export default async function CustomerLogin({ searchParams }: { searchParams: SearchParams }) {
  const s = await getStateOrDefaults();
  if (s?.session.customerId) redirect("/customer/dashboard");
  const sp = await searchParams;
  return <AuthShell portal="customer">
    <Flash sp={sp} />
    <div className="grid2">
      <form className="card" id="customerSignIn" action={signIn}>
        <h2>Sign in</h2>
        <input type="hidden" name="portal" value="customer" />
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <div className="row mt"><span className="spacer" /><SubmitButton>Sign in</SubmitButton></div>
      </form>
      <form className="card" id="customerRegister" action={signUp}>
        <h2>Create account</h2>
        <input type="hidden" name="role" value="customer" />
        <label className="field">Full name<input name="name" required autoComplete="name" /></label>
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Phone<input name="phone" type="tel" required autoComplete="tel" placeholder="+358 40 123 4567" /></label>
        <label className="field">Company (optional)<input name="company" autoComplete="organization" /></label>
        <label className="field">Password (min. 8 characters)<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
        <div className="row mt"><span className="spacer" /><SubmitButton>Create account</SubmitButton></div>
      </form>
    </div>
  </AuthShell>;
}
