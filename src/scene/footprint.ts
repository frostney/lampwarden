// Shapes on the ground, for the decor placer: the convex base of a prop and how near it is to a point, a segment or
// another base. The ground is the plaza seen from above: a point (x, y) of the screen is (x, 2y) here, so a distance
// is a ground distance, the way the sim counts them (sim.ts ground()).
import type { Box, Point } from "./extent";

type Polygon = readonly Point[];
export interface Shape {
  points: Polygon; // convex, in ground coordinates
  box: Box; // the bounds of the points, to rule out what is far away without a closer look
}

export const toGround = ([x, y]: Point): Point => [x, 2 * y];

// a sprite's base hull (pixels from its anchor) with the anchor at the screen point (x, y)
export function groundShape(hull: readonly Point[], x: number, y: number): Shape {
  const points = hull.map(([hullX, hullY]): Point => [x + hullX, 2 * (y + hullY)]);
  const box: Box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const [pointX, pointY] of points) {
    box.left = Math.min(box.left, pointX);
    box.right = Math.max(box.right, pointX);
    box.top = Math.min(box.top, pointY);
    box.bottom = Math.max(box.bottom, pointY);
  }
  return { points, box };
}

const cross = (origin: Point, first: Point, second: Point) =>
  (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);

function pointToSegment(point: Point, start: Point, end: Point): number {
  const lengthSquared = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1])) / lengthSquared,
          ),
        );
  return Math.hypot(
    point[0] - (start[0] + (end[0] - start[0]) * along),
    point[1] - (start[1] + (end[1] - start[1]) * along),
  );
}

// whether two segments cross at a point strictly inside both: touching ones have a gap of 0 already
function segmentsCross(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const firstToStart = cross(firstStart, firstEnd, secondStart);
  const firstToEnd = cross(firstStart, firstEnd, secondEnd);
  const secondToStart = cross(secondStart, secondEnd, firstStart);
  const secondToEnd = cross(secondStart, secondEnd, firstEnd);
  return firstToStart * firstToEnd < 0 && secondToStart * secondToEnd < 0;
}

function inside(polygon: Polygon, point: Point): boolean {
  let positive = false;
  let negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) continue;
    const side = cross(start, end, point);
    positive ||= side > 0;
    negative ||= side < 0;
  }
  return !(positive && negative);
}

const edgesOf = (polygon: Polygon): [Point, Point][] =>
  polygon.flatMap((start, index): [Point, Point][] => {
    const end = polygon[(index + 1) % polygon.length];
    return end ? [[start, end]] : [];
  });

// the gap between a segment (a point when both ends are one) and a convex polygon: 0 when they touch
function segmentGap(start: Point, end: Point, polygon: Polygon): number {
  if (inside(polygon, start)) return 0;
  let gap = Number.POSITIVE_INFINITY;
  for (const [edgeStart, edgeEnd] of edgesOf(polygon)) {
    if (segmentsCross(start, end, edgeStart, edgeEnd)) return 0;
    gap = Math.min(gap, pointToSegment(start, edgeStart, edgeEnd), pointToSegment(end, edgeStart, edgeEnd));
    gap = Math.min(gap, pointToSegment(edgeStart, start, end));
  }
  return gap;
}

// the gap between two convex polygons: 0 when they touch or overlap
function polygonGap(first: Polygon, second: Polygon): number {
  const [vertex] = second;
  if (vertex && inside(first, vertex)) return 0;
  let gap = Number.POSITIVE_INFINITY;
  for (const [start, end] of edgesOf(first)) {
    const apart = segmentGap(start, end, second);
    if (apart === 0) return 0;
    gap = Math.min(gap, apart);
  }
  for (const [start, end] of edgesOf(second)) gap = Math.min(gap, segmentGap(start, end, first));
  return gap;
}

const farFromBox = (box: Box, left: number, right: number, top: number, bottom: number, limit: number) =>
  left > box.right + limit || right < box.left - limit || top > box.bottom + limit || bottom < box.top - limit;

// whether the shape is nearer than `limit` ground px to a ground point, or to another shape
export const nearPoint = (shape: Shape, point: Point, limit: number) =>
  !farFromBox(shape.box, point[0], point[0], point[1], point[1], limit) &&
  segmentGap(point, point, shape.points) < limit;
export const nearShape = (shape: Shape, other: Shape, limit: number) =>
  !farFromBox(shape.box, other.box.left, other.box.right, other.box.top, other.box.bottom, limit) &&
  polygonGap(shape.points, other.points) < limit;

// the screen boxes of sprites, for what one can hide of another
export const boxAt = (box: Box, x: number, y: number): Box => ({
  left: x + box.left,
  right: x + box.right,
  top: y + box.top,
  bottom: y + box.bottom,
});
// whether two boxes are nearer than `gap` px (overlapping, when it is negative)
export const boxesNear = (first: Box, second: Box, gap: number) =>
  first.left < second.right + gap &&
  second.left < first.right + gap &&
  first.top < second.bottom + gap &&
  second.top < first.bottom + gap;
