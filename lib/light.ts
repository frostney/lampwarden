// Light as pixel art: stepped amber bands with ordered dithering at their edges, glints that twinkle on the lit stone,
// a sparkle on each brass lantern and broken reflections on the sea. Every texture is painted here pixel by pixel,
// once, and cached; a frame only picks which precomputed texture each sprite shows, from the scene clock (frozen by the
// visual verifier, so its frames are deterministic). All of it is drawn additively over the night tint.
import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import { ANCHOR_Y } from "./assets";
import { CX, CY, HALF_H, HALF_W } from "./sim";

type Rgb = readonly [number, number, number];

// a texture and where its top-left pixel sits relative to the point it lights
export interface LightPiece { texture: Texture; offsetX: number; offsetY: number }

// --- ordered dithering and flicker ---------------------------------------------------------------------------

// 4x4 Bayer thresholds, anchored to the canvas so a moving light never makes the pattern swim
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayerThreshold = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
// how much of a band the dither reaches into across each boundary (1 would dither the whole band)
const DITHER_SPREAD = 0.4;

// A flicker frame moves the band edges by whole pixels and shifts the dither threshold, nothing in between.
interface FlickerVariant { radiusStep: number; ditherShift: number }
const FLICKER_VARIANTS: readonly FlickerVariant[] = [
  { radiusStep: 0, ditherShift: 0 },
  { radiusStep: 1, ditherShift: 1 },
  { radiusStep: 0, ditherShift: 2 },
  { radiusStep: -1, ditherShift: 3 },
];
// mostly calm, with a gutter now and then
const FLICKER_SEQUENCE = [0, 0, 1, 0, 2, 0, 0, 3, 0, 1, 0, 0, 2, 3, 0, 0];
const FLICKER_FPS = 6;
const flickerIndex = (clock: number, seed: number) =>
  FLICKER_SEQUENCE[(Math.floor(clock * FLICKER_FPS) + seed * 5) % FLICKER_SEQUENCE.length];

// --- painting --------------------------------------------------------------------------------------------------

function bufferTexture(pixels: Uint8Array, width: number, height: number): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: pixels, width, height, format: "rgba8unorm", alphaMode: "premultiplied-alpha", scaleMode: "nearest",
    }),
  });
}

interface LightShape {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  palette: readonly Rgb[];   // additive colour of each level, dimmest first
  falloff: number;           // above 1 widens the bright bands
  groundOnly: boolean;       // only the plaza's top catches it, its rim and its tiles' lit bevels one level brighter
}

// the plaza's top face, tested at the pixel centre
const onPlaza = (x: number, y: number) => Math.abs(x + 0.5 - CX) / HALF_W + Math.abs(y + 0.5 - CY) / HALF_H <= 1;
// a plaza pixel on its rim, where the stone meets the wall or the sea
const onPlazaRim = (x: number, y: number) => onPlaza(x, y) && (!onPlaza(x, y + 1) || !onPlaza(x, y - 1));
const PLAZA_WALL = 14;   // the plaza's side walls, drawn under its front edges by drawGround
const frontRimY = (x: number) => CY + HALF_H * (1 - Math.abs(x - CX) / HALF_W);
const onWall = (x: number, y: number) => Math.abs(x - CX) <= HALF_W && y > frontRimY(x) && y <= frontRimY(x) + PLAZA_WALL;
const onSea = (x: number, y: number) => !onPlaza(x, y) && !onWall(x, y);

// plaza coordinates: tile vertices sit where both are whole numbers (0 to 12), tile edges where either is
const plazaU = (x: number, y: number) => ((x - CX) / 32 + (y - (CY - HALF_H)) / 16) / 2;
const plazaV = (x: number, y: number) => ((y - (CY - HALF_H)) / 16 - (x - CX) / 32) / 2;
const plazaPoint = (u: number, v: number) => ({ x: Math.round(CX + 32 * (u - v)), y: Math.round(CY - HALF_H + 16 * (u + v)) });
const distanceToWhole = (value: number) => Math.abs(value - Math.round(value));

