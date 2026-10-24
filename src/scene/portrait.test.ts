import { describe, expect, test } from "bun:test";
import { PORTRAIT, portraitShift, solidColumns } from "./portrait";

const SIZE = 128;
// a frame with a solid block at columns first..last and a translucent shadow trailing right of it
function frame(first: number, last: number, shadowEnd: number) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const set = (column: number, row: number, alpha: number) =>
    pixels.set([90, 60, 40, alpha], (row * SIZE + column) * 4);
  for (let row = 40; row < 100; row++) for (let column = first; column <= last; column++) set(column, row, 255);
  for (let column = last + 1; column <= shadowEnd; column++) set(column, 98, 120);
  return pixels;
}

describe("solidColumns", () => {
  test("leaves out the translucent shadow", () => {
    expect(solidColumns(frame(42, 86, 102), SIZE, SIZE)).toEqual({ first: 42, last: 86 });
  });

  test("has nothing to say about an empty frame", () => {
    expect(solidColumns(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE)).toBeNull();
  });
});

describe("portraitShift", () => {
  const middleAfter = (first: number, last: number, shadowEnd: number) =>
    (first + last + 1) / 2 + portraitShift(frame(first, last, shadowEnd), SIZE, SIZE);

  test("puts the middle of the solid body within half a pixel of the window's middle", () => {
    for (const [first, last] of [
      [42, 86],
      [48, 81],
      [10, 33],
    ] as const)
      expect(Math.abs(middleAfter(first, last, last + 25) - PORTRAIT.width / 2)).toBeLessThanOrEqual(0.5);
  });

  test("does not follow the shadow", () => {
    expect(portraitShift(frame(42, 86, 86), SIZE, SIZE)).toBe(portraitShift(frame(42, 86, 120), SIZE, SIZE));
  });
});
