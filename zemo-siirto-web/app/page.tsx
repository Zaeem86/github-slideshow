import Link from "next/link";
import { QuickQuote } from "@/components/client";
import { getStateOrDefaults, settingsOf } from "@/lib/state";

export default async function Home() {
  const settings = settingsOf(await getStateOrDefaults());
  return <>
    <main className="hero">
      <div className="shell">
        <nav className="nav">
          <div className="brand">ZEMO <span>SIIRTO</span></div>
          <div className="nav-links"><Link href="#how">How it works</Link><Link href="/driver/login">For drivers</Link><Link href="/customer/login">Sign in</Link></div>
        </nav>
        <div className="hero-grid">
          <div>
            <div className="eyebrow">CAR TRANSFERS ACROSS FINLAND</div>
            <h1>Your car.<br />Delivered with care.</h1>
            <p>Book a professional driver to drive your own car from one destination to another. No car transporter. No unnecessary hassle.</p>
            <div className="actions">
              <Link className="btn btn-gold" href="/customer/login">Book a transfer</Link>
              <Link className="btn btn-outline" href="/driver/login">Become a driver</Link>
            </div>
          </div>
          <QuickQuote settings={settings} />
        </div>
      </div>
    </main>
    <section className="section shell" id="how">
      <div className="eyebrow">SIMPLE BY DESIGN</div>
      <h2>Moving your car is easy.</h2>
      <p className="muted">A fixed price up front, approved independent drivers and a documented handover at both ends.</p>
      <div className="cards">
        <article className="card"><div className="eyebrow">01 / BOOK</div><h3>Tell us where to go</h3><p className="muted">Choose pickup and delivery, add your vehicle. The price is calculated from the distance.</p></article>
        <article className="card"><div className="eyebrow">02 / MATCH</div><h3>A driver accepts</h3><p className="muted">An approved independent driver takes the job and inspects the car at pickup.</p></article>
        <article className="card"><div className="eyebrow">03 / DELIVER</div><h3>Your car arrives</h3><p className="muted">Follow the status live and get the delivery inspection report and invoice.</p></article>
      </div>
    </section>
    <section className="section band">
      <div className="shell band-row">
        <div><div className="eyebrow">FOR PROFESSIONAL DRIVERS</div><h2>Choose the jobs that fit you.</h2>
          <p className="muted">Independent drivers apply, get approved and select open jobs near them.</p></div>
        <Link className="btn btn-gold" href="/driver/login">Apply to drive</Link>
      </div>
    </section>
    <footer className="footer"><div className="shell footer-row">
      <div className="brand">ZEMO <span>SIIRTO</span></div>
      <div className="footer-links">Finland · <Link href="/customer/login">Customers</Link> · <Link href="/driver/login">Drivers</Link> · <Link href="/admin/login">Admin</Link></div>
      <div className="footer-copy">© {new Date().getFullYear()} Zemo Siirto</div>
    </div></footer>
  </>;
}
