// The plaza's outline in canvas pixels, shared by everything painted around it (light.ts, water.ts): its top face, the
// side walls under its two front edges, and how far a point of sea lies from the stone.
import { CENTRE_X, CENTRE_Y, PLAZA_HALF_HEIGHT, PLAZA_HALF_WIDTH } from "../game/sim";

export const PLAZA_WALL = 14; // the plaza's side walls, drawn under its front edges by drawGround

// the plaza's top face, tested at the pixel centre
export const onPlaza = (x: number, y: number) =>
  Math.abs(x + 0.5 - CENTRE_X) / PLAZA_HALF_WIDTH + Math.abs(y + 0.5 - CENTRE_Y) / PLAZA_HALF_HEIGHT <= 1;
// a plaza pixel on its rim, where the stone meets the wall or the sea
export const onPlazaRim = (x: number, y: number) => onPlaza(x, y) && (!onPlaza(x, y + 1) || !onPlaza(x, y - 1));
// the y of the plaza's front rim above x, where its side wall starts
export const frontRimY = (x: number) => CENTRE_Y + PLAZA_HALF_HEIGHT * (1 - Math.abs(x - CENTRE_X) / PLAZA_HALF_WIDTH);
const onWall = (x: number, y: number) =>
  Math.abs(x - CENTRE_X) <= PLAZA_HALF_WIDTH && y > frontRimY(x) && y <= frontRimY(x) + PLAZA_WALL;
export const onSea = (x: number, y: number) => !onPlaza(x, y) && !onWall(x, y);

// How far the point (x, y) lies outside the plaza and its walls, in iso steps: one pixel vertically or two
// horizontally per step, so the distance is the same along every 2:1 edge and around the corners. Negative inside.
export function shoreDistance(x: number, y: number): number {
  const below = y < CENTRE_Y ? CENTRE_Y - y : Math.max(0, y - CENTRE_Y - PLAZA_WALL);
  return Math.abs(x - CENTRE_X) / 2 + below - PLAZA_HALF_HEIGHT;
}
