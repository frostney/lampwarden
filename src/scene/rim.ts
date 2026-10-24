// Character sprites as pixels, for the lamp light that falls on them (lighting.ts): the sprite without the shadow it was
// painted with, and a rim of hard warm pixels along the edge that faces a lamp, cut from the sprite's own outline. Each
// is derived from the loaded sprite once, in code, and cached; nothing is blurred or blended per pixel at draw time.
import type { Texture } from "pixi.js";
import { bufferTexture, type Rgb } from "./paint";

export const isCharacterKey = (key: string) =>
  key === "satyr" || key === "cyclops" || key === "harpy" || key.startsWith("hero/") || key.startsWith("creature/");

// the pixels the sprite's painter drew as a soft shadow are translucent; the figure itself is opaque
const OPAQUE = 250;
// where light from each octant lands: the neighbour that has to be empty for a pixel to be on that edge (0 east,
// 1 south-east, 2 south, 3 south-west, 4 west, 5 north-west, 6 north, 7 north-east; y runs down the screen)
const OCTANTS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;
// the rim's light, mixed into the sprite's own pixel so the edge keeps its hue
const RIM_LIGHT: Rgb = [255, 228, 160];
const RIM_MIX = 0.72;

// RGBA pixels with the translucent shadow gone and the figure fully opaque
export function withoutShadowPixels(pixels: ArrayLike<number>): Uint8Array {
  const clean = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < OPAQUE) continue;
    clean[index] = pixels[index] ?? 0;
    clean[index + 1] = pixels[index + 1] ?? 0;
    clean[index + 2] = pixels[index + 2] ?? 0;
    clean[index + 3] = 255;
  }
  return clean;
}

// RGBA pixels of only the figure's edge that faces `octant`: opaque pixels with an empty neighbour that way
export function rimPixels(pixels: ArrayLike<number>, width: number, height: number, octant: number): Uint8Array {
  const [stepX, stepY] = OCTANTS[((octant % 8) + 8) % 8] ?? OCTANTS[0];
  const rim = new Uint8Array(width * height * 4);
  const solid = (column: number, row: number) =>
    column >= 0 && row >= 0 && column < width && row < height && (pixels[(row * width + column) * 4 + 3] ?? 0) > 0;
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      if (!solid(column, row) || solid(column + stepX, row + stepY)) continue;
      const index = (row * width + column) * 4;
      for (let component = 0; component < 3; component++)
        rim[index + component] = Math.round(
          (pixels[index + component] ?? 0) * (1 - RIM_MIX) + (RIM_LIGHT[component] ?? 255) * RIM_MIX,
        );
      rim[index + 3] = 255;
    }
  return rim;
}

interface SpritePixels {
  pixels: Uint8Array;
  width: number;
  height: number;
}
const spritePixels = new WeakMap<Texture, SpritePixels>();
const rims = new WeakMap<Texture, (Texture | undefined)[]>();

function readPixels(texture: Texture): { pixels: Uint8ClampedArray; width: number; height: number } | null {
  const { resource } = texture.source;
  if (!(resource instanceof ImageBitmap) && !(resource instanceof HTMLImageElement)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = texture.source.pixelWidth;
  canvas.height = texture.source.pixelHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(resource, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data, width: canvas.width, height: canvas.height };
}

// The sprite redrawn without its painted shadow, as a new nearest-sampled texture (null when the browser will not give up
// the pixels, which leaves the sprite as it was). The pixels are kept for the rim.
export function withoutPaintedShadow(texture: Texture): Texture | null {
  const read = readPixels(texture);
  if (!read) return null;
  const pixels = withoutShadowPixels(read.pixels);
  const clean = bufferTexture(pixels, read.width, read.height);
  // keep the loaded file's label, which names the sprite (the visual verifier reads it to tell which warden is shown)
  clean.source.label = texture.source.label;
  spritePixels.set(clean, { pixels, width: read.width, height: read.height });
  return clean;
}

// The rim for the edge of a (shadowless) sprite that faces `octant`, a texture the size of the sprite to draw over it.
export function rimTexture(texture: Texture, octant: number): Texture | null {
  const sprite = spritePixels.get(texture);
  if (!sprite) return null;
  let byOctant = rims.get(texture);
  if (!byOctant) {
    byOctant = [];
    rims.set(texture, byOctant);
  }
  let rim = byOctant[octant];
  if (!rim) {
    rim = bufferTexture(rimPixels(sprite.pixels, sprite.width, sprite.height, octant), sprite.width, sprite.height);
    byOctant[octant] = rim;
  }
  return rim;
}