// The bevel of a tile on the side facing the light: the pixel row just inside the grout line nearest the lamp. One
// unit of u or v is 32 pixel rows, and the grout itself takes the first row.
function facesLight(shape: LightShape, x: number, y: number): boolean {
  const bevel = (pixel: number, light: number) => {
    const rows = (light < pixel ? pixel - Math.floor(pixel) : Math.ceil(pixel) - pixel) * 32;
    return rows >= 0.75 && rows < 1.75;
  };
  return bevel(plazaU(x + 0.5, y + 0.5), plazaU(shape.centerX, shape.centerY))
    || bevel(plazaV(x + 0.5, y + 0.5), plazaV(shape.centerX, shape.centerY));
}

// the band a pixel falls in, 0 (unlit) to palette.length, before the plaza is taken into account
function bandLevel(shape: LightShape, x: number, y: number, variant: FlickerVariant): number {
  const radiusX = shape.radiusX + variant.radiusStep, radiusY = shape.radiusY + variant.radiusStep / 2;
  const distance = Math.hypot((x - shape.centerX) / radiusX, (y - shape.centerY) / radiusY);
  if (distance >= 1) return 0;
  const levels = shape.palette.length;
  const value = (1 - distance ** shape.falloff) * levels + 0.5 + (bayerThreshold(x + variant.ditherShift, y) - 0.5) * DITHER_SPREAD;
  return Math.max(0, Math.min(levels, Math.floor(value)));
}

function lightLevel(shape: LightShape, x: number, y: number, variant: FlickerVariant): number {
  if (shape.groundOnly && !onPlaza(x, y)) return 0;
  const level = bandLevel(shape, x, y, variant);
  if (!shape.groundOnly || level === 0) return level;
  // the rim, and in the brighter bands each tile's lit bevel, catch the light one level brighter
  const highlight = onPlazaRim(x, y) || (level >= 2 && facesLight(shape, x, y));
  return highlight ? Math.min(shape.palette.length, level + 1) : level;
}

function paintLight(shape: LightShape, variant: FlickerVariant): LightPiece {
  const extentX = Math.ceil(shape.radiusX) + 2, extentY = Math.ceil(shape.radiusY) + 2;
  const width = extentX * 2 + 1, height = extentY * 2 + 1;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const level = lightLevel(shape, shape.centerX - extentX + column, shape.centerY - extentY + row, variant);
      if (level === 0) continue;
      const [red, green, blue] = shape.palette[level - 1];
      const index = (row * width + column) * 4;
      pixels[index] = red; pixels[index + 1] = green; pixels[index + 2] = blue; pixels[index + 3] = 255;
    }
  }
  return { texture: bufferTexture(pixels, width, height), offsetX: -extentX, offsetY: -extentY };
}

// --- palettes (added to the night-tinted scene) ----------------------------------------------------------------

const POOL_PALETTE: readonly Rgb[] = [[40, 22, 6], [86, 52, 18], [134, 88, 36], [186, 128, 60]];
const HALO_PALETTE: readonly Rgb[] = [[40, 24, 8], [64, 40, 14], [84, 56, 22], [96, 64, 26]];
const HERO_PALETTE: readonly Rgb[] = [[24, 14, 4], [50, 30, 10], [80, 52, 20]];

// --- glints ----------------------------------------------------------------------------------------------------

// One frame of a glint: a small additive shape, or nothing (between twinkles).
export type GlintFrame = LightPiece | null;
export interface Glint { x: number; y: number; phase: number; frames: readonly GlintFrame[] }
const GLINT_FPS = 10;
export const glintFrame = (glint: Glint, clock: number) =>
  glint.frames[(Math.floor(clock * GLINT_FPS) + glint.phase) % glint.frames.length];

