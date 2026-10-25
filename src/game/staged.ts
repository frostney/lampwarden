// Nights staged by code instead of sent by the sea: the opening scene and the practice night. They run on the real sim
// (step() in sim.ts), but nothing comes ashore by itself and dawn never comes: the staging puts each monster on the rim
// and each lamp out by hand, between steps, from the night's driver. Neither is recorded, uploaded or counted, and
// nothing here is in the sim fingerprint, so a staged night never touches a recorded one.
import { type Legacy, newLegacy } from "./legacy";
import {
  CENTRE_X,
  CENTRE_Y,
  type HandMadeKind,
  type Input,
  LANTERN_HEIGHT,
  type Lamp,
  litCount,
  MONSTER,
  NO_INPUT,
  newNight,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  type State,
} from "./sim";

// the warden can be clawed down to this and no further: a monster's blow takes at most 16 (the cyclops)
const HEALTH_FLOOR = 40;
// at least this many lamps stay lit, and one more than the monsters clawing at lamps (each can put out at most one in a
// step), so the night is never lost to the dark
const LAMPS_KEPT = 2;
// where on the rim a staged monster comes ashore, as a share of the plaza's half extents (spawn() in sim.ts uses the same)
const SHORE = 0.9;

// A night 1 at the first tide for the line's warden (their trait and upgrades), with nothing coming from the sea and no
// dawn: what happens in it is staged.
export function stagedNight(legacy: Pick<Legacy, "heir" | "levels">, seed: number): State {
  const state = newNight({ ...newLegacy(0), heir: legacy.heir, levels: legacy.levels }, seed);
  state.spawnTimer = Number.POSITIVE_INFINITY;
  state.length = Number.POSITIVE_INFINITY;
  return state;
}

// The angle on the rim (the plaza's ellipse, as spawn() places them) that a point on the plaza lies towards from the centre.
export const rimAngleOf = (x: number, y: number) =>
  x === CENTRE_X && y === CENTRE_Y
    ? Math.PI / 2
    : Math.atan2((y - CENTRE_Y) / PLAZA_HALF_HEIGHT, (x - CENTRE_X) / PLAZA_HALF_WIDTH);

// A monster climbs out of the sea at `angle` on the rim (0 east, a quarter turn the harbour at the front).
export function summon(state: State, kind: HandMadeKind, angle: number) {
  state.monsters.push({
    id: state.nextId++,
    kind,
    x: CENTRE_X + Math.cos(angle) * PLAZA_HALF_WIDTH * SHORE,
    y: CENTRE_Y + Math.sin(angle) * PLAZA_HALF_HEIGHT * SHORE,
    health: MONSTER[kind].health,
    age: 0,
    wobble: 14,
    snuff: 0,
    attackCooldown: 0,
    hurt: 0,
    stun: 0,
    knockX: 0,
    knockY: 0,
  });
}

// A lamp goes out with the puff a monster's clawing leaves.
export function snuff(state: State, lamp: Lamp) {
  lamp.lit = false;
  lamp.relight = 0;
  state.puffs.push(puffAt(state, lamp, "snuff"));
}

const puffAt = (state: State, lamp: Lamp, kind: "snuff" | "light") => ({
  id: state.nextId++,
  x: lamp.x,
  y: lamp.y - LANTERN_HEIGHT,
  age: 0,
  kind,
  directionX: 0,
  directionY: 0,
  ghost: null,
});

// Keeps a staged night from ending: the warden is never clawed below HEALTH_FLOOR (one blow lands per step at most: it
// starts his mercy frames), and while fewer lamps burn than LAMPS_KEPT, or than one more than the monsters clawing at
// lamps, dark ones relight by themselves (never `keepDark`, the lamp a lesson is about). Called before each step.
export function spare(state: State, keepDark: Lamp | null = null) {
  state.hero.health = Math.max(state.hero.health, Math.min(HEALTH_FLOOR, state.hero.maxHealth));
  const clawing = state.monsters.filter((monster) => monster.snuff > 0).length;
  const kept = Math.max(LAMPS_KEPT, clawing + 1);
  for (const lamp of state.lamps) {
    if (litCount(state) >= kept) {
      return;
    }
    if (lamp.lit || lamp === keepDark) {
      continue;
    }
    lamp.lit = true;
    lamp.relight = 0;
    state.puffs.push(puffAt(state, lamp, "light"));
  }
}

// The warden's step towards a point on the ground: a unit heading (the ground is foreshortened 2:1, so a screen
// offset's y counts twice), or none once within `arrive` or on the point itself.
export function toward(state: State, x: number, y: number, arrive: number): Input {
  const offsetX = x - state.hero.x;
  const offsetY = (y - state.hero.y) * 2;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance === 0 || distance < arrive) {
    return NO_INPUT;
  }
  return { ...NO_INPUT, moveX: offsetX / distance, moveY: offsetY / distance };
}

// How near a monster the warden walks before he swings: inside his reach, with room for it to wobble.
const SWING_ROOM = 14;
// how near a dark lamp the autopilot walks to relight it
const AT_LAMP = 16;

// A warden played by code: he walks up to the nearest monster and strikes it, turning to face it as he swings, and
// once none is left he walks to a dark lamp and stands by it until it lights. Null when there is nothing left to do.
export function wardenAutopilot(state: State): Input | null {
  const hero = state.hero;
  let nearest: { x: number; y: number; distance: number } | null = null;
  for (const monster of state.monsters) {
    const distance = Math.hypot(monster.x - hero.x, (monster.y - hero.y) * 2);
    if (!nearest || distance < nearest.distance) {
      nearest = { x: monster.x, y: monster.y, distance };
    }
  }
  if (nearest) {
    const heading = toward(state, nearest.x, nearest.y, 0);
    if (nearest.distance < state.rules.meleeReach - SWING_ROOM) {
      return { ...heading, melee: true };
    }
    return heading;
  }
  const dark = state.lamps.find((lamp) => !lamp.lit);
  return dark ? toward(state, dark.x, dark.y, AT_LAMP) : null;
}
