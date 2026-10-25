// The sea as pixel art, from the horizon down: a still base of stepped depths, darkening towards the horizon, a far sea
// of flat glints, an open swell of short 2:1 crests and sparkles that tiles over the rest, surf along the plaza's cliffs
// and ripples around the boats. Everything is painted here pixel by pixel, once, into a WATER_FRAMES-long loop; a frame
// only picks textures from the scene clock (frozen by the visual verifier, so its frames are deterministic). The night
// tint multiplies over all of it, as over the rest of the ground; the sky above the horizon is in sky.ts.

import { Rectangle, Texture } from "pixi.js";

import { CENTRE_Y, STAGE_HEIGHT, STAGE_WIDTH } from "../game/sim";
import { band } from "../lib/band";
import type { Ripple } from "./decor";
import { bayerThreshold, bufferTexture, hashUnit, hexRgb, putPixel, type Rgb, seededRandom } from "./paint";
import { shoreDistance } from "./plaza";

// navy to teal, deepest first, and the surf
const DEEP = hexRgb(0x0f3156);
const OPEN = hexRgb(0x16476f);
export const SEA_COLOUR = 0x1e5f8a; // the open sea, the commonest tone
const SEA = hexRgb(SEA_COLOUR);
const SHALLOW = hexRgb(0x2c7f9c);
const CREST = hexRgb(0x68c0d0);
const FOAM = hexRgb(0xeafcf6);
const TONES: readonly Rgb[] = [DEEP, OPEN, SEA, SHALLOW];

export const HORIZON_Y = 88; // the first row of sea; the sky is above it
const FAR_SEA_END = HORIZON_Y + 40; // the flat far sea gives way to the open swell here

const WATER_FRAMES = 12;
const WATER_FPS = 8;
export const waterFrame = (clock: number) => Math.floor(clock * WATER_FPS) % WATER_FRAMES;

// --- the still base: stepped depth with dithered seams -------------------------------------------------------

// a continuous depth tone (3 shallow to 0 deep) for a sea pixel; its whole part picks the colour
function depthTone(x: number, y: number): number {
  const distance = shoreDistance(x + 0.5, y + 0.5);
  const shelf = 3.45 - distance / 16; // the pale shelf under the cliffs, gone a few pixels out
  const open = 2.45 - Math.max(0, distance - 60) / 30; // open sea, deepening away from the plaza
  const far = 0.45 + (y - HORIZON_Y) / 16; // and darkest towards the horizon
  return Math.max(0.2, Math.min(3.45, Math.max(shelf, open), far));
}

// the base from the horizon down, placed at y = HORIZON_Y; its first row is a lighter line where the sea meets the sky
function paintBase(): Texture {
  const height = STAGE_HEIGHT - HORIZON_Y;
  const pixels = new Uint8Array(STAGE_WIDTH * height * 4);
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < STAGE_WIDTH; x++) {
      const y = HORIZON_Y + row;
      const tone = row === 0 ? 1 : Math.floor(depthTone(x, y) + (bayerThreshold(x, y) - 0.5) * 0.6);
      putPixel(pixels, STAGE_WIDTH, x, row, TONES[Math.max(0, Math.min(TONES.length - 1, tone))] ?? SEA);
    }
  }
  return bufferTexture(pixels, STAGE_WIDTH, height);
}

// --- the open swell: a tile of crests and sparkles that grow, peak and fade in turn ----------------------------

const SWELL_WIDTH = 256;
const SWELL_HEIGHT = 128;
// how much of a crest shows at each age of the loop
const CREST_GROWTH = [0, 0.3, 0.6, 0.85, 1, 1, 1, 1, 0.85, 0.6, 0.3, 0];

interface Feature {
  x: number;
  y: number;
  size: number;
  phase: number;
}

// features spread over a wrapping area, none closer than `spacing` (iso steps) to another
function scatter(count: number, width: number, height: number, spacing: number, seed: number): Feature[] {
  const random = seededRandom(seed);
  const features: Feature[] = [];
  for (let attempt = 0; attempt < count * 40 && features.length < count; attempt++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const clear = features.every((feature) => {
      const across = Math.min(Math.abs(feature.x - x), width - Math.abs(feature.x - x));
      const down = Math.min(Math.abs(feature.y - y), height - Math.abs(feature.y - y));
      return across / 2 + down >= spacing;
    });
    if (clear) {
      features.push({ x, y, size: random(), phase: Math.floor(random() * WATER_FRAMES) });
    }
  }
  return features;
}

const SWELL_CRESTS = scatter(44, SWELL_WIDTH, SWELL_HEIGHT, 11, 0x5ea);
const SWELL_SPARKLES = scatter(14, SWELL_WIDTH, SWELL_HEIGHT, 16, 0x5b1);

