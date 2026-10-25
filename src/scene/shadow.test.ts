import { describe, expect, test } from "bun:test";

import { paintShadow } from "./shadow";

const covered = (shadow: ReturnType<typeof paintShadow>) => {
  const points: { column: number; row: number }[] = [];
  for (let row = 0; row < shadow.height; row++) {
    for (let column = 0; column < shadow.width; column++) {
      if ((shadow.pixels[(row * shadow.width + column) * 4 + 3] ?? 0) > 0) {
        points.push({ column, row });
      }
    }
  }
  return points;
};
const centre = (shadow: ReturnType<typeof paintShadow>) => {
  const points = covered(shadow);
  return {
    column: points.reduce((total, point) => total + point.column, 0) / points.length - shadow.originX,
    row: points.reduce((total, point) => total + point.row, 0) / points.length - shadow.originY,
  };
};

describe("paintShadow", () => {
  test("covers the feet, in hard pixels", () => {
    const shadow = paintShadow(0, 18);
    expect(shadow.pixels[(shadow.originY * shadow.width + shadow.originX) * 4 + 3]).toBe(255);
    for (let index = 3; index < shadow.pixels.length; index += 4) {
      expect([0, 255]).toContain(shadow.pixels[index] ?? -1);
    }
  });

  test("a longer shadow covers more ground and a blob sits round the feet", () => {
    expect(covered(paintShadow(0, 38)).length).toBeGreaterThan(covered(paintShadow(0, 18)).length);
    expect(covered(paintShadow(0, 18)).length).toBeGreaterThan(covered(paintShadow(0, 0)).length);
    const blob = centre(paintShadow(0, 0));
    expect(Math.abs(blob.column)).toBeLessThan(0.5);
    expect(Math.abs(blob.row)).toBeLessThan(0.5);
  });

  test("lies along its direction on the screen, the ground's depth drawn at half height", () => {
    const east = centre(paintShadow(0, 28));
    expect(east.column).toBeGreaterThan(5);
    expect(Math.abs(east.row)).toBeLessThan(0.5);
    const south = centre(paintShadow(Math.PI / 2, 28));
    expect(south.row).toBeGreaterThan(2);
    expect(Math.abs(south.column)).toBeLessThan(0.5);
    expect(south.row).toBeLessThan(east.column / 2 + 1);
  });
});
