// The red vignette that pulses at the screen's edges when the warden is wounded, as pixel art painted once in code: a
// ring of hard pixels over the stage, dithered with the Bayer pattern so its inner edge thins out in steps, in two reds
// (the denser outer band is the darker). There is no blur and no gradient; a stronger pulse is a wider ring.
import type { Texture } from "pixi.js";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../game/sim";
import { bayerThreshold, bufferTexture, hexRgb, type Rgb } from "./paint";

// how deep into the screen each strength reaches, in pixels from the nearest edge
const DEPTHS = [0, 18, 34, 52] as const;
export const VIGNETTE_STRENGTHS = DEPTHS.length - 1;
const BRIGHT: Rgb = hexRgb(0xe0383a);
const DARK: Rgb = hexRgb(0x8c1620);
const ALPHA = 130; // of 255: the play shows through the ring
// distance from the top and bottom is stretched by the aspect, so the ring is as deep as a share of the screen at
// the top and bottom as at the sides
const VERTICAL_WEIGHT = STAGE_WIDTH / STAGE_HEIGHT;

// RGBA premultiplied pixels of the ring for a strength (1 to VIGNETTE_STRENGTHS)
export function vignettePixels(strength: number, width = STAGE_WIDTH, height = STAGE_HEIGHT): Uint8Array {
  const depth = DEPTHS[Math.max(0, Math.min(VIGNETTE_STRENGTHS, strength))] ?? 0;
  const pixels = new Uint8Array(width * height * 4);
  if (depth === 0) return pixels;
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      // how far in from the nearest edge; near a corner the two edges combine into less than either (their harmonic
      // mean), so the ring reaches further in there
      const fromSide = Math.min(column, width - 1 - column);
      const fromTop = Math.min(row, height - 1 - row) * VERTICAL_WEIGHT;
      const inward = fromSide + fromTop === 0 ? 0 : (fromSide * fromTop) / (fromSide + fromTop);
      const coverage = 1 - inward / depth;
      if (coverage <= bayerThreshold(column, row)) continue;
      const colour = coverage > 0.62 ? DARK : BRIGHT;
      const index = (row * width + column) * 4;
      pixels[index] = Math.round((colour[0] * ALPHA) / 255);
      pixels[index + 1] = Math.round((colour[1] * ALPHA) / 255);
      pixels[index + 2] = Math.round((colour[2] * ALPHA) / 255);
      pixels[index + 3] = ALPHA;
    }
  return pixels;
}

// the strength a pulse shows at while `remaining` of its `total` seconds are left: it strikes at full and steps down
export const vignetteStrength = (remaining: number, total: number) =>
  remaining <= 0 ? 0 : Math.min(VIGNETTE_STRENGTHS, Math.ceil((remaining / total) * VIGNETTE_STRENGTHS));

const textures: (Texture | undefined)[] = [];
export function vignetteTexture(strength: number): Texture | null {
  if (strength < 1 || strength > VIGNETTE_STRENGTHS) return null;
  let texture = textures[strength];
  if (!texture) {
    texture = bufferTexture(vignettePixels(strength), STAGE_WIDTH, STAGE_HEIGHT);
    texture.source.label = `vignette/${strength}`;
    textures[strength] = texture;
  }
  return texture;
}