// A crest is a low 2:1 peak, a longer arm rising to the right and a shorter one falling away: a teal lip that flashes
// white at its peak, with the wave's lit face under it. It creeps right a pixel every few frames as it grows and fades.
function paintCrest(
  plot: (x: number, y: number, colour: Rgb) => void,
  crest: Feature,
  frame: number,
  maximumLength: number,
) {
  const age = (frame + crest.phase) % WATER_FRAMES;
  const length = Math.round(maximumLength * (CREST_GROWTH[age] ?? 0));
  if (length === 0) {
    return;
  }
  const peak = Math.floor((length * 2) / 3);
  const start = crest.x + Math.floor(age / 4) - peak;
  const peaking = length === maximumLength && age >= 5 && age <= 6;
  for (let step = 0; step < length; step++) {
    const x = start + step;
    const rise = step <= peak ? Math.floor(step / 2) : Math.floor(peak / 2) - Math.ceil((step - peak) / 2);
    const y = crest.y - rise;
    const tip = step === 0 || step === length - 1;
    const body = peaking && Math.abs(step - peak) <= 1 ? FOAM : CREST;
    plot(x, y, tip ? SHALLOW : body);
    if (!tip) {
      plot(x, y + 1, SHALLOW);
    }
  }
}

// a sparkle: a speck, a small star, a speck, then dark for the rest of the loop
function paintSparkle(plot: (x: number, y: number, colour: Rgb) => void, sparkle: Feature, frame: number) {
  const age = (frame + sparkle.phase) % WATER_FRAMES;
  if (age === 0 || age === 2) {
    plot(sparkle.x, sparkle.y, CREST);
  }
  if (age === 1) {
    plot(sparkle.x, sparkle.y, FOAM);
    for (const [across, down] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      plot(sparkle.x + across, sparkle.y + down, CREST);
    }
  }
}

function paintSwell(frame: number): Texture {
  const pixels = new Uint8Array(SWELL_WIDTH * SWELL_HEIGHT * 4);
  // wraps at the tile's edges, so the tile repeats seamlessly
  const plot = (x: number, y: number, colour: Rgb) =>
    putPixel(
      pixels,
      SWELL_WIDTH,
      ((x % SWELL_WIDTH) + SWELL_WIDTH) % SWELL_WIDTH,
      ((y % SWELL_HEIGHT) + SWELL_HEIGHT) % SWELL_HEIGHT,
      colour,
    );
  for (const crest of SWELL_CRESTS) {
    paintCrest(plot, crest, frame, 6 + 2 * Math.floor(crest.size * 5));
  }
  for (const sparkle of SWELL_SPARKLES) {
    paintSparkle(plot, sparkle, frame);
  }
  return bufferTexture(pixels, SWELL_WIDTH, SWELL_HEIGHT, "repeat");
}

// --- the far sea: flat glints, shorter and dimmer towards the horizon, and a shimmer along it -------------------

const FAR_GLINTS = scatter(70, STAGE_WIDTH, FAR_SEA_END - HORIZON_Y - 2, 5, 0xfa5).map((glint) => ({
  ...glint,
  // fewer near the horizon
  y: HORIZON_Y + 2 + Math.floor(Math.sqrt(glint.y / (FAR_SEA_END - HORIZON_Y - 2)) * (FAR_SEA_END - HORIZON_Y - 2)),
}));

function paintFarSea(plot: (x: number, y: number, colour: Rgb) => void, frame: number) {
  for (const glint of FAR_GLINTS) {
    const age = (frame + glint.phase) % WATER_FRAMES;
    const depth = (glint.y - HORIZON_Y) / (FAR_SEA_END - HORIZON_Y);
    const length = Math.round((2 + 5 * depth * (0.6 + 0.4 * glint.size)) * (CREST_GROWTH[age] ?? 0));
    const near = age >= 5 && age <= 6 ? CREST : SHALLOW;
    const colour = band(
      depth,
      [
        [0.3, OPEN],
        [0.65, SEA],
      ],
      near,
    );
    const start = glint.x + Math.floor(age / 4) - Math.floor(length / 2);
    for (let step = 0; step < length; step++) {
      plot(start + step, glint.y, colour);
    }
  }
  // the horizon row: short lighter dashes that come and go
  for (let x = 0; x < STAGE_WIDTH; x += 4) {
    if (hashUnit(x, Math.floor(frame / 3)) < 0.18) {
      plot(x, HORIZON_Y, SEA);
      plot(x + 1, HORIZON_Y, SEA);
    }
  }
}

// The swell drifts slowly down the 2:1 grid, a whole pixel at a time; the tile repeats, so it never jumps.
export const swellDrift = (clock: number) => ({ x: Math.floor(clock * 4), y: Math.floor(clock * 2) });

