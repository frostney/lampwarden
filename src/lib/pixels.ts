// The layout of an RGBA picture's bytes: four a pixel, red first and alpha last.
export const BYTES_PER_PIXEL = 4;
export const ALPHA_BYTE = 3;
/** The alpha above which a pixel counts as drawn, where a check needs it to be clearly so. */
export const SOLIDLY_DRAWN = 200;

/** How many pixels of an RGBA picture are solidly drawn. */
export function solidPixels(rgba: Uint8Array): number {
  let count = 0;
  for (let offset = ALPHA_BYTE; offset < rgba.length; offset += BYTES_PER_PIXEL) {
    if ((rgba[offset] ?? 0) > SOLIDLY_DRAWN) {
      count++;
    }
  }
  return count;
}
