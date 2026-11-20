import Link from "next/link";
import { PORTAL_LABEL, type Portal } from "@/lib/domain";
import { NavLinks } from "./client";

export const Brand = ({ dark = false }: { dark?: boolean }) =>
  <Link href="/" className={`brand ${dark ? "brand-dark" : ""}`}>ZEMO <span>SIIRTO</span></Link>;

/** Top bar + page navigation for a signed-in portal. */
export function PortalShell({ portal, name, children }: { portal: Portal; name: string; children: React.ReactNode }) {
  return <>
    <header className="portal-top">
      <div className="shell portal-bar">
        <Brand /><span className="badge gold">{PORTAL_LABEL[portal]}</span>
        <span className="spacer" />
        <span className="who">{name}</span>
        <form action="/auth/signout" method="post"><input type="hidden" name="portal" value={portal} />
          <button className="btn btn-outline btn-sm" id="signOut">Sign out</button></form>
      </div>
      <div className="shell"><NavLinks portal={portal} /></div>
    </header>
    <main className="shell portal-main">{children}</main>
  </>;
}

/** Simple centred layout for login pages. */
export function AuthShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  return <main className="shell auth-main">
    <div className="row auth-head"><Brand dark /><span className="badge gold">{PORTAL_LABEL[portal]}</span></div>
    {children}
    <p className="muted center"><Link href="/">← Back to home</Link></p>
  </main>;
}
