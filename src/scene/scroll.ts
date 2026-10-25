// The title scroll as pixel art, painted at 1x into RGBA pixel buffers and shown at whole multiples: a parchment sheet
// with a dithered, uneven edge, mottling, tea stains and fibres, and two wooden rollers with bronze knobs, outlined like
// the sprites. Every pixel comes from a seeded hash, so the same size always paints the same scroll.

type Colour = readonly [number, number, number];

function hex(code: string): Colour {
  const value = Number.parseInt(code.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const OUTLINE = hex("#1b1410"); // the sprites' outline
// parchment tones from lightest to the burnt rim; a pixel's tone is an index into this list
const PARCHMENT_TONES: readonly Colour[] = [
  hex("#f6e8c3"),
  hex("#ead5a3"),
  hex("#dcc089"),
  hex("#c7a46c"),
  hex("#a07646"),
  hex("#6b4422"),
];
const FIBRE_DARK = hex("#cfb07a");
const FIBRE_LIGHT = hex("#f8edcd");
const WOOD: readonly Colour[] = [
  hex("#efc07e"), // highlight
  hex("#d0904f"),
  hex("#b0723c"),
  hex("#8c5530"),
  hex("#683c1f"),
  hex("#4a2814"), // the underside
];
const BRONZE: Record<string, Colour> = {
  W: hex("#fff6d8"),
  G: hex("#f2c14e"),
  B: hex("#c8913a"),
  b: hex("#7d5422"),
  K: OUTLINE,
};

// how far the roller reaches beyond the parchment on each side (knob, collar and a little rod), in art pixels
export const ROLLER_OVERHANG = 12;
// the roller's own rows, plus the rows of shadow it casts onto the parchment
export const ROLLER_HEIGHT = 12;
export const ROLLER_SHADOW = 2;

// a bronze finial and collar at the left end of a roller; the right end is its mirror. '.' leaves the pixel alone.
const KNOB = [
  ".KKKK.....",
  "KWGGBK.KK.",
  "KGWGBbKGBK",
  "KGGBBbKGBK",
  "KGBBBbKBbK",
  "KBBBBbKBbK",
  "KBBBbbKBbK",
  "KBBbbbKbbK",
  "KbBbbbKbbK",
  "KbbbbbKbbK",
  "KbbbbK.KK.",
  ".KKKK.....",
];
const KNOB_WIDTH = 10;

// 4x4 ordered-dither thresholds in (0, 1)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const threshold = (x: number, y: number) => ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16;

// a stable pseudo-random number in [0, 1) for a lattice point
function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}
const ease = (fraction: number) => fraction * fraction * (3 - 2 * fraction);
// smooth value noise in [0, 1), one and two dimensional
function noise(position: number, seed: number): number {
  const cell = Math.floor(position);
  const blend = ease(position - cell);
  return hash(cell, 0, seed) * (1 - blend) + hash(cell + 1, 0, seed) * blend;
}
function noise2(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const blendX = ease(x - cellX);
  const blendY = ease(y - cellY);
  const top = hash(cellX, cellY, seed) * (1 - blendX) + hash(cellX + 1, cellY, seed) * blendX;
  const bottom = hash(cellX, cellY + 1, seed) * (1 - blendX) + hash(cellX + 1, cellY + 1, seed) * blendX;
  return top * (1 - blendY) + bottom * blendY;
}

function put(pixels: Uint8ClampedArray, width: number, x: number, y: number, colour: Colour, alpha = 255) {
  const offset = (y * width + x) * 4;
  pixels[offset] = colour[0];
  pixels[offset + 1] = colour[1];
  pixels[offset + 2] = colour[2];
  pixels[offset + 3] = alpha;
}

// how many pixels the torn edge sits in from the sheet's side on one row: 0 to 3, wandering slowly with a few nicks
function edgeInset(row: number, seed: number): number {
  const wander = noise(row / 9, seed) * 2.2 + noise(row / 3.3, seed + 7) * 0.9;
  const nick = hash(row >> 1, 3, seed) < 0.06 ? 1 : 0;
  return Math.min(3, Math.max(0, Math.round(wander + nick)));
}

interface Stain {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}

// Paints a parchment sheet into `pixels` (RGBA, width x height). Outside the torn edge stays transparent.
export function paintParchment(pixels: Uint8ClampedArray, width: number, height: number) {
  pixels.fill(0);
  const stainCount = Math.max(3, Math.round((width * height) / 7000));
  const stains: Stain[] = Array.from({ length: stainCount }, (_, index) => ({
    x: 14 + hash(index, 1, 31) * (width - 28),
    y: 10 + hash(index, 2, 31) * Math.max(1, height - 20),
    radiusX: 5 + hash(index, 3, 31) * 9,
    radiusY: 3 + hash(index, 4, 31) * 6,
  }));
  const tones: number[] = new Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) {
    const left = edgeInset(y, 11);
    const right = width - 1 - edgeInset(y, 23);
    for (let x = left; x <= right; x++) {
      const fromEdge = Math.min(x - left, right - x);
      if (fromEdge === 0) {
        tones[y * width + x] = 5;
        continue;
      }
      // mottling, darkening towards the edge, stains with a darker tide-mark ring
      let tone = 1.15 + (noise2(x / 21, y / 14, 5) - 0.5) * 1.3 + (noise2(x / 6, y / 5, 9) - 0.5) * 0.45;
      tone += Math.max(0, 1 - (fromEdge - 1) / 7) * 2.6;
      for (const stain of stains) {
        const wobble = (noise(Math.atan2(y - stain.y, x - stain.x) * 2.2 + stain.x, 41) - 0.5) * 0.3;
        const reach = Math.hypot((x - stain.x) / stain.radiusX, (y - stain.y) / stain.radiusY) + wobble;
        if (reach < 0.85) {
          tone += 0.55;
        } else if (reach < 1.05) {
          tone += 1.25;
        }
      }
      tones[y * width + x] = Math.min(4, Math.max(0, Math.floor(tone + threshold(x, y) - 0.5)));
    }
  }
  for (let index = 0; index < tones.length; index++) {
    const tone = tones[index] ?? -1;
    const colour = PARCHMENT_TONES[tone];
    if (colour) {
      put(pixels, width, index % width, Math.floor(index / width), colour);
    }
  }
  // fibres: short strokes laid along the sheet, on its plain middle only
  const fibreCount = Math.round((width * height) / 450);
  for (let index = 0; index < fibreCount; index++) {
    let x = Math.floor(hash(index, 5, 77) * width);
    let y = Math.floor(hash(index, 6, 77) * height);
    const length = 3 + Math.floor(hash(index, 7, 77) * 6);
    const colour = hash(index, 8, 77) < 0.65 ? FIBRE_DARK : FIBRE_LIGHT;
    const slope = hash(index, 9, 77) < 0.5 ? 1 : -1;
    for (let step = 0; step < length; step++) {
      if (x >= 0 && x < width && y >= 0 && y < height && (tones[y * width + x] ?? -1) === 1) {
        put(pixels, width, x, y, colour);
      }
      x++;
      if (hash(index, step, 78) < 0.25) {
        y += slope;
      }
    }
  }
}

