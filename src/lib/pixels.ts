// The layout of an RGBA picture's bytes: four a pixel, red first and alpha last.
export const BYTES_PER_PIXEL = 4;
export const ALPHA_BYTE = 3;
/** The alpha above which a pixel counts as drawn, where a check needs it to be clearly so. */
const SOLIDLY_DRAWN = 200;

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

/** How many pixels differ between two RGBA pictures; every pixel of the larger one when their sizes differ. */
export function differingPixels(first: Uint8Array, second: Uint8Array): number {
  if (first.length !== second.length) {
    return Math.max(first.length, second.length) / BYTES_PER_PIXEL;
  }
  let differing = 0;
  for (let offset = 0; offset < first.length; offset += BYTES_PER_PIXEL) {
    for (let index = offset; index < offset + BYTES_PER_PIXEL; index++) {
      if (first[index] !== second[index]) {
        differing++;
        break;
      }
    }
  }
  return differing;
}