// Glint shapes as pixel patterns, centred on their middle pixel. Stone and brass: a dim, b warm, c the white-hot core.
// Water (amber, as the sea is already blue): w dim, x warm, y hot.
const GLINT_INK: Partial<Record<string, Rgb>> = {
  a: [120, 80, 34], b: [240, 186, 104], c: [255, 248, 220], w: [80, 44, 4], x: [200, 118, 24], y: [255, 196, 96],
};
// the tile edges run at 2:1, so their glints are two-pixel steps: "slash" rises to the right, "backslash" falls
const GLINT_PATTERNS = {
  speckDim: ["a"],
  speck: ["b"],
  speckBright: ["c"],
  slashDim: ["..aa", "aa.."],
  slash: ["....ab", "..bb..", "ba...."],
  slashBright: ["....bc", "..cc..", "cb...."],
  backslashDim: ["aa..", "..aa"],
  backslash: ["ab....", "..bb..", "....ba"],
  backslashBright: ["cb....", "..cc..", "....bc"],
  rimDim: ["aa"],
  rim: ["bb"],
  rimBright: ["bcb"],
  plus: [".a.", "aca", ".a."],
  star: ["..a..", "..b..", "abcba", "..b..", "..a.."],
  bigStar: ["...a...", "...b...", "..aba..", "abbcbba", "..aba..", "...b...", "...a..."],
} satisfies Record<string, readonly string[]>;
type GlintShape = keyof typeof GLINT_PATTERNS;

function patternPiece(rows: readonly string[]): LightPiece {
  const height = rows.length, width = Math.max(...rows.map((row) => row.length));
  const pixels = new Uint8Array(width * height * 4);
  rows.forEach((row, rowIndex) => [...row].forEach((character, column) => {
    const ink = GLINT_INK[character];
    if (!ink) return;
    const index = (rowIndex * width + column) * 4;
    pixels[index] = ink[0]; pixels[index + 1] = ink[1]; pixels[index + 2] = ink[2]; pixels[index + 3] = 255;
  }));
  return { texture: bufferTexture(pixels, width, height), offsetX: -Math.floor((width - 1) / 2), offsetY: -Math.floor((height - 1) / 2) };
}

const glintPieces = new Map<GlintShape, LightPiece>();
function glintPiece(shape: GlintShape): LightPiece {
  let piece = glintPieces.get(shape);
  if (!piece) { piece = patternPiece(GLINT_PATTERNS[shape]); glintPieces.set(shape, piece); }
  return piece;
}

// a twinkle: dark for most of its period, then the shapes in turn
function twinkle(shapes: readonly GlintShape[], period: number): GlintFrame[] {
  return Array.from({ length: period }, (_, index) => (index < shapes.length ? glintPiece(shapes[index]) : null));
}

// a short horizontal glint on the water, length pixels long: dim tips, warm middle, an optional hot centre
const rippleCache = new Map<string, LightPiece>();
function ripplePiece(length: number, bright: boolean, shiftX: number): LightPiece {
  const key = `${length}:${bright}:${shiftX}`;
  let piece = rippleCache.get(key);
  if (!piece) {
    const middle = Math.floor((length - 1) / 2);
    const row = Array.from({ length }, (_, index) =>
      index === 0 || index === length - 1 ? "w" : bright && index === middle ? "y" : "x").join("");
    const pattern = patternPiece([length === 1 ? (bright ? "x" : "w") : row]);
    piece = { ...pattern, offsetX: pattern.offsetX + shiftX };
    rippleCache.set(key, piece);
  }
  return piece;
}

// water shimmer: the streak stretches, shrinks and slides by a pixel, and drops out now and then
function shimmer(length: number, bright: boolean): GlintFrame[] {
  const steps: (readonly [number, number] | null)[] = [[0, 0], [0, 0], [1, 1], [-1, 0], null, [-2, -1], [0, 0], [1, -1]];
  return steps.map((step) => (step ? ripplePiece(Math.max(1, length + step[0]), bright, step[1]) : null));
}

