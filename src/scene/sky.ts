// The night sky above the horizon as pixel art: stepped, dithered bands, a field of stars, a crescent moon and the
// silhouettes of a headland with a lighthouse and a far island with a temple. It is not under the night tint (Scene.tsx
// tints only the world below it), so it is painted in its final colours, once per sky stage: the night, then
// DAWN_STAGES steps that warm it towards morning in step with nightTint. A few stars twinkle, the lighthouse blinks
// and the moon lays a broken path of light on the far sea; those are small textures picked from the scene clock (frozen
// by the visual verifier, so its frames are deterministic).
import type { Texture } from "pixi.js";
import { STAGE_WIDTH } from "../game/sim";
import { bayerThreshold, bufferTexture, hashUnit, hexRgb, putPixel, type Rgb, seededRandom } from "./paint";
import { HORIZON_Y } from "./water";

const mix = (start: Rgb, end: Rgb, amount: number): Rgb => [
  Math.round(start[0] + (end[0] - start[0]) * amount),
  Math.round(start[1] + (end[1] - start[1]) * amount),
  Math.round(start[2] + (end[2] - start[2]) * amount),
];

// --- stages: the night, then the dawn in steps ----------------------------------------------------------------

const DAWN_STAGES = 10;
// 0 all night; 1 to DAWN_STAGES over the last fifth of the night, when nightTint warms
function skyStage(progress: number): number {
  if (progress < 0.8) return 0;
  return Math.min(DAWN_STAGES, 1 + Math.floor(((progress - 0.8) / 0.2) * DAWN_STAGES));
}
const dawnAmount = (stage: number) => stage / DAWN_STAGES;

// five bands, top to horizon, for the night, the dawn's peak and the morning; a stage mixes them as nightTint does
const NIGHT_BANDS = [0x060a1d, 0x091028, 0x0d1633, 0x121e3f, 0x1a284c].map(hexRgb);
const DAWN_BANDS = [0x1d1a45, 0x3b2a5c, 0x6b3d66, 0xa9566a, 0xe48e64].map(hexRgb);
const MORNING_BANDS = [0x6a9ad0, 0x86b0da, 0xa6c6e2, 0xc6dbe6, 0xf2e2b8].map(hexRgb);
const BAND_TOPS = [0, 24, 44, 60, 74]; // the rows where each band starts; the last runs to the horizon

function bandsFor(stage: number): Rgb[] {
  const amount = dawnAmount(stage);
  return NIGHT_BANDS.map((night, index) => {
    const dawn = DAWN_BANDS[index] ?? night;
    const morning = MORNING_BANDS[index] ?? night;
    return amount < 0.6 ? mix(night, dawn, amount / 0.6) : mix(dawn, morning, (amount - 0.6) / 0.4);
  });
}
// the band a row falls in, its boundaries dithered over four rows
function bandAt(x: number, y: number): number {
  const jittered = y + Math.round((bayerThreshold(x, y) - 0.5) * 4);
  let band = 0;
  BAND_TOPS.forEach((top, index) => {
    if (jittered >= top) band = index;
  });
  return band;
}

// --- the stars, the moon and the land on the horizon ----------------------------------------------------------

const STAR_LEVELS = [0x46527e, 0x9aa2c8, 0xeef0ff].map(hexRgb); // dim, mid, bright
interface Star {
  x: number;
  y: number;
  level: number; // 1 to 3
}
const STARS: readonly Star[] = (() => {
  const random = seededRandom(0x57a2);
  return Array.from({ length: 110 }, () => {
    const x = Math.floor(random() * STAGE_WIDTH);
    // thinner towards the horizon, where the haze is
    const y = 2 + Math.floor(random() ** 1.5 * (HORIZON_Y - 14));
    const roll = random();
    return { x, y, level: roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3 };
  });
})();
// stars dim a level, then go, as the dawn comes
const starLevelAt = (star: Star, stage: number) => star.level - Math.floor(dawnAmount(stage) * 4);

const MOON = { x: 660, y: 54, radius: 7, shadowShift: 4 };
const MOON_LIT = hexRgb(0xf2eed6);
const MOON_EDGE = hexRgb(0xc8c4ae);