// Paints one roller (width x ROLLER_HEIGHT + ROLLER_SHADOW). `turn` is how far the roller has turned, in pixels of its
// surface: the wood grain moves down the rod with it. `shadowBelow` puts the cast shadow under the roller (the top one)
// rather than over it (the bottom one).
export function paintRoller(pixels: Uint8ClampedArray, width: number, turn: number, shadowBelow: boolean) {
  pixels.fill(0);
  const top = shadowBelow ? 0 : ROLLER_SHADOW;
  const shadowTop = shadowBelow ? ROLLER_HEIGHT : 0;
  // the shadow on the parchment: a dark, dithered fade away from the roller
  for (let row = 0; row < ROLLER_SHADOW; row++) {
    const nearness = shadowBelow ? row : ROLLER_SHADOW - 1 - row;
    for (let x = ROLLER_OVERHANG + 3; x < width - ROLLER_OVERHANG - 3; x++) {
      if (nearness === 0 || threshold(x, row) < 0.5) {
        put(pixels, width, x, shadowTop + row, OUTLINE, 70);
      }
    }
  }
  // the rod: outline, six rows of shaded wood, outline; grain streaks travel down the face as it turns
  const rodLeft = KNOB_WIDTH;
  const rodRight = width - 1 - KNOB_WIDTH;
  const surfaceRows = 14;
  for (let x = rodLeft; x <= rodRight; x++) {
    put(pixels, width, x, top + 2, OUTLINE);
    put(pixels, width, x, top + 9, OUTLINE);
    for (let face = 0; face < 6; face++) {
      const surface = (((face - Math.floor(turn)) % surfaceRows) + surfaceRows) % surfaceRows;
      const streak = hash(Math.floor((x + surface * 5) / 6), surface, 61) < 0.3 && hash(x, surface, 62) < 0.85;
      const shade = Math.min(WOOD.length - 1, face + (streak ? 1 : 0));
      put(pixels, width, x, top + 3 + face, WOOD[shade] ?? OUTLINE);
    }
  }
  // the knobs, the right one mirrored
  for (const [row, line] of KNOB.entries()) {
    for (const [column, symbol] of [...line].entries()) {
      const colour = BRONZE[symbol];
      if (!colour) {
        continue;
      }
      put(pixels, width, column, top + row, colour);
      put(pixels, width, width - 1 - column, top + row, colour);
    }
  }
}
