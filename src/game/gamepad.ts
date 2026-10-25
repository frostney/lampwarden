// Gamepad support through the browser Gamepad API, standard mapping (Xbox / PlayStation / Switch Pro layouts).
// During a night the pad drives the warden: left stick or d-pad moves (8-way, like the touch stick, so recordings stay
// small), A strikes, B / X / right trigger shoot (along the right stick when it is held, else at the nearest monster),
// and getting hurt rumbles; Start skips the practice night. In the menus the d-pad or left stick moves focus between
// buttons and A / Start presses.
import { type Controls, press } from "./controls";
import type { State } from "./sim";

// standard-mapping button indices
const BUTTON = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  rightBumper: 5,
  rightTrigger: 7,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} satisfies Record<string, number>;
const STICK_DEADZONE = 0.35;
const AIM_DEADZONE = 0.5;
const AIM_DISTANCE = 260;

export type MenuAction = "previous" | "next" | "confirm" | "primary";

// buttons held on the previous poll, so a press acts once
export interface GamepadMemory {
  held: Set<number>;
  menuRepeatAt: number;
  wasHurt: boolean;
}
export const newGamepadMemory = (): GamepadMemory => ({ held: new Set(), menuRepeatAt: 0, wasHurt: false });

export function activeGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const gamepad of navigator.getGamepads()) if (gamepad?.connected) return gamepad;
  return null;
}

const isPressed = (gamepad: Gamepad, index: number) => gamepad.buttons[index]?.pressed ?? false;

// buttons that went down since the last poll
function newlyPressed(gamepad: Gamepad, memory: GamepadMemory): Set<number> {
  const pressedNow = new Set<number>();
  gamepad.buttons.forEach((button, index) => {
    if (button.pressed) pressedNow.add(index);
  });
  const fresh = new Set([...pressedNow].filter((index) => !memory.held.has(index)));
  memory.held = pressedNow;
  return fresh;
}

// one of eight directions, or none inside the dead zone
function eightWay(horizontal: number, vertical: number): [number, number] {
  if (Math.hypot(horizontal, vertical) < STICK_DEADZONE) return [0, 0];
  const sector = Math.round(Math.atan2(vertical, horizontal) / (Math.PI / 4));
  return [Math.round(Math.cos((sector * Math.PI) / 4)), Math.round(Math.sin((sector * Math.PI) / 4))];
}

// Called once per frame during a night, before the sim reads the controls.
export function pollGamepadForPlay(controls: Controls, state: State, memory: GamepadMemory) {
  const gamepad = activeGamepad();
  if (!gamepad) {
    controls.gamepadX = controls.gamepadY = 0;
    return;
  }
  const padHorizontal = (isPressed(gamepad, BUTTON.right) ? 1 : 0) - (isPressed(gamepad, BUTTON.left) ? 1 : 0);
  const padVertical = (isPressed(gamepad, BUTTON.down) ? 1 : 0) - (isPressed(gamepad, BUTTON.up) ? 1 : 0);
  const [stickHorizontal, stickVertical] = eightWay(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
  controls.gamepadX = padHorizontal || stickHorizontal;
  controls.gamepadY = padVertical || stickVertical;

  const fresh = newlyPressed(gamepad, memory);
  if (fresh.has(BUTTON.south)) press(controls, "melee", state);
  if (
    fresh.has(BUTTON.east) ||
    fresh.has(BUTTON.west) ||
    fresh.has(BUTTON.rightTrigger) ||
    fresh.has(BUTTON.rightBumper)
  ) {
    const aimHorizontal = gamepad.axes[2] ?? 0,
      aimVertical = gamepad.axes[3] ?? 0;
    if (Math.hypot(aimHorizontal, aimVertical) > AIM_DEADZONE) {
      // aim along the right stick: a point ahead of the warden in that direction (the ground is foreshortened 2:1)
      const length = Math.hypot(aimHorizontal, aimVertical);
      controls.ranged = true;
      controls.aim = {
        x: Math.round(state.hero.x + (aimHorizontal / length) * AIM_DISTANCE),
        y: Math.round(state.hero.y - 40 + (aimVertical / length) * AIM_DISTANCE * 0.5),
      };
    } else press(controls, "ranged", state);
  }

  const hurt = state.hero.hurt > 0;
  if (hurt && !memory.wasHurt)
    void gamepad.vibrationActuator?.playEffect("dual-rumble", {
      duration: 140,
      strongMagnitude: 0.7,
      weakMagnitude: 0.4,
    });
  memory.wasHurt = hurt;
}

// Notes what the pad holds without acting on it, while a poll is not acting (a paused night, or the menus during a
// night): a button already down when it acts again is not a new press.
// Returns whether Start went down since the last poll (the warden has no use for it: the practice night skips on it).
export function holdGamepad(memory: GamepadMemory): boolean {
  const gamepad = activeGamepad();
  if (!gamepad) return false;
  const fresh = newlyPressed(gamepad, memory);
  // a direction held the same way moves the menu focus only once it is let go and pushed again
  memory.menuRepeatAt = menuDirection(gamepad) ? Number.POSITIVE_INFINITY : 0;
  return fresh.has(BUTTON.start);
}

// the way the d-pad or left stick moves the menu focus: 1 on, -1 back, 0 not at all
function menuDirection(gamepad: Gamepad): number {
  const vertical =
    (isPressed(gamepad, BUTTON.down) ? 1 : 0) - (isPressed(gamepad, BUTTON.up) ? 1 : 0) ||
    Math.round(gamepad.axes[1] ?? 0);
  const horizontal =
    (isPressed(gamepad, BUTTON.right) ? 1 : 0) - (isPressed(gamepad, BUTTON.left) ? 1 : 0) ||
    Math.round(gamepad.axes[0] ?? 0);
  return vertical || horizontal;
}

// Called once per frame outside a night: returns the menu action the pad asks for, if any.
export function pollGamepadForMenu(memory: GamepadMemory, now: number): MenuAction | null {
  const gamepad = activeGamepad();
  if (!gamepad) return null;
  const fresh = newlyPressed(gamepad, memory);
  if (fresh.has(BUTTON.south)) return "confirm";
  if (fresh.has(BUTTON.start)) return "primary";
  const direction = menuDirection(gamepad);
  if (!direction) {
    memory.menuRepeatAt = 0;
    return null;
  }
  if (now < memory.menuRepeatAt) return null;
  // first move at once, then repeat while held
  memory.menuRepeatAt = now + (memory.menuRepeatAt === 0 ? 350 : 140);
  return direction > 0 ? "next" : "previous";
}