// The land, as heights above the horizon between control points; the far island is hazier than the headland.
const HEADLAND: readonly (readonly [number, number])[] = [
  [-2, 14],
  [24, 16],
  [52, 13],
  [80, 11],
  [92, 10],
  [104, 10],
  [124, 7],
  [150, 6],
  [176, 5],
  [198, 2],
  [216, 0],
];
// the far islands sit between the HUD's bars, so they still show in the phones' cropped views
const FAR_ISLANDS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [292, 0],
    [306, 3],
    [326, 5],
    [346, 6],
    [366, 5],
    [384, 2],
    [398, 0],
  ],
  [
    [716, 0],
    [736, 2],
    [760, 3],
    [786, 2],
    [804, 0],
  ],
];
const RIGHT_ROCKS: readonly (readonly [number, number])[] = [
  [858, 0],
  [880, 4],
  [904, 6],
  [930, 9],
  [962, 11],
];
function heightAlong(points: readonly (readonly [number, number])[], x: number): number {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end || x < start[0] || x > end[0]) continue;
    const along = (x - start[0]) / (end[0] - start[0]);
    const height = Math.round(start[1] + (end[1] - start[1]) * along);
    // a rocky edge: a pixel higher in places
    return height > 1 && hashUnit(x >> 1, 31) < 0.2 ? height + 1 : height;
  }
  return 0;
}

// a lighthouse on the headland and a small temple on the far island, as rows of [left, right] offsets from their base
const LIGHTHOUSE = { x: 98 }; // on the headland's top, clear of the HUD's bars on a phone
const LIGHTHOUSE_ROWS: readonly (readonly [number, number])[] = [
  [-2, 2],
  [-2, 1],
  [-1, 1],
  [-1, 1],
  [-1, 1],
  [-1, 1],
  [-1, 1],
  [-1, 1],
  [-2, 2], // gallery
  [-1, 1], // lamp room
  [-1, 1],
  [0, 0], // roof
];
const TEMPLE = { x: 346 };
const TEMPLE_ROWS: readonly string[] = [
  "#############", // stylobate
  "#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#",
  "#############", // entablature
  ".###########.",
  "...#######...",
  ".....###.....",
];

const lighthouseBase = () => HORIZON_Y - heightAlong(HEADLAND, LIGHTHOUSE.x);
// where the lighthouse's lamp burns, for its blinking sprite
export const LIGHTHOUSE_LAMP = { x: LIGHTHOUSE.x, y: lighthouseBase() - LIGHTHOUSE_ROWS.length + 2 };

// --- painting a stage ------------------------------------------------------------------------------------------

function paintSky(stage: number): Texture {
  const width = STAGE_WIDTH;
  const height = HORIZON_Y;
  const pixels = new Uint8Array(width * height * 4);
  const bands = bandsFor(stage);
  const horizonBand = bands[bands.length - 1] ?? [0, 0, 0];
  const plot = (x: number, y: number, colour: Rgb) => {
    if (x >= 0 && x < width && y >= 0 && y < height) putPixel(pixels, width, x, y, colour);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) plot(x, y, bands[bandAt(x, y)] ?? horizonBand);

  // stars
  for (const star of STARS) {
    const level = starLevelAt(star, stage);
    const colour = STAR_LEVELS[level - 1];
    if (!colour) continue;
    plot(star.x, star.y, colour);
    const dim = STAR_LEVELS[level - 2];
    if (level === 3 && dim && star.x % 3 === 0) {
      plot(star.x - 1, star.y, dim);
      plot(star.x + 1, star.y, dim);
      plot(star.x, star.y - 1, dim);
      plot(star.x, star.y + 1, dim);
    }
  }

  // the moon: a crescent lit from the right, its dark side a shade over the sky, and a dithered halo
  const amount = dawnAmount(stage);
  const skyAtMoon = bands[bandAt(MOON.x, MOON.y)] ?? horizonBand;
  const lit = mix(MOON_LIT, skyAtMoon, amount * 0.6);
  const edge = mix(MOON_EDGE, skyAtMoon, amount * 0.6);
  const earthshine = mix(skyAtMoon, MOON_EDGE, 0.12);
  const halo = mix(skyAtMoon, MOON_EDGE, 0.2 * (1 - amount));
  const reach = MOON.radius + 4;
  for (let y = MOON.y - reach; y <= MOON.y + reach; y++)
    for (let x = MOON.x - reach; x <= MOON.x + reach; x++) {
      const distance = Math.hypot(x + 0.5 - MOON.x, y + 0.5 - MOON.y);
      if (distance > MOON.radius) {
        if (distance <= MOON.radius + 3 && bayerThreshold(x, y) < (MOON.radius + 3.5 - distance) / 4) plot(x, y, halo);
        continue;
      }
      const shadowed = Math.hypot(x + 0.5 - (MOON.x - MOON.shadowShift), y + 0.5 - (MOON.y - 1)) <= MOON.radius;
      if (shadowed) plot(x, y, earthshine);
      else plot(x, y, distance > MOON.radius - 1.2 ? edge : lit);
    }

  // the land: the headland nearer and darker, the far island and the rocks hazier
  const near = mix(horizonBand, hexRgb(0x02040c), 0.72 - 0.22 * amount);
  const far = mix(horizonBand, hexRgb(0x02040c), 0.45 - 0.15 * amount);
  for (let x = 0; x < width; x++) {
    const headland = heightAlong(HEADLAND, x);
    const rocks = heightAlong(RIGHT_ROCKS, x);
    const island = Math.max(...FAR_ISLANDS.map((points) => heightAlong(points, x)));
    for (let rise = 1; rise <= Math.max(headland, rocks); rise++) plot(x, HORIZON_Y - rise, near);
    for (let rise = 1; rise <= island; rise++) plot(x, HORIZON_Y - rise, far);
  }
  const lighthouseFoot = lighthouseBase();
  LIGHTHOUSE_ROWS.forEach(([left, right], index) => {
    for (let offset = left; offset <= right; offset++) plot(LIGHTHOUSE.x + offset, lighthouseFoot - index, near);
  });
  const templeFoot = HORIZON_Y - Math.max(...FAR_ISLANDS.map((points) => heightAlong(points, TEMPLE.x)));
  TEMPLE_ROWS.forEach((row, index) => {
    [...row].forEach((cell, offset) => {
      if (cell === "#") plot(TEMPLE.x - 6 + offset, templeFoot - index, far);
    });
  });
  return bufferTexture(pixels, width, height);
}

