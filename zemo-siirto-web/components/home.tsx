"use client";
import "./home.css";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { quoteRoute, type RouteQuote } from "@/app/route-actions";
import { CITIES, CITY_NAMES, estimateKm, eur, priceFor } from "@/lib/domain";
import { AddressInput, newSession } from "./address";
import { RouteMap } from "./route-map";
import type { Settings } from "@/lib/types";

type Lang = "fi" | "en";

const T = {
  fi: {
    menu: "Valikko", theme: "Vaihda teema", home: "Etusivu", business: "Yrityksille", drivers: "Kuljettajille", about: "Meistä",
    driverLogin: "Kuljettajan kirjautuminen →",
    h1a: "Nopea ja luotettava", h1b: "auton siirto", h1c: "koko Suomessa",
    lead: "ZEMO siirtää autosi perille: tarkastettu kuljettaja noutaa auton sovittuna aikana ja ajaa sen määränpäähän. Palvelemme yksityisasiakkaita, autoliikkeitä sekä leasing- ja vuokrayhtiöitä.",
    from: "Noutopaikka", to: "Toimituspaikka", calc: "Laske hinta", estimate: "Arviohinta",
    estimateNote: "Arvio perustuu kaupunkien väliseen ajomatkaan. Lopullinen hinta vahvistetaan tilauksessa.",
    vat: (net: string, rate: number, vat: string) => `Veroton ${net} + ALV ${rate.toLocaleString("fi-FI")} % ${vat}`,
    order: "Tilaa siirto →", same: "Valitse kaksi eri kaupunkia.",
    addrPh: "Katuosoite ja kaupunki", pickAddr: "Valitse molemmat osoitteet ehdotuslistasta.", busy: "Lasketaan…", drive: "Ajoaika",
    routeNote: "Hinta perustuu todelliseen ajomatkaan teitä pitkin. Lopullinen hinta vahvistetaan tilauksessa.",
    s1: "Valitse kaupungit", s1t: "Kerro, mistä auto noudetaan ja minne se viedään.", s1g: "Syötä osoitteet",
    s2: "Saat hinta-arvion heti", s2t: "Näet hinnan ennen tilausta, ilman yllätyksiä.",
    s3: "Tilaa – me hoidamme loput", s3t: "Seuraa siirtoa noudosta luovutukseen.",
    trust: "Digitaalinen tarkastus noudossa ja luovutuksessa",
    whyA: "liikkeellä puolestasi",
    why: [
      "Asiakkaitamme ovat yksityishenkilöt, autoliikkeet, leasing-yhtiöt ja autovuokraamot, jotka tarvitsevat auton siirron nopeasti.",
      "Ajamme siirtoja kaikkialla Suomessa – Helsingistä Rovaniemelle.",
      "Jokainen auto tarkastetaan ja kuvataan noudossa ja luovutuksessa.",
      "Asiakaspalvelumme palvelee suomeksi ja englanniksi."
    ],
    bizH: "Anna autojen siirrot ZEMOn hoidettavaksi",
    bizP: "Säästä aikaa ja keskity omaan liiketoimintaasi. Tilaat siirrot yhdestä paikasta, näet niiden tilan reaaliajassa ja saat laskun selkeästi.",
    bizBtn: "Tule asiakkaaksi →",
    drvH: "Aja kanssamme",
    drvP: "Valitse itse sinulle sopivat siirrot, aja omaan tahtiisi ja seuraa ansioitasi sovelluksessa.",
    drvBtn: "Kuljettajan kirjautuminen →",
    tag: "Luotettava ja nopea auton siirto Suomessa.", rights: "Kaikki oikeudet pidätetään.", mapLabel: "Kartta"
  },
  en: {
    menu: "Menu", theme: "Switch theme", home: "Home", business: "For businesses", drivers: "For drivers", about: "About us",
    driverLogin: "Driver login →",
    h1a: "Fast and reliable", h1b: "car transfer", h1c: "all over Finland",
    lead: "ZEMO gets your car where it needs to be: a vetted driver picks it up at the agreed time and drives it to its destination. We serve private customers, car dealers and leasing and rental companies.",
    from: "Pickup city", to: "Delivery city", calc: "Calculate price", estimate: "Estimated price",
    estimateNote: "The estimate is based on the driving distance between the cities. The final price is confirmed in the order.",
    vat: (net: string, rate: number, vat: string) => `Excl. VAT ${net} + VAT ${rate} % ${vat}`,
    order: "Order a transfer →", same: "Choose two different cities.",
    addrPh: "Street address and city", pickAddr: "Choose both addresses from the suggestions.", busy: "Calculating…", drive: "Driving time",
    routeNote: "The price is based on the real driving distance by road. The final price is confirmed in the order.",
    s1: "Choose the cities", s1t: "Tell us where the car is picked up and where it goes.", s1g: "Enter the addresses",
    s2: "Get an instant estimate", s2t: "See the price before you order, with no surprises.",
    s3: "Order – we handle the rest", s3t: "Follow the transfer from pickup to delivery.",
    trust: "Digital inspection at pickup and delivery",
    whyA: "on the move for you",
    why: [
      "Our customers are private people, car dealers, leasing companies and rental firms who need a car moved quickly.",
      "We drive transfers all over Finland – from Helsinki to Rovaniemi.",
      "Every car is inspected and photographed at pickup and delivery.",
      "Our customer service speaks Finnish and English."
    ],
    bizH: "Leave your car transfers to ZEMO",
    bizP: "Save time and focus on your own business. Order transfers in one place, follow them live and get a clear invoice.",
    bizBtn: "Become a customer →",
    drvH: "Drive with us",
    drvP: "Choose the transfers that suit you, drive at your own pace and follow your earnings in the app.",
    drvBtn: "Driver login →",
    tag: "Reliable and fast car transfers in Finland.", rights: "All rights reserved.", mapLabel: "Map"
  }
} as const;

