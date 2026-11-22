"use client";
import { useEffect, useRef, useState } from "react";

type Suggestion = { placeId: string; main: string; secondary: string };

/** One search session per form (Google bills autocomplete + details per session). */
export const newSession = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));

/**
 * Address field with suggestions from Google (through /api/places). Looks like the other fields of the form:
 * pass the form's own input class. Calls onPick with the chosen place, or null when the text is edited again.
 */
export function AddressInput({ id, name, className, placeholder, session, value, onPick, required, ariaLabel }: {
  id: string; name?: string; className?: string; placeholder?: string; session: string; required?: boolean; ariaLabel?: string;
  value?: { placeId: string; text: string } | null; onPick: (p: { placeId: string; text: string } | null) => void;
}) {
  const [text, setText] = useState(value?.text ?? "");
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef("");

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setList([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      last.current = q;
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(q)}&s=${encodeURIComponent(session)}`);
        const j = await r.json();
        if (last.current !== q) return;
        setList(j.suggestions || []); setOpen(true); setActive(-1);
        setError(j.error || "");
      } catch { setError("Osoitehaku ei juuri nyt toimi"); }
    }, 250);
  };
  const pick = (s: Suggestion) => {
    const t = s.secondary ? `${s.main}, ${s.secondary}` : s.main;
    setText(t); setOpen(false); setList([]);
    onPick({ placeId: s.placeId, text: t });
  };

  return <div className="addr" data-addr={id}>
    <input id={id} name={name} className={className} placeholder={placeholder} autoComplete="off" required={required} aria-label={ariaLabel}
      role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" value={text}
      onChange={e => { setText(e.target.value); onPick(null); search(e.target.value); }}
      onFocus={() => { if (list.length) setOpen(true); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={e => {
        if (!open || !list.length) return;
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
        if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(list[active]); }
        if (e.key === "Escape") setOpen(false);
      }} />
    {open && (list.length > 0 || error) && <ul className="addr-list" id={`${id}-list`} role="listbox">
      {list.map((s, i) => <li key={s.placeId} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
        onMouseDown={e => { e.preventDefault(); pick(s); }}>
        <b>{s.main}</b>{s.secondary && <span>{s.secondary}</span>}
      </li>)}
      {error && <li className="addr-error">{error}</li>}
    </ul>}
  </div>;
}
