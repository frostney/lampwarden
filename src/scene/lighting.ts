// How the lamps light a character, as numbers: how lit it is, where the light comes from, and so the warm tint that goes
// on its sprite, the cast shadows on the ground and the rim on the side facing the lamp. Pure and render-only (the sim
// never reads it); the textures for shadows and rims are painted in shadow.ts and rim.ts. Everything steps in whole
// levels, like the pools do, so a character walking out of a lamp's light drops through bands instead of fading.
import type { Lamp, State } from "../game/sim";
import { lightsAlpha, nightProgress, nightTint } from "./layers";
import { lampFlickerStep, POOL_FALLOFF, poolEllipse } from "./light";

// the warm of lamp light on a sprite at full strength: the sprite in its own colours, a little amber (a tint can only
// darken, so this is the most a lamp can bring a sprite back from the night)
const LAMP_TINT = 0xffe2b0;
// the steps a character's lit amount moves in
const LIGHT_STEPS = 6;
const LAMP_FOOT_AMOUNT = 0.9;
// a lamp's light on the sprite and the ground reaches no further than a pool's edge, and a lamp counts for the rim and
// the shadow only while it lights the character at least this much
const MIN_SOURCE = 0.08;
// a sprite takes the light a little earlier than the ground does, so it reads as lit while the pool's bands are still dim
const TINT_GAIN = 1.35;
const MIN_RIM = 0.2;

export const SHADOW_ANGLES = 16;
export const SHADOW_LENGTHS = [0, 9, 18, 28, 38] as const; // ground pixels, nearest to farthest
// the moon: a faint shadow that always falls the way the sprites' own painted shadows did (right, a little back)
const MOON_ANGLE_INDEX = 15;
const MOON_LENGTH_STEP = 3;
const MOON_ALPHA = 0.34;

// a body's height above its feet, and a lamp lantern's above its base, where the rim's light comes from and goes to
const BODY_HEIGHT = 32;
const FLYING_BODY_HEIGHT = 70;
const LANTERN_HEIGHT = 77;

// one lamp lighting a character
interface LampSource {
  strength: number; // 0 (the pool's edge) to 1 (the lamp's foot), after the flicker and the dawn
  closeness: number; // 0 at the lamp's foot to 1 at the pool's edge
  directionX: number; // the unit vector along the ground (x, and y at 2:1) from the lamp's foot to the character
  directionY: number;
  lampX: number;
  lampY: number;
}
interface Illumination {
  amount: number; // all lamps together, in whole steps, 0 to 1
  sources: readonly LampSource[]; // up to the two strongest
}
interface ShadowSpec {
  angleIndex: number; // which of SHADOW_ANGLES, counted from the ground's +x clockwise on the screen
  lengthStep: number; // an index into SHADOW_LENGTHS
  alpha: number;
}
export interface RimSpec {
  direction: number; // the octant the light comes from on the screen: 0 east, 1 south-east, 2 south ... 7 north-east
  alpha: number;
}
export interface CharacterLight {
  tint: number;
  shadows: readonly ShadowSpec[];
  rim: RimSpec | null;
}
export const DARK_CHARACTER: CharacterLight = { tint: 0xffffff, shadows: [], rim: null };

const stepped = (value: number, steps: number) => Math.round(value * steps) / steps;
const channel = (colour: number, shift: number) => (colour >> shift) & 255;

// the sprite's tint: the night's, brought up towards the lamp's warm by how lit it is, never below the night's
export function lampTint(night: number, amount: number): number {
  let tint = 0;
  for (const shift of [16, 8, 0]) {
    const dark = channel(night, shift);
    const bright = Math.max(dark, channel(LAMP_TINT, shift));
    tint |= Math.round(dark + (bright - dark) * amount) << shift;
  }
  return tint;
}

// Which lamps light a point on the ground and how much. The pool's own shape and falloff, so a character is as lit as the
// ground under its feet, flickering with the lamp. `fade` is the dawn taking the lights away.
export function illuminate(
  lamps: readonly Lamp[],
  radius: number,
  x: number,
  y: number,
  clock: number,
  fade: number,
): Illumination {
  const sources: LampSource[] = [];
  let unlit = 1;
  for (const lamp of lamps) {
    if (!lamp.lit) continue;
    const pool = poolEllipse(lamp.x, lamp.y, radius, lampFlickerStep(lamp.x, lamp.y, clock));
    const closeness = Math.hypot((x - pool.centerX) / pool.radiusX, (y - pool.centerY) / pool.radiusY);
    if (closeness >= 1) continue;
    const strength = (1 - closeness ** POOL_FALLOFF) * fade;
    if (strength < MIN_SOURCE) continue;
    unlit *= 1 - Math.min(1, strength * TINT_GAIN);
    const acrossGround = x - lamp.x;
    const downGround = (y - lamp.y) * 2;
    const length = Math.hypot(acrossGround, downGround);
    sources.push({
      strength,
      closeness,
      directionX: length < 2 ? 0 : acrossGround / length,
      directionY: length < 2 ? 0 : downGround / length,
      lampX: lamp.x,
      lampY: lamp.y,
    });
  }
  sources.sort((first, second) => second.strength - first.strength);
  return { amount: stepped(1 - unlit, LIGHT_STEPS), sources: sources.slice(0, 2) };
}

const octant = (angle: number) => ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
// the same octant seen in a sprite mirrored left to right
export const mirroredOctant = (direction: number) => (12 - direction) % 8;

// Light a character standing at (x, y) on the ground. `flying` ones are drawn above their ground point (harpies), so their
// shadow is fainter and their body higher.
export function lightCharacter(state: State, x: number, y: number, flying: boolean, clock: number): CharacterLight {
  const progress = nightProgress(state);
  const { amount, sources } = illuminate(state.lamps, state.rules.lightRadius, x, y, clock, lightsAlpha(progress));
  const shade = flying ? 0.6 : 1;
  const shadows: ShadowSpec[] = [
    {
      angleIndex: MOON_ANGLE_INDEX,
      lengthStep: MOON_LENGTH_STEP,
      alpha: stepped(MOON_ALPHA * (1 - 0.75 * amount) * shade, 8),
    },
  ];
  for (const source of sources) {
    const angle =
      source.directionX === 0 && source.directionY === 0 ? 0 : Math.atan2(source.directionY, source.directionX);
    shadows.push({
      angleIndex:
        ((Math.round(angle / ((2 * Math.PI) / SHADOW_ANGLES)) % SHADOW_ANGLES) + SHADOW_ANGLES) % SHADOW_ANGLES,
      lengthStep: Math.min(SHADOW_LENGTHS.length - 1, Math.round(source.closeness * (SHADOW_LENGTHS.length - 1))),
      alpha: stepped((0.28 + 0.34 * source.strength) * shade, 8),
    });
  }
  const brightest = sources[0];
  let rim: RimSpec | null = null;
  if (brightest && brightest.strength >= MIN_RIM) {
    const bodyY = y - (flying ? FLYING_BODY_HEIGHT : BODY_HEIGHT);
    rim = {
      direction: octant(Math.atan2(brightest.lampY - LANTERN_HEIGHT - bodyY, brightest.lampX - x)),
      alpha: brightest.strength >= 0.55 ? 1 : 0.6,
    };
  }
  return { tint: lampTint(nightTint(progress), amount), shadows, rim };
}

// the tint of a lit lamp's foot, drawn over the lamp: it stands in its own pool, so its brass is warm and bright
export function lampFootTint(state: State): number {
  return lampTint(nightTint(nightProgress(state)), LAMP_FOOT_AMOUNT);
}