// --- the lights in the scene -----------------------------------------------------------------------------------

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<Item>(list: Item[], random: () => number) {
  for (let index = list.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [list[index], list[other]] = [list[other], list[index]];
  }
}

export interface LampLight {
  seed: number;
  poolX: number;
  poolY: number;
  pools: readonly LightPiece[];    // one per flicker variant
  haloX: number;
  haloY: number;
  halos: readonly LightPiece[];
  glints: readonly Glint[];        // the stone, the lantern's brass and the sea
}

const lampLights = new Map<string, LampLight>();

// Everything a lit lamp at (x, y) shows, for a light radius (the sim's ground radius); built once per lamp and radius.
export function lampLight(x: number, y: number, radius: number): LampLight {
  const key = `${x},${y},${radius}`;
  const cached = lampLights.get(key);
  if (cached) return cached;
  const seed = (x * 7 + y * 13) % 16;
  const pool: LightShape = {
    centerX: x, centerY: y - 6, radiusX: Math.round(radius * 1.1), radiusY: Math.round(radius * 0.55),
    palette: POOL_PALETTE, falloff: 1.3, groundOnly: true,
  };
  const halo: LightShape = { centerX: x, centerY: y - 77, radiusX: 24, radiusY: 24, palette: HALO_PALETTE, falloff: 1.2, groundOnly: false };
  const light: LampLight = {
    seed,
    poolX: pool.centerX, poolY: pool.centerY, pools: FLICKER_VARIANTS.map((variant) => paintLight(pool, variant)),
    haloX: halo.centerX, haloY: halo.centerY, halos: FLICKER_VARIANTS.map((variant) => paintLight(halo, variant)),
    glints: [...groundGlints(pool, seededRandom(seed * 7919 + radius)), ...lanternGlints(x, y, seed), ...seaGlints(pool, x, seededRandom(seed * 104729 + radius))],
  };
  lampLights.set(key, light);
  return light;
}

