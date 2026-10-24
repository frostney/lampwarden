// The hero choice card's portrait: a window onto a warden's 128 px frame, with the warden's solid body in the middle of
// it. The painted shadow is translucent and falls to the right, so the window centres the opaque pixels, not every
// visible one; the shadow hangs off to the side and is clipped by the window where it must be.
import { HERO_FRAME_SIZE } from "./assets";
import { OPAQUE } from "./rim";

// the window, in art pixels of the frame (pixel for pixel: the card scales it by a whole number). It is as wide as the
// card's column and tall enough for the raised sword's tip down to the feet; a spear thrust past its sides is clipped.
// src/app/globals.css sizes `.hero-portrait` to match.
export const PORTRAIT = { width: 80, height: 94, top: 14 } as const;

// the first and last column of the frame's solid (opaque) pixels, or null when it has none
export function solidColumns(pixels: ArrayLike<number>, width: number, height: number) {
  let first = width;
  let last = -1;
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      if ((pixels[(row * width + column) * 4 + 3] ?? 0) < OPAQUE) continue;
      first = Math.min(first, column);
      last = Math.max(last, column);
    }
  return last < 0 ? null : { first, last };
}

// How far to draw a frame to the right (negative: to the left) in the window so the middle of its solid body falls on the
// middle of the window, in whole pixels (so the body is within half a pixel of the middle). Taken from one frame of a
// warden at rest and used for all of that warden's frames, so the figure does not jitter as the frames change.
export function portraitShift(pixels: ArrayLike<number>, width: number, height: number) {
  const columns = solidColumns(pixels, width, height);
  const bodyMiddle = columns ? (columns.first + columns.last + 1) / 2 : HERO_FRAME_SIZE / 2;
  return Math.round(PORTRAIT.width / 2 - bodyMiddle);
}
