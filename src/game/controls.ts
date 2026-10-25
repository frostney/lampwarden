// The warden's controls between frames: held keys, the touch stick, and melee/ranged presses waiting for the next sim
// step. One mutable object, written by keyboard, pointer and touch handlers and read by the scene's fixed-step loop, so
// input never causes a React render.
import { quantise } from "./replay";
import { bodyHeight, type Input, type State } from "./sim";

export interface Controls {
  keys: Set<string>;
  stickX: number;
  stickY: number;
  gamepadX: number; // the gamepad's left stick or d-pad, 8-way
  gamepadY: number;
  melee: boolean;
  ranged: boolean;
  aim: { x: number; y: number } | null;
}

export const newControls = (): Controls => ({
  keys: new Set(),
  stickX: 0,
  stickY: 0,
  gamepadX: 0,
  gamepadY: 0,
  melee: false,
  ranged: false,
  aim: null,
});

const held = (controls: Controls, key: string, alternative: string) =>
  controls.keys.has(key) || controls.keys.has(alternative) ? 1 : 0;
const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

// where a shot leaves the warden, above his feet (as in sim.ts)
const SHOT_RISE = 40;

// A recording stores "no aim" as a negative x, so an aim left of the stage (a pad aiming left near the left edge, a
// monster still out at sea) would replay as a shot along the facing. Such an aim is moved back along the line from the
// shot towards it until x is 0: the shot flies the same way, and the night replays as it was played.
function aimOnStage(aim: { x: number; y: number } | null, hero: { x: number; y: number }) {
  if (!aim || aim.x >= 0) return aim;
  const scale = hero.x / (hero.x - aim.x);
  return { x: 0, y: hero.y - SHOT_RISE + (aim.y - (hero.y - SHOT_RISE)) * scale };
}

// the input for the next sim step, quantised so live play and replay see identical numbers
export function liveInput(controls: Controls, hero: { x: number; y: number }): Input {
  return quantise({
    moveX: clampUnit(
      held(controls, "d", "arrowright") - held(controls, "a", "arrowleft") + controls.stickX + controls.gamepadX,
    ),
    moveY: clampUnit(
      held(controls, "s", "arrowdown") - held(controls, "w", "arrowup") + controls.stickY + controls.gamepadY,
    ),
    melee: controls.melee,
    ranged: controls.ranged,
    aim: aimOnStage(controls.aim, hero),
  });
}

// a press reaches exactly one sim step
export function consumePresses(controls: Controls) {
  controls.melee = false;
  controls.ranged = false;
}

// pausing lets go of every held key, the stick and any press that was waiting for a sim step
export function release(controls: Controls) {
  controls.keys.clear();
  controls.melee = false;
  controls.ranged = false;
  controls.aim = null;
  controls.stickX = 0;
  controls.stickY = 0;
  controls.gamepadX = 0;
  controls.gamepadY = 0;
}

export function stick(controls: Controls, horizontal: number, vertical: number) {
  controls.stickX = horizontal;
  controls.stickY = vertical;
}

// a shot towards a point on the canvas (mouse click)
export function shootAt(controls: Controls, x: number, y: number) {
  controls.ranged = true;
  controls.aim = { x, y };
}

// touch buttons: no cursor, so a shot aims at the nearest monster's body, or along the facing when there is none
export function press(controls: Controls, action: "melee" | "ranged", state: State | null) {
  if (action === "melee") {
    controls.melee = true;
    return;
  }
  controls.ranged = true;
  controls.aim = null;
  if (!state) return;
  let best = Number.POSITIVE_INFINITY;
  for (const monster of state.monsters) {
    const distance = Math.hypot(monster.x - state.hero.x, (monster.y - state.hero.y) * 2);
    if (distance < best) {
      best = distance;
      controls.aim = { x: monster.x, y: monster.y - bodyHeight(state, monster.kind) };
    }
  }
}

// WASD / arrows move, J / Space melee, K ranged along the facing; returns the unbind function. The arrow keys and Space
// are kept from scrolling the page and pressing buttons only while a night is live (`isLive`), so Space still presses a
// focused button on the title, dawn and pause screens.
export function bindKeyboard(controls: Controls, isLive: () => boolean): () => void {
  const keyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (isLive() && ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    if (key === "j" || key === " ") {
      if (!event.repeat) controls.melee = true;
      return;
    }
    if (key === "k") {
      if (!event.repeat) {
        controls.ranged = true;
        controls.aim = null;
      }
      return;
    }
    controls.keys.add(key);
  };
  const keyUp = (event: KeyboardEvent) => controls.keys.delete(event.key.toLowerCase());
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  return () => {
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
  };
}
