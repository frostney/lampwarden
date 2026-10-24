"use client";

// On-screen controls for touch devices (hidden for mouse users by CSS): an 8-way stick, Strike and Shoot.
// The stick is quantised to 8 directions so recorded plays stay small and replay exactly.
import { useRef } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { ARMS } from "@/game/weapons";
import type { Sex } from "@/scene/assets";

type Action = "melee" | "ranged";

export function TouchControls({
  sex,
  onStick,
  onPress,
}: {
  sex: Sex; // whose weapons the buttons show: sword and bow, or spear and sling
  onStick: (horizontal: number, vertical: number) => void;
  onPress: (action: Action) => void;
}) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  const move = (event: React.PointerEvent) => {
    if (!base.current) return;
    const bounds = base.current.getBoundingClientRect();
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    const radius = bounds.width / 2;
    const length = Math.hypot(x, y);
    const scale = length > radius ? radius / length : 1;
    if (knob.current) knob.current.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    if (length < radius * 0.3) {
      onStick(0, 0);
      return;
    }
    const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4)); // 8 sectors
    onStick(Math.round(Math.cos((sector * Math.PI) / 4)), Math.round(Math.sin((sector * Math.PI) / 4)));
  };
  const end = () => {
    activePointer.current = null;
    if (knob.current) knob.current.style.transform = "";
    onStick(0, 0);
  };

  const letGo = (event: React.PointerEvent<HTMLButtonElement>) => {
    delete event.currentTarget.dataset.pressed;
  };

  const actionButton = (action: Action, label: string, icon: IconName) => (
    <button
      type="button"
      className={`tbtn ${action}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.dataset.pressed = ""; // :active does not follow a prevented pointerdown on every device
        onPress(action);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onPointerLeave={letGo}
      aria-label={label}
    >
      <Icon name={icon} size={32} />
    </button>
  );

  return (
    <div className="touch">
      <div
        ref={base}
        className="stick"
        onPointerDown={(event) => {
          activePointer.current = event.pointerId;
          try {
            base.current?.setPointerCapture(event.pointerId);
          } catch {
            /* synthetic or already released */
          }
          move(event);
        }}
        onPointerMove={(event) => {
          if (activePointer.current === event.pointerId) move(event);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={knob} className="knob" />
      </div>
      <div className="tbtns">
        {actionButton("ranged", "Shoot", ARMS[sex].shootIcon)}
        {actionButton("melee", "Strike", ARMS[sex].strikeIcon)}
      </div>
    </div>
  );
}