const skies = new Map<number, Texture>();
// the sky for a night's progress, painted the first time its stage is reached
export function skyTexture(progress: number): Texture {
  const stage = skyStage(progress);
  let texture = skies.get(stage);
  if (!texture) {
    texture = paintSky(stage);
    skies.set(stage, texture);
  }
  return texture;
}

// --- what moves: twinkling stars, the lighthouse's lamp, the moon's path on the water -------------------------

// a small shape from character rows, centred on its middle pixel; each character is a colour
interface SkyPiece {
  texture: Texture;
  offsetX: number;
  offsetY: number;
}
function patternPiece(rows: readonly string[], inks: Partial<Record<string, Rgb>>): SkyPiece {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const pixels = new Uint8Array(width * height * 4);
  rows.forEach((row, rowIndex) => {
    [...row].forEach((character, column) => {
      const ink = inks[character];
      if (ink) putPixel(pixels, width, column, rowIndex, ink);
    });
  });
  return {
    texture: bufferTexture(pixels, width, height),
    offsetX: -Math.floor((width - 1) / 2),
    offsetY: -Math.floor((height - 1) / 2),
  };
}

const STAR_INK: Partial<Record<string, Rgb>> = { a: STAR_LEVELS[0], b: STAR_LEVELS[1], c: STAR_LEVELS[2] };
const TWINKLE_PATTERNS = {
  dim: ["a"],
  speck: ["b"],
  bright: ["c"],
  plus: [".a.", "aca", ".a."],
  star: ["..a..", "..b..", "abcba", "..b..", "..a.."],
} satisfies Record<string, readonly string[]>;
type TwinkleShape = keyof typeof TWINKLE_PATTERNS;
const TWINKLE_FPS = 6;
const TWINKLE_SEQUENCE: readonly TwinkleShape[] = [
  "speck",
  "speck",
  "bright",
  "plus",
  "star",
  "plus",
  "bright",
  "speck",
  "speck",
  "dim",
  "dim",
  "speck",
];

interface Twinkle {
  x: number;
  y: number;
  phase: number;
}
export const TWINKLES: readonly Twinkle[] = (() => {
  const random = seededRandom(0x7a1c);
  return Array.from({ length: 9 }, (_, index) => ({
    x: Math.floor(((index + 0.2 + random() * 0.6) / 9) * STAGE_WIDTH),
    y: 6 + Math.floor(random() * (HORIZON_Y - 30)),
    phase: Math.floor(random() * TWINKLE_SEQUENCE.length),
  })).filter((twinkle) => Math.abs(twinkle.x - MOON.x) > 16 || Math.abs(twinkle.y - MOON.y) > 16); // not over the moon
})();
// a twinkling star's shape now, or nothing once the dawn has put the stars out
export function twinkleFrame(twinkle: Twinkle, clock: number, progress: number): SkyPiece | null {
  if (dawnAmount(skyStage(progress)) >= 0.5) return null;
  const shape =
    TWINKLE_SEQUENCE[(Math.floor(clock * TWINKLE_FPS) + twinkle.phase) % TWINKLE_SEQUENCE.length] ?? "speck";
  return skyPieces().twinkles[shape];
}

