// How the lamps, and the warden's own weaker light, light what stands in them, as numbers: how lit it is, where the light
// comes from, and so the warm tint that goes on its sprite, the cast shadows on the ground and the rim on the side facing
// the light. Pure and render-only (the sim never reads it); the textures for shadows and rims are painted in shadow.ts and
// rim.ts. Everything steps in whole levels, like the pools do, so a character walking out of a light drops through bands
// instead of fading.
//
// Who is lit: every character (the warden himself a little, the monsters by his light and the lamps'), and the small props
// (the statue, the stall, the olive trees, the decorations and the lamps' own posts: lightProp), each by the point on the ground where it
// stands. The buildings (temple, house, wall) and the boats are not: one tint across a sprite that large would light its
// whole face at once, a wall of warm over a building whose far end is a hundred pixels from the lamp. They keep the night's
// tint, and the pools of light on the ground are what shows a lamp is near.
import type { Lamp, State } from "../game/sim";
import { lightsAlpha, nightProgress, nightTint } from "./layers";
import { HERO_LIGHT, heroFlickerStep, heroLightEllipse, lampFlickerStep, POOL_FALLOFF, poolEllipse } from "./light";

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

// The warden's own light is a weak one: at its centre it lights a monster a good deal less than a lamp lights one at its
// foot, and it falls off across the ellipse he lights the ground with (light.ts HERO_LIGHT).
const WARDEN_GAIN = 0.5;
// how lit the warden himself is by it, whatever else stands near: one step of warm, as the lamp he carries would give him
const WARDEN_SELF = 0.15;
// where his light shines from, above his feet: the lamp at his belt
const WARDEN_LIGHT_HEIGHT = 38;

// one light lighting a character or a prop: a lamp, or the warden
interface LightSource {
  strength: number; // 0 (the edge of the light) to 1 (a lamp's foot), after the flicker and the dawn
  closeness: number; // 0 at the light's foot to 1 at its edge
  directionX: number; // the unit vector along the ground (x, and y at 2:1) from the light's foot to what it lights
  directionY: number;
  lampX: number; // the light's foot on the ground
  lampY: number;
  height: number; // how far above its foot the light shines from
}
interface Illumination {
  amount: number; // every light together, in whole steps, 0 to 1
  lampAmount: number; // the lamps alone, which is what the moon's shadow and the characters' cast shadows answer to
  sources: readonly LightSource[]; // up to the two strongest lamps
  warden: LightSource | null; // the warden's light, when it reaches the point and it is not the warden himself
}
// Whose light is on the point being lit: the warden's, shining from where he stands, or "self" for the warden himself,
// who carries it and so is lit by it a little wherever he stands.
export type WardenLight = { x: number; y: number } | "self";
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

// The warden's light on a point on the ground: the ellipse he lights the ground with, and its falloff, so a monster is as
// lit as the ground under its feet; null beyond it, or too faint to count.
function wardenSource(
  warden: { x: number; y: number },
  x: number,
  y: number,
  clock: number,
  fade: number,
): LightSource | null {
  const light = heroLightEllipse(warden.x, warden.y, heroFlickerStep(clock));
  const closeness = Math.hypot((x - light.centerX) / light.radiusX, (y - light.centerY) / light.radiusY);
  if (closeness >= 1) return null;
  const strength = (1 - closeness ** HERO_LIGHT.falloff) * fade * WARDEN_GAIN;
  if (strength < MIN_SOURCE) return null;
  const acrossGround = x - warden.x;
  const downGround = (y - warden.y) * 2;
  const length = Math.hypot(acrossGround, downGround);
  return {
    strength,
    closeness,
    directionX: length < 2 ? 0 : acrossGround / length,
    directionY: length < 2 ? 0 : downGround / length,
    lampX: warden.x,
    lampY: warden.y,
    height: WARDEN_LIGHT_HEIGHT,
  };
}

