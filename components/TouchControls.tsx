"use client";

// On-screen controls for touch devices (hidden for mouse users by CSS): an 8-way stick, Strike and Shoot.
// The stick is quantised to 8 directions so recorded plays stay small and replay exactly.
import { useRef } from "react";

export function TouchControls({ onStick, onPress }: { onStick: (dx: number, dy: number) => void; onPress: (k: "melee" | "ranged") => void }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);

  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2, len = Math.hypot(x, y), k = len > max ? max / len : 1;
    knob.current!.style.transform = `translate(${x * k}px, ${y * k}px)`;
    if (len < max * 0.3) { onStick(0, 0); return; }
    const a = Math.round(Math.atan2(y, x) / (Math.PI / 4));   // 8 sectors
    onStick(Math.round(Math.cos((a * Math.PI) / 4)), Math.round(Math.sin((a * Math.PI) / 4)));
  };
  const end = () => { id.current = null; knob.current!.style.transform = ""; onStick(0, 0); };

  const btn = (k: "melee" | "ranged", label: string) => (
    <button className={`tbtn ${k}`} onPointerDown={(e) => { e.preventDefault(); onPress(k); }} aria-label={label}>{label}</button>
  );

  return (
    <div className="touch">
      <div ref={base} className="stick" aria-label="Move"
        onPointerDown={(e) => { id.current = e.pointerId; try { base.current!.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ } move(e); }}
        onPointerMove={(e) => { if (id.current === e.pointerId) move(e); }}
        onPointerUp={end} onPointerCancel={end}>
        <div ref={knob} className="knob" />
      </div>
      <div className="tbtns">
        {btn("ranged", "Shoot")}
        {btn("melee", "Strike")}
      </div>
    </div>
  );
}