// Sparse points on the lit stone that catch the light in turn: tile corners flare into small stars, tile edges and
// the plaza's rim into short bright dashes, and specks in the stone into single pixels. Brighter bands get more.
function groundGlints(pool: LightShape, random: () => number): Glint[] {
  const calm = FLICKER_VARIANTS[0];
  const area = pool.radiusX * pool.radiusY;
  const glints: Glint[] = [];
  const free = (x: number, y: number) => glints.every((glint) => Math.abs(glint.x - x) + Math.abs(glint.y - y) > 8);
  const levelAt = (x: number, y: number) => lightLevel(pool, x, y, calm);
  const period = () => 10 + Math.floor(random() * 8);
  const add = (x: number, y: number, shapes: readonly GlintShape[]) => {
    const length = period();
    glints.push({ x, y, phase: Math.floor(random() * length), frames: twinkle(shapes, length) });
  };
  const randomPoint = () => ({
    x: Math.round(pool.centerX + (random() * 2 - 1) * pool.radiusX), y: Math.round(pool.centerY + (random() * 2 - 1) * pool.radiusY),
  });
  const nearLampBase = (x: number, y: number) => Math.abs(x - pool.centerX) < 10 && Math.abs(y - pool.centerY) < 8;

  // tile corners in the two brightest bands
  const corners: { x: number; y: number }[] = [];
  for (let u = 1; u < 12; u++) for (let v = 1; v < 12; v++) {
    const point = plazaPoint(u, v);
    if (levelAt(point.x, point.y) >= pool.palette.length - 1 && !nearLampBase(point.x, point.y)) corners.push(point);
  }
  shuffle(corners, random);
  for (const corner of corners.slice(0, Math.round(area / 1300))) add(corner.x, corner.y, ["speck", "plus", "star", "star", "plus", "speck"]);

  // tile edges: a random point snapped onto the nearest grid line
  for (let attempt = 0, placed = 0; attempt < 400 && placed < Math.round(area / 450); attempt++) {
    const point = randomPoint();
    let u = plazaU(point.x, point.y), v = plazaV(point.x, point.y);
    // a whole u is a line running down-left ("slash"), a whole v one running down-right ("backslash")
    const slash = distanceToWhole(u) < distanceToWhole(v);
    if (slash) u = Math.round(u); else v = Math.round(v);
    const snapped = plazaPoint(u, v);
    const level = levelAt(snapped.x, snapped.y);
    if (level < 2 || random() * pool.palette.length > level || !free(snapped.x, snapped.y) || nearLampBase(snapped.x, snapped.y)) continue;
    add(snapped.x, snapped.y, level >= 3
      ? (slash ? ["slashDim", "slash", "slashBright", "slashBright", "slash", "slashDim"] : ["backslashDim", "backslash", "backslashBright", "backslashBright", "backslash", "backslashDim"])
      : (slash ? ["slashDim", "slash", "slash", "slashDim"] : ["backslashDim", "backslash", "backslash", "backslashDim"]));
    placed++;
  }

  // specks inside the tiles, away from the grid lines
  for (let attempt = 0, placed = 0; attempt < 400 && placed < Math.round(area / 500); attempt++) {
    const point = randomPoint();
    const level = levelAt(point.x, point.y);
    const awayFromLines = distanceToWhole(plazaU(point.x, point.y)) > 0.18 && distanceToWhole(plazaV(point.x, point.y)) > 0.18;
    if (level < 2 || !awayFromLines || !free(point.x, point.y) || nearLampBase(point.x, point.y)) continue;
    add(point.x, point.y, level >= 3 ? ["speckDim", "speck", "speckBright", "plus", "speckBright", "speck"] : ["speckDim", "speck", "speckBright", "speck"]);
    placed++;
  }

  // the rim, where it is lit
  const rim: { x: number; y: number }[] = [];
  for (let y = Math.floor(pool.centerY - pool.radiusY); y <= pool.centerY + pool.radiusY; y++)
    for (let x = Math.floor(pool.centerX - pool.radiusX); x <= pool.centerX + pool.radiusX; x += 2)
      if (onPlazaRim(x, y) && levelAt(x, y) >= 2) rim.push({ x, y });
  shuffle(rim, random);
  for (const point of rim.filter((candidate) => free(candidate.x, candidate.y)).slice(0, 3))
    add(point.x, point.y, ["rimDim", "rim", "rimBright", "rimBright", "rim", "rimDim"]);
  return glints;
}

const FINIAL_PULSE: readonly GlintShape[] = ["speck", "plus", "star", "bigStar", "bigStar", "bigStar", "star", "plus", "speckBright", "speck", "speck", "speckBright"];

// Light off the brass: a star on the finial that never quite goes out, and a smaller glint on the cap's left corner.
// Offsets are from the lamp's ground point, read off public/sprites/lamp-lit.png.
function lanternGlints(x: number, y: number, seed: number): Glint[] {
  return [
    { x: x + 2, y: y - 94, phase: seed, frames: FINIAL_PULSE.map(glintPiece) },
    { x: x - 12, y: y - 84, phase: seed + 7, frames: twinkle(["speckDim", "speck", "plus", "speck", "speckDim"], 14) },
  ];
}