// Which lights light a point on the ground and how much: the lit lamps, by the pool's own shape and falloff, so a character
// is as lit as the ground under its feet, flickering with the lamp, and the warden's weaker light (`warden`). `fade` is the
// dawn taking the lights away. `skip` is a lamp that does not light the point, a lamp's own post.
export function illuminate(
  lamps: readonly Lamp[],
  radius: number,
  x: number,
  y: number,
  clock: number,
  fade: number,
  warden: WardenLight | null = null,
  skip: Lamp | null = null,
): Illumination {
  const sources: LightSource[] = [];
  let unlit = 1;
  for (const lamp of lamps) {
    if (!lamp.lit || lamp === skip) continue;
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
      height: LANTERN_HEIGHT,
    });
  }
  sources.sort((first, second) => second.strength - first.strength);
  const lampAmount = stepped(1 - unlit, LIGHT_STEPS);
  let wardenLight: LightSource | null = null;
  if (warden === "self") unlit *= 1 - Math.min(1, WARDEN_SELF * fade * TINT_GAIN);
  else if (warden) {
    wardenLight = wardenSource(warden, x, y, clock, fade);
    if (wardenLight) unlit *= 1 - Math.min(1, wardenLight.strength * TINT_GAIN);
  }
  return {
    amount: stepped(1 - unlit, LIGHT_STEPS),
    lampAmount,
    sources: sources.slice(0, 2),
    warden: wardenLight,
  };
}

const octant = (angle: number) => ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
// the same octant seen in a sprite mirrored left to right
export const mirroredOctant = (direction: number) => (12 - direction) % 8;

// Light a character standing at (x, y) on the ground. `flying` ones are drawn above their ground point (harpies), so their
// shadow is fainter and their body higher. `warden` is whose light is on it besides the lamps': the warden's, by default
// from where he stands, or "self" when the character is the warden. His light tints the character and puts a rim on the
// side that faces him, and casts no shadow: he is the source, and a light that weak does not throw one.
export function lightCharacter(
  state: State,
  x: number,
  y: number,
  flying: boolean,
  clock: number,
  warden: WardenLight = state.hero,
): CharacterLight {
  const progress = nightProgress(state);
  const {
    amount,
    lampAmount,
    sources,
    warden: wardenLight,
  } = illuminate(state.lamps, state.rules.lightRadius, x, y, clock, lightsAlpha(progress), warden);
  const shade = flying ? 0.6 : 1;
  const shadows: ShadowSpec[] = [
    {
      angleIndex: MOON_ANGLE_INDEX,
      lengthStep: MOON_LENGTH_STEP,
      alpha: stepped(MOON_ALPHA * (1 - 0.75 * lampAmount) * shade, 8),
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
  const lamp = sources[0];
  const brightest = wardenLight && (!lamp || wardenLight.strength > lamp.strength) ? wardenLight : lamp;
  let rim: RimSpec | null = null;
  if (brightest && brightest.strength >= MIN_RIM) {
    const bodyY = y - (flying ? FLYING_BODY_HEIGHT : BODY_HEIGHT);
    rim = {
      direction: octant(Math.atan2(brightest.lampY - brightest.height - bodyY, brightest.lampX - x)),
      alpha: brightest.strength >= 0.55 ? 1 : 0.6,
    };
  }
  return { tint: lampTint(nightTint(progress), amount), shadows, rim };
}

// The tint of a small prop whose base is at (x, y): the night's, brought up by the lamps' light and the warden's on the
// ground where it stands, in whole steps like a character's. `lamp` is the lamp a post belongs to, whose own pool does
// not light it (its foot is lit warm on top, see lampFootTint).
export function lightProp(state: State, x: number, y: number, clock: number, lamp: Lamp | null = null): number {
  const progress = nightProgress(state);
  const { amount } = illuminate(
    state.lamps,
    state.rules.lightRadius,
    x,
    y,
    clock,
    lightsAlpha(progress),
    state.hero,
    lamp,
  );
  return lampTint(nightTint(progress), amount);
}

// the tint of a lit lamp's foot, drawn over the lamp: it stands in its own pool, so its brass is warm and bright
export function lampFootTint(state: State): number {
  return lampTint(nightTint(nightProgress(state)), LAMP_FOOT_AMOUNT);
}
