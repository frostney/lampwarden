import { describe, expect, test } from "bun:test";
import { isCharacterKey, paintedShadowPixels, rimPixels, withoutShadowPixels } from "./rim";

const SIZE = 7;
// a 3x3 opaque block at columns 2-4, rows 2-4 of a 7x7 sprite, with a translucent shadow pixel beside it
function sprite() {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const set = (column: number, row: number, alpha: number) => {
    const index = (row * SIZE + column) * 4;
    pixels.set([90, 60, 40, alpha], index);
  };
  for (let row = 2; row <= 4; row++) for (let column = 2; column <= 4; column++) set(column, row, 255);
  set(5, 5, 120);
  return pixels;
}
const alphaAt = (pixels: Uint8Array, column: number, row: number) => pixels[(row * SIZE + column) * 4 + 3];

describe("withoutShadowPixels", () => {
  test("drops the translucent shadow and keeps the figure opaque", () => {
    const clean = withoutShadowPixels(sprite());
    expect(alphaAt(clean, 5, 5)).toBe(0);
    expect(alphaAt(clean, 3, 3)).toBe(255);
    expect(clean.slice((3 * SIZE + 3) * 4, (3 * SIZE + 3) * 4 + 3)).toEqual(new Uint8Array([90, 60, 40]));
  });
});

describe("paintedShadowPixels", () => {
  test("keeps only the translucent shadow, premultiplied, so it and the clean sprite make up the whole", () => {
    const shadow = paintedShadowPixels(sprite());
    expect(alphaAt(shadow, 3, 3)).toBe(0);
    expect(alphaAt(shadow, 5, 5)).toBe(120);
    expect(shadow.slice((5 * SIZE + 5) * 4, (5 * SIZE + 5) * 4 + 3)).toEqual(
      new Uint8Array([Math.round((90 * 120) / 255), Math.round((60 * 120) / 255), Math.round((40 * 120) / 255)]),
    );
    const clean = withoutShadowPixels(sprite());
    for (let column = 0; column < SIZE; column++)
      for (let row = 0; row < SIZE; row++)
        expect((alphaAt(shadow, column, row) ?? 0) > 0 && (alphaAt(clean, column, row) ?? 0) > 0).toBe(false);
  });
});

describe("rimPixels", () => {
  const rimAt = (octant: number) => {
    const rim = rimPixels(withoutShadowPixels(sprite()), SIZE, SIZE, octant);
    const edge: string[] = [];
    for (let row = 0; row < SIZE; row++)
      for (let column = 0; column < SIZE; column++)
        if (alphaAt(rim, column, row) === 255) edge.push(`${column},${row}`);
    return edge;
  };

  test("light from the east lights the figure's eastern edge only", () => {
    expect(rimAt(0)).toEqual(["4,2", "4,3", "4,4"]);
  });

  test("light from the north lights its top edge, and a diagonal lights the edge and the corner", () => {
    expect(rimAt(6)).toEqual(["2,2", "3,2", "4,2"]);
    expect(rimAt(7)).toContain("4,2");
    expect(rimAt(7)).toHaveLength(5);
  });

  test("warms the sprite's own pixel and leaves the shadow out", () => {
    const rim = rimPixels(withoutShadowPixels(sprite()), SIZE, SIZE, 0);
    const index = (3 * SIZE + 4) * 4;
    expect(rim[index]).toBeGreaterThan(90);
    expect(rim[index + 2]).toBeGreaterThan(40);
    expect(alphaAt(rim, 5, 5)).toBe(0);
  });
});

describe("isCharacterKey", () => {
  test("picks the hero's frames and the monsters, not the buildings", () => {
    expect(["satyr", "cyclops", "harpy", "hero/male_idle1"].every(isCharacterKey)).toBe(true);
    expect(["temple", "lamp-lit", "wall", "trireme"].some(isCharacterKey)).toBe(false);
    // the warden's atlas is only read, never stripped of a shadow: its frames are cut out of it
    expect(isCharacterKey("hero-atlas/male")).toBe(false);
  });
});
