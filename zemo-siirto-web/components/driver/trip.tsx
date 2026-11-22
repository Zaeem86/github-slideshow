"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { submitTripInspection, uploadTripPhoto } from "@/app/driver-actions";
import { Dialog, useToast, type DialogProps } from "./shell";
import { GUIDE_EXTRA, GUIDE_FRONT, GUIDE_ODOMETER, GUIDE_REAR, guideSide } from "./guides";

export type TripOrder = {
  uuid: string; id: string; stage: "pickup" | "delivery";
  from: string; to: string; fromAddr: string; toAddr: string; fromContact: string; toContact: string;
  when: string; car: string; km: number; minutes: number | null; pay: string; inspected: boolean;
  customer: { name: string; company: string; phone: string; email: string };
};

const SLOTS: { key: string; label: string; req: boolean; guide: string; wide?: boolean }[] = [
  { key: "odometer", label: "Kuva matkamittarista", req: true, guide: GUIDE_ODOMETER, wide: true },
  { key: "front", label: "Edestä", req: true, guide: GUIDE_FRONT },
  { key: "right", label: "Oikea kylki", req: true, guide: guideSide("right", "guideRight") },
  { key: "left", label: "Vasen kylki", req: true, guide: guideSide("left", "guideLeft") },
  { key: "rear", label: "Takaa", req: true, guide: GUIDE_REAR },
  { key: "extra1", label: "Lisäkuva 1", req: false, guide: GUIDE_EXTRA },
  { key: "extra2", label: "Lisäkuva 2", req: false, guide: GUIDE_EXTRA }
];
const FUEL: [string, string][] = [["Full", "100% (Täysi)"], ["3/4", "75%"], ["1/2", "50%"], ["1/4", "25%"], ["Reserve", "Varalla"]];

/** Shrink a photo (max 1280 px, JPEG) before it is sent. */
function shrink(src: CanvasImageSource, w: number, h: number) {
  const k = Math.min(1, 1280 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}
function shrinkFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(shrink(img, img.width, img.height)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Kuvaa ei voitu lukea")); };
    img.src = url;
  });
}

// Camera inside the app (with the guide picture) only when this site already has camera permission;
// otherwise the tap itself opens the phone camera, which every phone allows.
function useCameraGranted() {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let st: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "camera" as PermissionName }).then(s => {
      st = s; setGranted(s.state === "granted"); s.onchange = () => setGranted(s.state === "granted");
    }).catch(() => {});
    return () => { if (st) st.onchange = null; };
  }, []);
  const policyOk = typeof document !== "undefined" && !((document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy?.allowsFeature("camera") === false);
  return granted && typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && policyOk;
}

