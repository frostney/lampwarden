// The warden's controls between frames: held keys, the touch stick, and melee/ranged presses waiting for the next sim
// step. One mutable object, written by keyboard, pointer and touch handlers and read by the scene's fixed-step loop, so
// input never causes a React render.
import { quantise } from "./replay";
import { MONSTER, type Input, type State } from "./sim";

export interface Controls {
  keys: Set<string>;
  stickX: number; stickY: number;
  gamepadX: number; gamepadY: number;   // the gamepad's left stick or d-pad, 8-way
  melee: boolean; ranged: boolean; aim: { x: number; y: number } | null;
}

export const newControls = (): Controls => ({ keys: new Set(), stickX: 0, stickY: 0, gamepadX: 0, gamepadY: 0, melee: false, ranged: false, aim: null });

const held = (c: Controls, a: string, b: string) => (c.keys.has(a) || c.keys.has(b) ? 1 : 0);
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

// the input for the next sim step, quantised so live play and replay see identical numbers
export function liveInput(c: Controls): Input {
  return quantise({
    dx: clamp1(held(c, "d", "arrowright") - held(c, "a", "arrowleft") + c.stickX + c.gamepadX),
    dy: clamp1(held(c, "s", "arrowdown") - held(c, "w", "arrowup") + c.stickY + c.gamepadY),
    melee: c.melee, ranged: c.ranged, aim: c.aim,
  });
}

// a press reaches exactly one sim step
export function consumePresses(c: Controls) { c.melee = false; c.ranged = false; }

// pausing lets go of every held key and the stick
export function release(c: Controls) { c.keys.clear(); c.stickX = c.stickY = 0; c.gamepadX = c.gamepadY = 0; }

export function stick(c: Controls, dx: number, dy: number) { c.stickX = dx; c.stickY = dy; }

// a shot towards a point on the canvas (mouse click)
export function shootAt(c: Controls, x: number, y: number) { c.ranged = true; c.aim = { x, y }; }

// touch buttons: no cursor, so a shot aims at the nearest monster's body, or along the facing when there is none
export function press(c: Controls, k: "melee" | "ranged", s: State | null) {
  if (k === "melee") { c.melee = true; return; }
  c.ranged = true; c.aim = null;
  if (!s) return;
  let best = Infinity;
  for (const m of s.monsters) {
    const d = Math.hypot(m.x - s.hero.x, (m.y - s.hero.y) * 2);
    if (d < best) { best = d; c.aim = { x: m.x, y: m.y - (MONSTER[m.kind].fly ? 56 : 32) }; }
  }
}

// WASD / arrows move, J / Space melee, K ranged along the facing; returns the unbind function
export function bindKeyboard(c: Controls): () => void {
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (k === "j" || k === " ") { if (!e.repeat) c.melee = true; return; }
    if (k === "k") { if (!e.repeat) { c.ranged = true; c.aim = null; } return; }
    c.keys.add(k);
  };
  const up = (e: KeyboardEvent) => c.keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
}
