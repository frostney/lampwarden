import { describe, expect, test } from "bun:test";

import { STAGE_HEIGHT, STAGE_WIDTH } from "../game/sim";
import { VIGNETTE_STRENGTHS, vignettePixels, vignetteStrength } from "./vignette";

const covered = (pixels: Uint8Array) => {
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 0) > 0) {
      count++;
    }
  }
  return count;
};
const alphaAt = (pixels: Uint8Array, x: number, y: number) => pixels[(y * STAGE_WIDTH + x) * 4 + 3] ?? 0;

describe("the wound vignette", () => {
  test("a stronger pulse covers more of the edge and never the middle", () => {
    const counts = Array.from({ length: VIGNETTE_STRENGTHS }, (_, index) => covered(vignettePixels(index + 1)));
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeGreaterThan(counts[index - 1] ?? 0);
    }
    for (let strength = 1; strength <= VIGNETTE_STRENGTHS; strength++) {
      expect(alphaAt(vignettePixels(strength), STAGE_WIDTH / 2, STAGE_HEIGHT / 2)).toBe(0);
    }
  });

  test("its inner edge is dithered: hard pixels, none half-transparent, a band that thins out", () => {
    const pixels = vignettePixels(VIGNETTE_STRENGTHS);
    const alphas = new Set<number>();
    for (let index = 3; index < pixels.length; index += 4) {
      alphas.add(pixels[index] ?? 0);
    }
    expect([...alphas].sort()).toEqual([0, 130]);
    // along a row from the left edge: solid at the edge, thinning out through the band, nothing beyond it
    const row = STAGE_HEIGHT / 2;
    const alongRow = (from: number, count: number) =>
      Array.from({ length: count }, (_, x) => alphaAt(pixels, from + x, row)).filter((alpha) => alpha > 0).length;
    expect(alongRow(0, 2)).toBe(2);
    expect(alongRow(20, 24)).toBeGreaterThan(2);
    expect(alongRow(20, 24)).toBeLessThan(22);
    expect(alongRow(70, 40)).toBe(0);
  });

  test("the pulse strikes at full and steps down to nothing as the hurt runs out", () => {
    const steps = [0.4, 0.3, 0.2, 0.1, 0].map((remaining) => vignetteStrength(remaining, 0.4));
    expect(steps).toEqual([3, 3, 2, 1, 0]);
  });
});
