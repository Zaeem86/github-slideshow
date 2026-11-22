"use client";
import "./driver-start.css";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** The ZEMO emblem with the wordmark under it. */
export const Emblem = ({ small = false }: { small?: boolean }) =>
  <div className={`ds-logo${small ? " small" : ""}`}>
    <Image src="/brand/zemo-emblem.webp" alt="ZEMO" width={520} height={350} priority className="ds-emblem" />
    <div className="ds-word">ZEMO</div>
  </div>;

/**
 * Driver start screen: swipe the orange knob to the right to reach the sign-in.
 * The knob slides back to the middle and home until it is touched. Enter/Space on the knob also opens the sign-in.
 */
export function SwipeGate({ skip = false, children }: { skip?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(skip);
  const track = useRef<HTMLDivElement>(null), knob = useRef<HTMLButtonElement>(null), fill = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, x: 0 });
  const [idle, setIdle] = useState(true);

  useEffect(() => {
    if (open) return;
    const k = knob.current!, f = fill.current!, t = track.current!;
    const max = () => t.clientWidth - k.clientWidth - 10;
    const move = (clientX: number) => {
      const d = drag.current;
      if (!d.active) return;
      d.x = Math.max(0, Math.min(clientX - d.startX, max()));
      k.style.transform = `translateX(${d.x}px)`;
      f.style.width = `${d.x + k.clientWidth + 5}px`;
      if (d.x >= max() * 0.82) {
        d.active = false;
        k.style.transition = "transform .2s ease";
        k.style.transform = `translateX(${max()}px)`;
        setTimeout(() => setOpen(true), 180);
      }
    };
    const end = () => {
      const d = drag.current;
      if (!d.active) return;
      d.active = false; d.x = 0;
      k.style.transition = "transform .3s cubic-bezier(.2,.8,.2,1)";
      f.style.transition = "width .3s cubic-bezier(.2,.8,.2,1)";
      k.style.transform = "translateX(0px)";
      f.style.width = "64px";
      setTimeout(() => { if (!drag.current.active) { k.style.transition = ""; setIdle(true); } }, 320);
    };
    const onMouse = (e: MouseEvent) => move(e.clientX);
    const onTouch = (e: TouchEvent) => move(e.touches[0].clientX);
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", end);
    };
  }, [open]);

  const start = (clientX: number) => {
    setIdle(false);
    knob.current!.style.transition = "none";
    fill.current!.style.transition = "none";
    drag.current = { active: true, startX: clientX - drag.current.x, x: drag.current.x };
  };

  if (open) return <div className="ds-login">{children}</div>;
  return <section className="ds-splash" id="swipeScreen">
    <div />
    <Emblem />
    <div className="ds-swipe">
      <div className="ds-track" ref={track}>
        <div className="ds-fill" ref={fill} />
        <button type="button" ref={knob} id="swipeKnob" className={`ds-knob${idle ? " nudge" : ""}`}
          aria-label="Pyyhkäise oikealle kirjautuaksesi / Swipe right to sign in"
          onMouseDown={e => start(e.clientX)} onTouchStart={e => start(e.touches[0].clientX)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="#140d08" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  </section>;
}
