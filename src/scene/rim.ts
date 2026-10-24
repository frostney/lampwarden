// Character sprites as pixels, for the lamp light that falls on them (lighting.ts): the sprite without the shadow it was
// painted with, and a rim of hard warm pixels along the edge that faces a lamp, cut from the sprite's own outline. Each
// is derived from the loaded sprite once, in code, and cached; nothing is blurred or blended per pixel at draw time. A
// lamp's sprite is split the same way, its painted shadow becoming a texture that lies on the ground.
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

// The other half of the same split, for a prop that is not a character: the translucent pixels alone, the shadow the
// sprite was painted with, as premultiplied pixels for a texture of its own
export function paintedShadowPixels(pixels: ArrayLike<number>): Uint8Array {
  const shadow = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha === 0 || alpha >= OPAQUE) continue;
    for (let component = 0; component < 3; component++)
      shadow[index + component] = Math.round(((pixels[index + component] ?? 0) * alpha) / 255);
    shadow[index + 3] = alpha;
  }
  return shadow;
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

// a character's pixels (already without the shadow) as a texture of its own, kept for the rim
function characterTexture(pixels: Uint8Array, width: number, height: number, label: string): Texture {
  const clean = bufferTexture(pixels, width, height);
  // the label names the sprite (the visual verifier reads it to tell which warden is shown)
  clean.source.label = label;
  spritePixels.set(clean, { pixels, width, height });
  return clean;
}

// The sprite redrawn without its painted shadow, as a new nearest-sampled texture (null when the browser will not give up
// the pixels, which leaves the sprite as it was). The pixels are kept for the rim.
export function withoutPaintedShadow(texture: Texture): Texture | null {
  const read = readPixels(texture);
  if (!read) return null;
  return characterTexture(withoutShadowPixels(read.pixels), read.width, read.height, texture.source.label);
}

// A prop's sprite split into its body (the opaque pixels, nearest-sampled) and the shadow it was painted with, each a
// texture the size of the sprite, to be drawn at the same place: the body sorts with the figures, the shadow lies on
// the ground under them (null when the browser will not give up the pixels, which leaves the sprite as it was).
export function splitPaintedShadow(texture: Texture): { body: Texture; shadow: Texture } | null {
  const read = readPixels(texture);
  if (!read) return null;
  const body = bufferTexture(withoutShadowPixels(read.pixels), read.width, read.height);
  body.source.label = texture.source.label;
  return { body, shadow: bufferTexture(paintedShadowPixels(read.pixels), read.width, read.height) };
}

// Cuts square cells out of an atlas of character frames, each as its own shadowless texture with the label it is given
// (null when the browser will not give up the atlas's pixels). The atlas is read once.
export function cutCharacterFrames(
  atlas: Texture,
  size: number,
  cells: readonly { key: string; label: string; x: number; y: number }[],
): Map<string, Texture> | null {
  const read = readPixels(atlas);
  if (!read) return null;
  const frames = new Map<string, Texture>();
  for (const cell of cells) {
    const pixels = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
      const start = ((cell.y + row) * read.width + cell.x) * 4;
      pixels.set(read.pixels.subarray(start, start + size * 4), row * size * 4);
    }
    frames.set(cell.key, characterTexture(withoutShadowPixels(pixels), size, size, cell.label));
  }
  return frames;
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