// --- surf along the plaza: a band of foam lapping at the cliffs, a looser line of swash beyond it --------------

const SURF_REACH = 9; // iso steps from the stone that the surf can reach
const SURF_WAVELENGTH = 96; // pixels along the shore between two lapping crests

// the front shore, under the side walls: in and out by a pixel or two around a two-pixel band, dithered at its edge,
// and a line of swash beyond it
function frontSurfPixel(x: number, y: number, distance: number, turn: number, lap: number): Rgb | null {
  const reach = 3.2 + 1.6 * lap;
  if (distance < reach - 1) {
    return FOAM;
  }
  if (distance < reach) {
    return bayerThreshold(x, y) < 0.55 ? FOAM : CREST;
  }
  if (distance < reach + 1) {
    return bayerThreshold(x, y) < 0.2 ? CREST : null;
  }
  const swash = reach + 2.6 + Math.sin(turn + Math.PI + (2 * Math.PI * x) / 61);
  if (Math.abs(distance - swash) < 0.5 && hashUnit(x >> 2, 7) > 0.2) {
    return lap > 0.4 ? FOAM : CREST;
  }
  return null;
}

function surfPixel(x: number, y: number, frame: number): Rgb | null {
  const distance = shoreDistance(x + 0.5, y + 0.5);
  if (distance < -1 || distance > SURF_REACH) {
    return null;
  }
  const turn = (2 * Math.PI * frame) / WATER_FRAMES;
  const lap = Math.sin(turn - (2 * Math.PI * x) / SURF_WAVELENGTH);
  if (y >= CENTRE_Y) {
    return frontSurfPixel(x, y, distance, turn, lap);
  }
  // the back edges: a thin line, broken and rejoining as the water laps
  if (distance < 1.6) {
    if (hashUnit(x >> 2, frame >> 2) <= 0.15) {
      return null;
    }
    return lap > -0.2 ? FOAM : CREST;
  }
  if (distance < 2.6 && lap > 0.3) {
    return bayerThreshold(x, y) < 0.5 ? CREST : null;
  }
  return null;
}

// --- ripples around what floats: rings that spread from the boats and the dock's posts (placed with them, decor.ts) ---

// Two rings per ripple, half a loop apart, each spreading and fading: teal while fresh, then the shelf's tone, then
// gone. Broken into dashes that turn a little as the ring spreads.
function paintRipples(ripples: readonly Ripple[], plot: (x: number, y: number, colour: Rgb) => void, frame: number) {
  for (const ripple of ripples) {
    for (let ring = 0; ring < 2; ring++) {
      const age = (frame + ripple.phase + ring * (WATER_FRAMES / 2)) % WATER_FRAMES;
      if (age >= WATER_FRAMES - 2) {
        continue;
      }
      const scale = 1 + (ripple.growth * age) / WATER_FRAMES;
      const radiusX = ripple.radiusX * scale;
      const radiusY = ripple.radiusY * scale;
      const colour = band(
        age,
        [
          [4, FOAM],
          [8, CREST],
        ],
        SHALLOW,
      );
      paintRing(ripple, plot, { radiusX, radiusY, age, colour });
    }
  }
}

// one ring of a ripple, in dashes, without its back (under the hull)
function paintRing(
  ripple: Ripple,
  plot: (x: number, y: number, colour: Rgb) => void,
  ring: { radiusX: number; radiusY: number; age: number; colour: Rgb },
) {
  const samples = Math.ceil(ring.radiusX * 8);
  for (let sample = 0; sample < samples; sample++) {
    const turn = sample / samples;
    const angle = 2 * Math.PI * turn;
    const back = Math.sin(angle) < -0.3;
    const gap = Math.floor(turn * ripple.dashes * 2 + ring.age / 4) % 2 === 1;
    if (!(back || gap)) {
      plot(
        Math.round(ripple.x + Math.cos(angle) * ring.radiusX),
        Math.round(ripple.y + Math.sin(angle) * ring.radiusY),
        ring.colour,
      );
    }
  }
}
const nearRipple = (ripples: readonly Ripple[], x: number, y: number) =>
  ripples.some(
    (ripple) =>
      Math.abs(x - ripple.x) <= ripple.radiusX * (1 + ripple.growth) + 1 &&
      Math.abs(y - ripple.y) <= ripple.radiusY * (1 + ripple.growth) + 1,
  );

// --- animated patches: only the parts of the canvas that move, cut into tiles and packed per frame ------------

const PATCH_WIDTH = 64;
const PATCH_HEIGHT = 32;
const ATLAS_COLUMNS = 8;

interface WaterPatch {
  x: number;
  y: number;
  frames: readonly Texture[];
}