// the lighthouse's lamp: a warm point that flares into a short beam once every couple of seconds, out by morning
const LAMP_INK: Partial<Record<string, Rgb>> = { o: hexRgb(0x8a5a24), w: hexRgb(0xffc864), y: hexRgb(0xfff2c8) };
const LAMP_PATTERNS = {
  glow: ["o"],
  lit: ["w"],
  flare: [".o.", "owo", ".o."],
  beam: ["ooowyyywooo"],
} satisfies Record<string, readonly string[]>;
const LAMP_SEQUENCE: readonly (keyof typeof LAMP_PATTERNS)[] = [
  "glow",
  "glow",
  "glow",
  "glow",
  "glow",
  "glow",
  "lit",
  "flare",
  "beam",
  "flare",
  "lit",
  "glow",
];
const LAMP_FPS = 5;
export function lighthouseFrame(clock: number, progress: number): SkyPiece | null {
  if (dawnAmount(skyStage(progress)) >= 0.8) return null;
  return skyPieces().lamp[LAMP_SEQUENCE[Math.floor(clock * LAMP_FPS) % LAMP_SEQUENCE.length] ?? "glow"];
}

// The moon's path on the far sea, drawn additively with the lamps' light: short level streaks under the moon,
// widening towards the viewer, broken and shifting a pixel at a time.
const GLITTER_FRAMES = 8;
const GLITTER_FPS = 6;
const GLITTER_WIDTH = 41;
const GLITTER_HEIGHT = 34;
export const MOON_GLITTER = { x: MOON.x - (GLITTER_WIDTH - 1) / 2, y: HORIZON_Y + 1 };
const GLITTER_DIM = hexRgb(0x1c2032);
const GLITTER_BRIGHT = hexRgb(0x4a5068);
function paintGlitter(frame: number): Texture {
  const pixels = new Uint8Array(GLITTER_WIDTH * GLITTER_HEIGHT * 4);
  for (let row = 1; row < GLITTER_HEIGHT; row += 2) {
    const halfWidth = 3 + (row / GLITTER_HEIGHT) * 17;
    for (let streak = 0; streak < 2; streak++) {
      const roll = hashUnit(row * 7 + streak, frame);
      if (roll < 0.25) continue;
      const length = 2 + Math.floor(hashUnit(row, frame * 3 + streak) * (2 + row / 6));
      const centre = Math.round((GLITTER_WIDTH - 1) / 2 + (hashUnit(row + streak * 31, frame * 5) * 2 - 1) * halfWidth);
      for (let step = 0; step < length; step++) {
        const x = centre - Math.floor(length / 2) + step;
        if (x < 0 || x >= GLITTER_WIDTH) continue;
        putPixel(pixels, GLITTER_WIDTH, x, row, step === 0 || step === length - 1 ? GLITTER_DIM : GLITTER_BRIGHT);
      }
    }
  }
  return bufferTexture(pixels, GLITTER_WIDTH, GLITTER_HEIGHT);
}
export const moonGlitterFrame = (clock: number) =>
  skyPieces().glitter[Math.floor(clock * GLITTER_FPS) % GLITTER_FRAMES] ?? null;

// the moving pieces, painted the first time any is asked for
interface SkyPieces {
  twinkles: Record<TwinkleShape, SkyPiece>;
  lamp: Record<keyof typeof LAMP_PATTERNS, SkyPiece>;
  glitter: readonly Texture[];
}
let pieces: SkyPieces | null = null;
function skyPieces(): SkyPieces {
  pieces ??= {
    twinkles: {
      dim: patternPiece(TWINKLE_PATTERNS.dim, STAR_INK),
      speck: patternPiece(TWINKLE_PATTERNS.speck, STAR_INK),
      bright: patternPiece(TWINKLE_PATTERNS.bright, STAR_INK),
      plus: patternPiece(TWINKLE_PATTERNS.plus, STAR_INK),
      star: patternPiece(TWINKLE_PATTERNS.star, STAR_INK),
    },
    lamp: {
      glow: patternPiece(LAMP_PATTERNS.glow, LAMP_INK),
      lit: patternPiece(LAMP_PATTERNS.lit, LAMP_INK),
      flare: patternPiece(LAMP_PATTERNS.flare, LAMP_INK),
      beam: patternPiece(LAMP_PATTERNS.beam, LAMP_INK),
    },
    glitter: Array.from({ length: GLITTER_FRAMES }, (_, frame) => paintGlitter(frame)),
  };
  return pieces;
}
