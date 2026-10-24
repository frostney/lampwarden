// Shared tools for the pixel art painted in code (light.ts, water.ts): RGBA buffers turned into nearest-sampled
// textures, ordered dithering anchored to the canvas, and seeded randomness so every painted texture is the same on
// every load.
import { BufferImageSource, Texture, type WRAP_MODE } from "pixi.js";

export type Rgb = readonly [number, number, number];

export const hexRgb = (colour: number): Rgb => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];

export function bufferTexture(
  pixels: Uint8Array,
  width: number,
  height: number,
  addressMode: WRAP_MODE = "clamp-to-edge",
): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width,
      height,
      format: "rgba8unorm",
      alphaMode: "premultiplied-alpha",
      scaleMode: "nearest",
      addressMode,
    }),
  });
}

// writes one opaque pixel into an RGBA buffer of the given width
export function putPixel(pixels: Uint8Array, width: number, x: number, y: number, colour: Rgb) {
  const index = (y * width + x) * 4;
  pixels[index] = colour[0];
  pixels[index + 1] = colour[1];
  pixels[index + 2] = colour[2];
  pixels[index + 3] = 255;
}

// 4x4 Bayer thresholds in (0, 1), anchored to the canvas so a moving shape never makes the pattern swim
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayerThreshold = (x: number, y: number) => ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16;

// a small, fast seeded generator (mulberry32): the same seed paints the same texture
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// a stable pseudo-random value in [0, 1) for a pair of integers
export function hashUnit(first: number, second: number): number {
  let mixed = Math.imul(first | 0, 0x27d4eb2d) ^ Math.imul(second | 0, 0x165667b1);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

export function shuffle<Item>(list: Item[], random: () => number) {
  for (let index = list.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const current = list[index];
    const swapped = list[other];
    if (current === undefined || swapped === undefined) continue;
    list[index] = swapped;
    list[other] = current;
  }
}