function Camera({ slot, onPhoto, onFile, onClose }: { slot: (typeof SLOTS)[number]; onPhoto: (src: string) => void; onFile: (phoneCamera: boolean) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false }).then(s => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      stream.current = s;
      if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, []);
  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onPhoto(shrink(v, v.videoWidth, v.videoHeight));
  };
  return <div className="cam" role="dialog" aria-modal="true" id="camView">
    <video ref={video} playsInline muted autoPlay />
    <div className="cam-guide" dangerouslySetInnerHTML={{ __html: slot.guide.replace(/id="(\w+)"/g, 'id="$1Cam"').replace(/url\(#(\w+)\)/g, "url(#$1Cam)") }} />
    <div className="cam-top"><span>{slot.label}</span><button type="button" aria-label="Sulje" onClick={onClose}>✕</button></div>
    {failed && <p className="cam-msg">Kameraa ei voitu avata tässä. Salli kameran käyttö selaimen asetuksista tai käytä puhelimen kameraa.</p>}
    <div className="cam-bar">
      <button type="button" className="cam-file" onClick={() => onFile(failed)}>{failed ? "Puhelimen kamera" : "Galleria"}</button>
      <button type="button" className="cam-shot" id="camShot" aria-label="Ota kuva" disabled={!ready} onClick={shoot} />
      <span className="cam-spacer" />
    </div>
  </div>;
}

type SlotState = { src?: string; busy?: boolean; missing?: boolean };

export function TripScreen({ o }: { o: TripOrder }) {
  const router = useRouter();
  const toast = useToast();
  const pickup = o.stage === "pickup";
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [camFor, setCamFor] = useState<string | null>(null);
  const [odo, setOdo] = useState(""), [fuel, setFuel] = useState("3/4"), [notes, setNotes] = useState("");
  const [dialog, setDialog] = useState<DialogProps | null>(null);
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const inApp = useCameraGranted();

  const setSlot = (k: string, v: SlotState) => setSlots(s => ({ ...s, [k]: v }));
  async function save(k: string, src: string) {
    setSlot(k, { src, busy: true });
    const r = await uploadTripPhoto(o.uuid, o.stage, k, src);
    if (r.ok) setSlot(k, { src });
    else { setSlot(k, { missing: true }); toast(`Kuvan tallennus epäonnistui: ${r.error}`, true); }
  }
  async function onFile(k: string, file: File | undefined) {
    if (!file) return;
    try { await save(k, await shrinkFile(file)); } catch { toast("Kuvaa ei voitu lukea. Yritä uudelleen.", true); }
  }
  // Tap on a photo box: the in-app camera (if allowed) – else the box's own file input opens the phone camera.
  const tap = (k: string) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const inp = inputs.current[k];
    if (!inApp) { inp?.setAttribute("capture", "environment"); return; }
    e.preventDefault();
    setCamFor(k);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const missing = SLOTS.filter(s => s.req && (!slots[s.key]?.src || slots[s.key]?.busy)).map(s => s.key);
    if (missing.length) {
      setSlots(s => Object.fromEntries(SLOTS.map(x => [x.key, missing.includes(x.key) ? { ...s[x.key], missing: !s[x.key]?.busy } : s[x.key] ?? {}])));
      document.querySelector(`[data-slot="${missing[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast(slots[missing[0]]?.busy ? "Odota, kuvia tallennetaan…" : "Ota kaikki pakolliset kuvat (*).", true);
      return;
    }
    const ok = await new Promise<boolean>(resolve => setDialog(pickup ? {
      icon: "check", warn: true, title: "Onko kaikki kunnossa?",
      text: "Vahvistan, että olen tarkastanut auton, kuvat on otettu ja auto on ajokunnossa. Mahdolliset vauriot on kirjattu huomioihin.",
      ok: "Kaikki kunnossa ✓", cancel: "Peruuta", onOk: () => resolve(true), onCancel: () => resolve(false)
    } : {
      icon: "flag", warn: true, title: "Vahvista luovutus",
      text: "Vahvistan, että auto on perillä, kuvat on otettu ja kaikki on kunnossa. Avaimet luovutetaan asiakkaalle.",
      ok: "Vahvistan ✓", cancel: "Peruuta", onOk: () => resolve(true), onCancel: () => resolve(false)
    }));
    setDialog(null);
    if (!ok) return;
    setSaving(true);
    const r = await submitTripInspection(o.uuid, o.stage, Number(odo), fuel, notes);
    if (!r.ok) { setSaving(false); toast(r.error, true); return; }
    if (!pickup) {
      toast(`Siirto #${o.id} valmis! Palkkio lähetetty tilitykseen.`);
      router.push("/driver/my-jobs");
      return;
    }
    // Start photos saved: the map page asks for GPS and then starts the trip.
    toast("Kuvat tallennettu.");
    router.push(`/driver/map?order=${o.id}`);
  }

  const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
  const tel = o.customer.phone.replace(/[^+\d]/g, "");
  const subject = encodeURIComponent(`Auton siirto #${o.id}`);
  const camSlot = SLOTS.find(s => s.key === camFor);

  const slotBox = (s: (typeof SLOTS)[number]) => {
    const st = slots[s.key] ?? {};
    return <label key={s.key} className={`photo-slot${s.req ? " req" : ""}${s.wide ? " wide" : ""}${st.src && !st.busy ? " done" : ""}${st.busy ? " busy" : ""}${st.missing ? " missing" : ""}`}
      data-slot={s.key} onClick={tap(s.key)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {st.src && <img src={st.src} alt="" />}
      <input type="file" accept="image/*" capture="environment" ref={el => { inputs.current[s.key] = el; }}
        onChange={e => { void onFile(s.key, e.target.files?.[0]); e.target.value = ""; }} />
      <span className="guide" dangerouslySetInnerHTML={{ __html: s.guide }} />
      <span className="cap">{st.busy ? "Tallennetaan…" : s.label}</span>
    </label>;
  };

  return <form className="card" id="tripForm" onSubmit={submit}>
    <h2 id="tripTitle">{pickup ? "Aloita ajo" : "Luovutus perillä"}</h2>
    <p className="sub">{pickup ? "Ota kuvat autosta ennen lähtöä. Ajo alkaa, kun kuvat on tallennettu." : "Ota kuvat autosta luovutuksessa ennen kuin annat avaimet."}</p>

    <div className="trip-box" id="tripDetails">
      <div className="job-route">#{o.id} · {o.from} → {o.to}</div>
      {([["Noutopaikka", `${o.fromAddr}, ${o.from}`], ["Yhteyshenkilö noudossa", o.fromContact], ["Toimituspaikka", `${o.toAddr}, ${o.to}`],
        ["Yhteyshenkilö perillä", o.toContact], ["Noutoaika", o.when], ["Auto", o.car],
        ["Matka", `${o.km} km`], ["Ajoaika", o.minutes ? `≈ ${o.minutes >= 60 ? `${Math.floor(o.minutes / 60)} h ${o.minutes % 60} min` : `${o.minutes} min`}` : ""],
        ["Palkkiosi", o.pay]] as [string, string][]).filter(r => r[1]).map(([k, v]) =>
        <div className="trip-row" key={k}><span>{k}</span><b>{v}</b></div>)}
      <div className="trip-row"><span>Tarkastus</span><b><span className={`pill ${o.inspected ? "green" : "orange"}`}>{o.inspected ? "Tarkastettu" : "Odottaa tarkastusta"}</span></b></div>
    </div>

    <div className="trip-box" id="tripCustomer">
      <div className="trip-title">Asiakkaan tiedot</div>
      {([["Nimi", o.customer.name], ["Asiakastyyppi", o.customer.company ? "Yritys" : "Yksityinen"], ["Yritys", o.customer.company],
        ["Puhelin", o.customer.phone], ["Sähköposti", o.customer.email]] as [string, string][]).filter(r => r[1]).map(([k, v]) =>
        <div className="trip-row" key={k}><span>{k}</span><b>{v}</b></div>)}
      {tel || o.customer.email ? <div className="contact-btns">
        {tel && <a className="call" href={`tel:${tel}`}>{icon('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>')}Soita</a>}
        {tel && <a href={`sms:${tel}`}>{icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')}Tekstiviesti</a>}
        {tel && <a href={`https://wa.me/${tel.replace("+", "")}`} target="_blank" rel="noopener noreferrer">{icon('<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/>')}WhatsApp</a>}
        {o.customer.email && <a href={`mailto:${o.customer.email}?subject=${subject}`}>{icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>')}Sähköposti</a>}
      </div> : <p className="empty" style={{ marginTop: 10 }}>Asiakkaan yhteystiedot puuttuvat. Ota yhteys tukeen.</p>}
    </div>

    <h3 className="photo-title">{pickup ? "Kuvat ennen ajoa" : "Kuvat perillä"}</h3>
    <p className="sub photo-hint">Ota kuvat ohjekuvan mukaisesti. Tähdellä (*) merkityt kuvat ovat pakollisia.</p>
    {slotBox(SLOTS[0])}
    <div className="field" style={{ margin: "12px 0 18px" }}>
      <label className="req-label" htmlFor="odoInput">Matkamittarin lukema (km)</label>
      <input type="number" id="odoInput" min={0} inputMode="numeric" placeholder="84250" required value={odo} onChange={e => setOdo(e.target.value)} />
    </div>
    <div className="photo-grid">{SLOTS.slice(1).map(slotBox)}</div>
    <div className="fields" style={{ margin: "18px 0 14px" }}>
      <div className="field">
        <label htmlFor="fuelInput">Polttoaine / Akku (%)</label>
        <select id="fuelInput" value={fuel} onChange={e => setFuel(e.target.value)}>{FUEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
    </div>
    <div className="field full" style={{ marginTop: 10 }}>
      <label htmlFor="inspectNotes">Huomiot</label>
      <textarea id="inspectNotes" rows={2} maxLength={2000} placeholder="Ei havaittuja vaurioita" value={notes} onChange={e => setNotes(e.target.value)} />
    </div>
    <button className="btn green block" type="submit" id="tripSubmit" disabled={saving}>
      {saving ? "Tallennetaan…" : pickup ? "Tallenna kuvat ja aloita ajo →" : "Tallenna kuvat ja luovuta auto ✓"}
    </button>

    {dialog && <Dialog {...dialog} />}
    {camSlot && <Camera slot={camSlot} onClose={() => setCamFor(null)}
      onPhoto={src => { setCamFor(null); void save(camSlot.key, src); }}
      onFile={phoneCamera => {
        // Gallery, or the phone's own camera app when the camera cannot run in the app.
        const inp = inputs.current[camSlot.key]; setCamFor(null);
        if (phoneCamera) inp?.setAttribute("capture", "environment"); else inp?.removeAttribute("capture");
        inp?.click();
      }} />}
  </form>;
}
