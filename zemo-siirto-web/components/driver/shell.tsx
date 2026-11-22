"use client";
import "./driver.css";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { reportLocation } from "@/app/driver-actions";

// =========================================================================== dialog
const ICONS: Record<string, React.ReactNode> = {
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>,
  gps: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.6" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
};
export type DialogProps = {
  icon: "check" | "gps" | "flag"; warn?: boolean; title: string; text: string;
  status?: { kind: "off" | "wait" | "on"; text: string } | null;
  ok?: string | null; okDisabled?: boolean; cancel: string; onOk?: () => void; onCancel: () => void;
};
export function Dialog(p: DialogProps) {
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
    <div className="modal-card">
      <div className={`modal-icon${p.warn ? " warn" : ""}`}>{ICONS[p.icon]}</div>
      <h3 id="dlgTitle">{p.title}</h3>
      <p>{p.text}</p>
      {p.status && <div className={`modal-status ${p.status.kind}`} id="dlgStatus">{p.status.text}</div>}
      <div className="modal-btns">
        <button type="button" className="btn outline" id="dlgCancel" onClick={p.onCancel}>{p.cancel}</button>
        {p.ok && <button type="button" className="btn" id="dlgOk" disabled={p.okDisabled} onClick={p.onOk}>{p.ok}</button>}
      </div>
    </div>
  </div>;
}

// =========================================================================== toast
const ToastCtx = createContext<(msg: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// =========================================================================== GPS
// GPS must stay on for the whole trip. It lives in the layout, so it keeps running while the driver moves between pages.
type Fix = { lat: number; lng: number; accuracy: number | null };
type Gps = {
  on: boolean; fix: Fix | null;
  /** Shows the "Ota GPS käyttöön" dialog; resolves true once a position is received. */
  ask: () => Promise<boolean>;
  stop: () => void;
};
const GpsCtx = createContext<Gps>({ on: false, fix: null, ask: async () => false, stop: () => {} });
export const useGps = () => useContext(GpsCtx);

function GpsProvider({ driving, children }: { driving: string[]; children: React.ReactNode }) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [asking, setAsking] = useState<null | { status: DialogProps["status"]; busy: boolean; retry: boolean }>(null);
  const watch = useRef<number | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const sentAt = useRef(0);
  const drivingRef = useRef(driving);
  useEffect(() => { drivingRef.current = driving; }, [driving]);

  const stop = useCallback(() => {
    if (watch.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setFix(null);
  }, []);

  const start = useCallback(() => new Promise<boolean>(resolve => {
    if (!navigator.geolocation) return resolve(false);
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    let first = true;
    watch.current = navigator.geolocation.watchPosition(pos => {
      const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
      setFix(f);
      // Position to the server every 30 s for the trips in progress.
      if (Date.now() - sentAt.current > 30000 && drivingRef.current.length) {
        sentAt.current = Date.now();
        drivingRef.current.forEach(o => { void reportLocation(o, f.lat, f.lng, f.accuracy); });
      }
      if (first) { first = false; resolve(true); }
    }, () => {
      if (first) { first = false; stop(); resolve(false); }
      else setFix(null);                         // signal lost during the trip
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }), [stop]);

  // A trip became active (e.g. just started): send the current position right away.
  useEffect(() => {
    if (fix && driving.length) { sentAt.current = Date.now(); driving.forEach(o => { void reportLocation(o, fix.lat, fix.lng, fix.accuracy); }); }
    if (!driving.length && watch.current !== null) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving.join(",")]);

  const ask = useCallback(() => {
    if (fix) return Promise.resolve(true);
    setAsking({ status: { kind: "off", text: "● GPS pois päältä" }, busy: false, retry: false });
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, [fix]);

  const finish = (ok: boolean) => { setAsking(null); const r = resolver.current; resolver.current = null; r?.(ok); };
  const turnOn = async () => {
    setAsking({ status: { kind: "wait", text: "Haetaan sijaintia…" }, busy: true, retry: false });
    const ok = await start();
    if (ok) {
      setAsking({ status: { kind: "on", text: "✓ GPS päällä" }, busy: true, retry: false });
      setTimeout(() => finish(true), 1200);
    } else {
      setAsking({ status: { kind: "off", text: "Sijaintia ei saatu. Salli sijainti selaimen asetuksista ja varmista, että puhelimen sijainti on päällä." }, busy: false, retry: true });
    }
  };

  return <GpsCtx.Provider value={{ on: !!fix, fix, ask, stop }}>
    {children}
    {asking && <Dialog icon="gps" warn={asking.status?.kind !== "on"} title="Ota GPS käyttöön" text="Sijainnin on oltava päällä koko ajon ajan."
      status={asking.status} ok={asking.status?.kind === "on" ? null : asking.retry ? "Yritä uudelleen" : "Ota GPS käyttöön"}
      okDisabled={asking.busy} onOk={turnOn} cancel="Myöhemmin" onCancel={() => { if (watch.current !== null && !fix) stop(); finish(false); }} />}
  </GpsCtx.Provider>;
}

function GpsBadge({ show }: { show: boolean }) {
  const { on } = useGps();
  if (!show) return null;
  return <span className={`gps-badge ${on ? "on" : "off"}`} id="gpsBadge">{on ? "GPS päällä" : "GPS pois"}</span>;
}

// =========================================================================== shell
const TABS: [string, string, React.ReactNode][] = [
  ["/driver/home", "Koti", <svg key="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>],
  ["/driver/my-jobs", "Omat ajot", <svg key="o" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 15l1.6-4.6A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.4L19 15" /><rect x="3" y="15" width="18" height="4" rx="1.5" /><circle cx="7.5" cy="19.5" r="1.3" /><circle cx="16.5" cy="19.5" r="1.3" /></svg>],
  ["/driver/search", "Hae", <svg key="h" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>],
  ["/driver/help", "Help", <svg key="e" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4" /><path d="M12 17h.01" /></svg>],
  ["/driver/profile", "Profiili", <svg key="p" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>]
];
// Pages that belong to a tab: trip + map → Omat ajot, earnings → Profiili.
const TAB_OF: Record<string, string> = { "/driver/trip": "/driver/my-jobs", "/driver/map": "/driver/my-jobs", "/driver/earnings": "/driver/profile" };

export function DriverShell({ driving, children }: { driving: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const tab = TAB_OF[path] ?? path;
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  return <div className="drv">
    <ToastCtx.Provider value={show}>
      <GpsProvider driving={driving}>
        <header className="top">
          <Link className="brand" href="/driver/home">
            <Image className="mark-logo" src="/brand/zemo-mark.webp" alt="ZEMO" width={143} height={96} priority />
            <span className="brand-word">ZEMO</span>
          </Link>
          <GpsBadge show={driving.length > 0} />
        </header>
        <main className="wrap">{children}</main>
        <nav className="bottom-nav" id="driverNav" aria-label="Kuljettaja">
          {TABS.map(([href, label, icon]) => <Link key={href} href={href} className={tab === href ? "active" : ""}>{icon}<span>{label}</span></Link>)}
        </nav>
        {toast && <div className={`toast${toast.error ? " error" : ""}`} role="status" id="toast">{toast.msg}</div>}
      </GpsProvider>
    </ToastCtx.Provider>
  </div>;
}