// the tiles of the canvas where `moves` finds something to animate
function patchOrigins(moves: (x: number, y: number) => boolean): { x: number; y: number }[] {
  const origins: { x: number; y: number }[] = [];
  for (let top = 0; top < STAGE_HEIGHT; top += PATCH_HEIGHT) {
    for (let left = 0; left < STAGE_WIDTH; left += PATCH_WIDTH) {
      let found = false;
      for (let y = top; y < top + PATCH_HEIGHT && !found; y++) {
        for (let x = left; x < left + PATCH_WIDTH && !found; x++) {
          found = moves(x, y);
        }
      }
      if (found) {
        origins.push({ x: left, y: top });
      }
    }
  }
  return origins;
}

// Paints each tile for every frame of the loop into one atlas a frame: a pixel is the frame's mark on it, else what
// `underneath` gives, else clear.
function packPatches(
  origins: readonly { x: number; y: number }[],
  marksOf: (frame: number) => Map<number, Rgb>,
  underneath: (x: number, y: number, frame: number) => Rgb | null,
): WaterPatch[] {
  const atlasWidth = PATCH_WIDTH * ATLAS_COLUMNS;
  const atlasHeight = PATCH_HEIGHT * Math.ceil(origins.length / ATLAS_COLUMNS);
  const frames = Array.from({ length: WATER_FRAMES }, (_, frame) => {
    const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);
    const marks = marksOf(frame);
    origins.forEach((origin, index) => {
      const atlasX = (index % ATLAS_COLUMNS) * PATCH_WIDTH;
      const atlasY = Math.floor(index / ATLAS_COLUMNS) * PATCH_HEIGHT;
      for (let row = 0; row < PATCH_HEIGHT; row++) {
        for (let column = 0; column < PATCH_WIDTH; column++) {
          const x = origin.x + column;
          const y = origin.y + row;
          const colour = marks.get(y * STAGE_WIDTH + x) ?? underneath(x, y, frame);
          if (colour) {
            putPixel(pixels, atlasWidth, atlasX + column, atlasY + row, colour);
          }
        }
      }
    });
    return bufferTexture(pixels, atlasWidth, atlasHeight).source;
  });
  return origins.map((origin, index) => {
    const frame = new Rectangle(
      (index % ATLAS_COLUMNS) * PATCH_WIDTH,
      Math.floor(index / ATLAS_COLUMNS) * PATCH_HEIGHT,
      PATCH_WIDTH,
      PATCH_HEIGHT,
    );
    return { x: origin.x, y: origin.y, frames: frames.map((source) => new Texture({ source, frame })) };
  });
}

// the marks of one frame, by canvas pixel
function marksOf(frame: number, paint: (plot: (x: number, y: number, colour: Rgb) => void, frame: number) => void) {
  const marks = new Map<number, Rgb>();
  paint((x, y, colour) => {
    if (x >= 0 && x < STAGE_WIDTH) {
      marks.set(y * STAGE_WIDTH + x, colour);
    }
  }, frame);
  return marks;
}

// the far sea and the surf along the plaza
const paintPatches = () =>
  packPatches(
    patchOrigins(
      (x, y) => (y >= HORIZON_Y && y < FAR_SEA_END) || Math.abs(shoreDistance(x + 0.5, y + 0.5)) <= SURF_REACH + 1,
    ),
    (frame) => marksOf(frame, paintFarSea),
    surfPixel,
  );

// The ripples round a night's boats and posts, over the rest of the water: the plaza is laid out afresh each night
// (decor.ts), so these are painted for each layout, and clear tiles show what is under them. `release` gives the
// textures back once the night is over.
export function createRipples(ripples: readonly Ripple[]): { patches: readonly WaterPatch[]; release: () => void } {
  const patches = packPatches(
    patchOrigins((x, y) => nearRipple(ripples, x, y)),
    (frame) => marksOf(frame, (plot) => paintRipples(ripples, plot, frame)),
    () => null,
  );
  const release = () => {
    const sources = new Set(patches.flatMap((patch) => patch.frames.map((texture) => texture.source)));
    for (const patch of patches) {
      for (const texture of patch.frames) {
        texture.destroy(false);
      }
    }
    for (const source of sources) {
      source.destroy();
    }
  };
  return { patches, release };
}

// --- all of it, painted once -----------------------------------------------------------------------------------

export interface Water {
  base: Texture; // placed at y = HORIZON_Y
  swell: readonly Texture[]; // tiled from y = swellTop down
  swellTop: number;
  patches: readonly WaterPatch[];
}

let water: Water | null = null;
export function createWater(): Water {
  water ??= {
    base: paintBase(),
    swell: Array.from({ length: WATER_FRAMES }, (_, frame) => paintSwell(frame)),
    swellTop: FAR_SEA_END,
    patches: paintPatches(),
  };
  return water;
}