// Broken reflections on the sea where the pool reaches it: a column of streaks below the plaza wall under the lamp
// where the pool reaches the front rim, and streaks on any sea the pool itself covers (the back edges, wide wicks).
function seaGlints(pool: LightShape, lampX: number, random: () => number): Glint[] {
  const glints: Glint[] = [];
  const add = (x: number, y: number, length: number, bright: boolean) =>
    glints.push({ x, y, phase: Math.floor(random() * 8), frames: shimmer(length, bright) });
  const calm = FLICKER_VARIANTS[0];

  // front rim: the lit chord of the rim above the wall
  let chordLeft = Infinity, chordRight = -Infinity;
  for (let x = Math.floor(pool.centerX - pool.radiusX); x <= pool.centerX + pool.radiusX; x++) {
    const rimY = Math.floor(frontRimY(x));
    for (let y = rimY - 1; y <= rimY; y++) {
      if (onPlazaRim(x, y) && !onPlaza(x, y + 1) && lightLevel(pool, x, y, calm) >= 1) {
        chordLeft = Math.min(chordLeft, x); chordRight = Math.max(chordRight, x);
      }
    }
  }
  if (chordLeft <= chordRight) {
    const center = Math.min(chordRight, Math.max(chordLeft, lampX));
    // a column under the lamp, narrowing with depth
    const halfWidth = Math.min(16, Math.max(6, (chordRight - chordLeft) / 2));
    for (let row = 0; row < 8; row++) {
      for (let streak = 0; streak < (row < 2 ? 3 : row < 4 ? 2 : 1); streak++) {
        const x = Math.round(center + (random() * 2 - 1) * halfWidth * (1 - row * 0.1));
        const y = Math.floor(frontRimY(x)) + PLAZA_WALL + 3 + row * 4 + Math.floor(random() * 2);
        add(x, y, Math.max(2, 9 - row + Math.floor(random() * 3) - 1), row < 3);
      }
    }
  }

  // open sea inside the pool
  const seaPixels: { x: number; y: number }[] = [];
  for (let y = Math.floor(pool.centerY - pool.radiusY); y <= pool.centerY + pool.radiusY; y += 3)
    for (let x = Math.floor(pool.centerX - pool.radiusX); x <= pool.centerX + pool.radiusX; x += 2)
      if (onSea(x, y) && bandLevel(pool, x, y, calm) >= 1) seaPixels.push({ x, y });
  shuffle(seaPixels, random);
  for (const point of seaPixels.slice(0, Math.min(10, Math.round(seaPixels.length / 25))))
    add(point.x, point.y, 2 + Math.floor(random() * 4), bandLevel(pool, point.x, point.y, calm) >= 2);
  return glints;
}

// The lantern cut out of the lit lamp sprite (lamp-lit.png, read off by eye) and added over the night, so its panes
// and brass glow in their own pixels instead of being washed over. Placed relative to the lamp's ground point.
const LANTERN = { left: 50, top: 8, width: 30, height: 39 };
const lanterns = new WeakMap<Texture, LightPiece>();
export function lanternGlow(lampTexture: Texture): LightPiece {
  let piece = lanterns.get(lampTexture);
  if (!piece) {
    const { frame } = lampTexture;
    piece = {
      texture: new Texture({ source: lampTexture.source, frame: new Rectangle(frame.x + LANTERN.left, frame.y + LANTERN.top, LANTERN.width, LANTERN.height) }),
      offsetX: LANTERN.left - Math.round(frame.width / 2),
      offsetY: LANTERN.top - Math.round(frame.height * ANCHOR_Y["lamp-lit"]),
    };
    lanterns.set(lampTexture, piece);
  }
  return piece;
}

export const lampFlicker = (light: LampLight, clock: number) => flickerIndex(clock, light.seed);

// The warden's own small light: the same bands and dither, three levels, built lazily for each dither phase.
const heroLights = new Map<string, LightPiece>();
export function heroLight(centerX: number, centerY: number, clock: number): LightPiece {
  const variantIndex = flickerIndex(clock, 11);
  const key = `${centerX & 3},${centerY & 3},${variantIndex}`;
  let piece = heroLights.get(key);
  if (!piece) {
    // painted around a point with the same dither phase as the warden's, so the pattern stays fixed to the canvas
    piece = paintLight(
      { centerX: (centerX & 3) + 64, centerY: (centerY & 3) + 32, radiusX: 60, radiusY: 30, palette: HERO_PALETTE, falloff: 1.2, groundOnly: false },
      FLICKER_VARIANTS[variantIndex],
    );
    heroLights.set(key, piece);
  }
  return piece;
}
