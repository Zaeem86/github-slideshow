import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signIn } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { AuthShell } from "@/components/shell";
import { Flash } from "@/components/ui";
import { getStateOrDefaults, type SearchParams } from "@/lib/state";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false } };

export default async function AdminLogin({ searchParams }: { searchParams: SearchParams }) {
  const s = await getStateOrDefaults();
  if (s?.session.admin) redirect("/admin/dashboard");
  const sp = await searchParams;
  return <AuthShell portal="admin">
    <Flash sp={sp} />
    <form className="card narrow" id="adminSignIn" action={signIn}>
      <h2>Admin sign in</h2>
      <input type="hidden" name="portal" value="admin" />
      <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
      <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
      <div className="row mt"><span className="spacer" /><SubmitButton>Sign in</SubmitButton></div>
      <p className="notice">Admins are promoted in Supabase: create a customer account, then run<br />
        <code>update public.profiles set role = &apos;admin&apos; where email = &apos;…&apos;;</code></p>
    </form>
  </AuthShell>;
}