const SECTIONS = ["etusivu", "yrityksille", "kuljettajille", "meista"] as const;

// Light / dark theme, remembered on this device (falls back to memory if storage is blocked).
let memTheme = "light";
const themeStore = {
  subscribe(cb: () => void) {
    window.addEventListener("zemo-theme", cb); window.addEventListener("storage", cb);
    return () => { window.removeEventListener("zemo-theme", cb); window.removeEventListener("storage", cb); };
  },
  get: () => { try { return localStorage.getItem("zemoTheme") ?? memTheme; } catch { return memTheme; } },
  server: () => "light",
  set(v: string) {
    memTheme = v;
    try { localStorage.setItem("zemoTheme", v); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event("zemo-theme"));
  }
};

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

export function HomeView({ settings, google }: { settings: Settings; google: boolean }) {
  const [lang, setLang] = useState<Lang>("fi");
  const dark = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.server) === "dark";
  const [menu, setMenu] = useState(false);
  const [current, setCurrent] = useState<string>("etusivu");
  const [from, setFrom] = useState("Helsinki");
  const [to, setTo] = useState("Tampere");
  const [shown, setShown] = useState<[string, string] | null>(null);
  // Google Maps: real addresses and road distance (calculated on the server).
  const [session] = useState(() => newSession());
  const [fromPlace, setFromPlace] = useState<{ placeId: string; text: string } | null>(null);
  const [toPlace, setToPlace] = useState<{ placeId: string; text: string } | null>(null);
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [calcError, setCalcError] = useState("");
  const [busy, setBusy] = useState(false);
  const t = T[lang];

  const toggleTheme = () => themeStore.set(dark ? "light" : "dark");
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu(false);
    setCurrent(id);
    const el = document.getElementById(id);
    if (id === "etusivu" || !el) window.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 74, behavior: "smooth" });
  };

  const km = shown ? estimateKm(shown[0], shown[1], settings) : null;
  const q = km != null ? priceFor(km, settings) : null;
  const label = (id: (typeof SECTIONS)[number]) => ({ etusivu: t.home, yrityksille: t.business, kuljettajille: t.drivers, meista: t.about })[id];

  return <div className={`home${dark ? " dark" : ""}`}>
    <header className="home-top">
      <div className="home-wrap home-top-row">
        <a className="home-brand" href="#etusivu" onClick={go("etusivu")} aria-label="ZEMO">
          <Image src="/brand/zemo-mark.webp" alt="" width={143} height={96} className="home-brand-logo" priority />ZEMO
        </a>
        <div className="home-actions">
          <button className="icon-btn" onClick={toggleTheme} aria-label={t.theme}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          </button>
          <button className="icon-btn lang-btn" id="langBtn" onClick={() => setLang(l => (l === "fi" ? "en" : "fi"))} aria-label="Kieli / Language">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
            {lang.toUpperCase()}
          </button>
          <button className="icon-btn" id="menuBtn" onClick={() => setMenu(m => !m)} aria-label={t.menu} aria-expanded={menu}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
    </header>

    {menu && <nav className="home-menu" id="homeMenu">
      {SECTIONS.map(id => <a key={id} href={`#${id}`} className={current === id ? "current" : ""} onClick={go(id)}>{label(id)}</a>)}
      <Link className="small" href="/driver/login">{t.driverLogin}</Link>
    </nav>}

    <main id="etusivu">
      <section className="home-wrap home-hero">
        <h1>{t.h1a} <span className="hl">{t.h1b}</span> {t.h1c}</h1>
        <p className="lead">{t.lead}</p>

        {google ? <form className="home-calc" id="quickQuote" onSubmit={async e => {
          e.preventDefault();
          if (!fromPlace || !toPlace) { setQuote(null); setCalcError(t.pickAddr); return; }
          setBusy(true); setCalcError("");
          const r = await quoteRoute(fromPlace.placeId, toPlace.placeId, session);
          setBusy(false);
          if (r.ok) setQuote(r.quote); else { setQuote(null); setCalcError(r.error); }
        }}>
          <label htmlFor="qFrom">{t.from}</label>
          <AddressInput id="qFrom" name="from" className="home-input" placeholder={t.addrPh} session={session} value={fromPlace} onPick={p => { setFromPlace(p); setQuote(null); }} />
          <label htmlFor="qTo">{t.to}</label>
          <AddressInput id="qTo" name="to" className="home-input" placeholder={t.addrPh} session={session} value={toPlace} onPick={p => { setToPlace(p); setQuote(null); }} />
          <button className="home-btn block" type="submit" disabled={busy}>{busy ? t.busy : t.calc}</button>
          {(quote || calcError) && <div className="home-result" id="quickOut">
            {quote ? <>
              <div className="row-between"><span>{quote.from.city} → {quote.to.city}</span><b>≈ {quote.km} km</b></div>
              <div className="row-between"><span>{t.drive}</span><b>≈ {hm(quote.minutes)}</b></div>
              <div className="row-between"><span>{t.estimate}</span><span className="home-total">{eur(quote.total)}</span></div>
              <small>{t.vat(eur(quote.net), quote.vatRate, eur(quote.vat))}</small>
              <small>{t.routeNote}</small>
              <Link className="home-btn block" href={`/customer/create-order?quote=${quote.id}&a=${encodeURIComponent(quote.from.address)}&b=${encodeURIComponent(quote.to.address)}&km=${quote.km}&min=${quote.minutes}&t=${quote.total}`}>{t.order}</Link>
            </> : <span className="calc-error">{calcError}</span>}
          </div>}
        </form> : <form className="home-calc" id="quickQuote" onSubmit={e => { e.preventDefault(); setShown([from, to]); }}>
          <label htmlFor="qFrom">{t.from}</label>
          <select id="qFrom" name="from" value={from} onChange={e => setFrom(e.target.value)}>{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select>
          <label htmlFor="qTo">{t.to}</label>
          <select id="qTo" name="to" value={to} onChange={e => setTo(e.target.value)}>{CITY_NAMES.map(c => <option key={c}>{c}</option>)}</select>
          <button className="home-btn block" type="submit">{t.calc}</button>
          {shown && <div className="home-result" id="quickOut">
            {q ? <>
              <div className="row-between"><span>{shown[0]} → {shown[1]}</span><b>≈ {q.km} km</b></div>
              <div className="row-between"><span>{t.estimate}</span><span className="home-total">{eur(q.total)}</span></div>
              <small>{t.vat(eur(q.net), q.vatRate, eur(q.vat))}</small>
              <small>{t.estimateNote}</small>
              <Link className="home-btn block" href="/customer/create-order">{t.order}</Link>
            </> : <span>{t.same}</span>}
          </div>}
        </form>}

        <div className="home-steps">
          {[[google ? t.s1g : t.s1, t.s1t], [t.s2, t.s2t], [t.s3, t.s3t]].map(([h, p], i) =>
            <div className="home-step" key={h}><div className="num">{i + 1}</div><div><b>{h}</b><span>{p}</span></div></div>)}
        </div>

        {google
          ? <RouteMap className="home-map" from={quote ? { ...quote.from, label: quote.from.city } : null} to={quote ? { ...quote.to, label: quote.to.city } : null} polyline={quote?.polyline} />
          : <RouteMap className="home-map"
              from={shown && shown[0] !== shown[1] ? { lat: CITIES[shown[0]][0], lng: CITIES[shown[0]][1], label: shown[0] } : null}
              to={shown && shown[0] !== shown[1] ? { lat: CITIES[shown[1]][0], lng: CITIES[shown[1]][1], label: shown[1] } : null} />}
        <div className="home-trust">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
          {t.trust}
        </div>
      </section>

      <section className="home-wrap home-why" id="meista">
        <h2>ZEMO — <span>{t.whyA}</span></h2>
        <ol>{t.why.map((w, i) => <li key={i}><div className="num">{i + 1}</div><div>{w}</div></li>)}</ol>
      </section>

      <div className="home-band">
        <div className="home-wrap home-band-grid">
          <section id="yrityksille">
            <div className="kicker">{t.business}</div>
            <h2>{t.bizH}</h2>
            <p>{t.bizP}</p>
            <Link className="home-btn" href="/customer/login">{t.bizBtn}</Link>
          </section>
          <section id="kuljettajille">
            <div className="kicker">{t.drivers}</div>
            <h2>{t.drvH}</h2>
            <p>{t.drvP}</p>
            <Link className="home-btn" href="/driver/login">{t.drvBtn}</Link>
          </section>
        </div>
      </div>
    </main>

    <footer className="home-foot">
      <div className="home-wrap">
        <div className="home-foot-brand"><Image src="/brand/zemo-mark.webp" alt="" width={143} height={96} className="home-brand-logo big" />ZEMO</div>
        <div className="tag">{t.tag}</div>
        <div className="home-foot-links">
          <a href="#yrityksille" onClick={go("yrityksille")}>{t.business}</a>
          <a href="#kuljettajille" onClick={go("kuljettajille")}>{t.drivers}</a>
          <a href="#meista" onClick={go("meista")}>{t.about}</a>
        </div>
        <a className="home-contact" href="mailto:tuki@zemosiirto.fi">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>tuki@zemosiirto.fi
        </a>
        <div className="copy">© {new Date().getFullYear()} ZEMO. {t.rights}</div>
      </div>
    </footer>
  </div>;
}
