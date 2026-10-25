// Where a sprite's pixels are, measured from the picture: the one place the scene learns how much room a prop takes.
// A sprite is a 128 px frame drawn with its base on the ground at an anchor (x in the middle, y the fraction of the
// frame that assets.ts ANCHOR_Y gives), so every extent here is an offset in pixels from that anchor, y down.

export type Point = readonly [x: number, y: number];
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface SpriteExtents {
  // The base: the convex hull of every painted pixel (the sprite's own shadow included, so none of it is drawn off the
  // ground the prop stands on) in the `band` rows above the anchor and in all rows below it, as the corners of those
  // pixels; and `solid`, the same for the opaque pixels only, which is the room the prop itself takes.
  hull: readonly Point[];
  solid: readonly Point[];
  band: number; // how many rows above the anchor the base takes
  // The whole sprite: the box of its opaque pixels, for what it can hide.
  sprite: Box;
}

export const SPRITE_SIZE = 128;
export const SOLID_ALPHA = 200; // the sprites' painted shadows are 150; the pixels of the prop itself are 255
const BASE_BAND = 28; // rows above the anchor that count as a sprite's base: its feet, platform or hull
// the sprites whose base is slimmer than that: a wall is a slab and an olive a trunk, and the rows above are their body
const SLIM_BASES: Readonly<Record<string, number>> = { wall: 14, olive: 16 };
export const baseBandOf = (key: string) => SLIM_BASES[key] ?? BASE_BAND;

const anchorRowOf = (anchorY: number) => Math.round(anchorY * SPRITE_SIZE);

// the convex hull of points (Andrew's monotone chain), counter-clockwise on a y-down screen, without collinear points
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const cross = (origin: Point, first: Point, second: Point) =>
    (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
  const chain = (ordered: readonly Point[]) => {
    const half: Point[] = [];
    for (const point of ordered) {
      while (half.length >= 2) {
        const before = half[half.length - 2];
        const last = half[half.length - 1];
        if (!before || !last || cross(before, last, point) > 0) {
          break;
        }
        half.pop();
      }
      half.push(point);
    }
    half.pop();
    return half;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

// Measures an RGBA picture of SPRITE_SIZE square (premultiplied or not: only alpha is read) drawn at `anchorY`.
export function measureSprite(rgba: ArrayLike<number>, anchorY: number, band = BASE_BAND): SpriteExtents {
  const anchorRow = anchorRowOf(anchorY);
  const painted = new Map<number, Point>();
  const solid = new Map<number, Point>();
  const sprite: Box = {
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
  for (let row = 0; row < SPRITE_SIZE; row++) {
    for (let column = 0; column < SPRITE_SIZE; column++) {
      const alpha = rgba[(row * SPRITE_SIZE + column) * 4 + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const x = column - SPRITE_SIZE / 2;
      const y = row - anchorRow;
      if (alpha >= SOLID_ALPHA) {
        sprite.left = Math.min(sprite.left, x);
        sprite.right = Math.max(sprite.right, x + 1);
        sprite.top = Math.min(sprite.top, y);
        sprite.bottom = Math.max(sprite.bottom, y + 1);
      }
      if (y < -band) {
        continue;
      }
      for (const [cornerX, cornerY] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ] as const) {
        painted.set(cornerY * 1000 + cornerX, [cornerX, cornerY]);
        if (alpha >= SOLID_ALPHA) {
          solid.set(cornerY * 1000 + cornerX, [cornerX, cornerY]);
        }
      }
    }
  }
  return { hull: convexHull([...painted.values()]), solid: convexHull([...solid.values()]), band, sprite };
}
