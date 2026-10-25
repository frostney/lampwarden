import { describe, expect, test } from "bun:test";

import { CENTRE_X } from "../game/sim";
import { heroView } from "./assets";
import { monsterOctant } from "./monster-heading";

const FAR_HERO = { x: 900, y: 900 };
const monster = (x: number, y: number) => ({ x, y, stun: 0, snuff: 0, knockX: 0, knockY: 0 });

/** Walks a monster along a heading on the ground (y at half the ground's rate, as the sim moves it), a pixel at a time. */
function walk(
  body: ReturnType<typeof monster>,
  groundX: number,
  groundY: number,
  pixels: number,
  hero = FAR_HERO,
): number {
  let octant = 0;
  for (let step = 0; step < pixels; step++) {
    body.x += groundX;
    body.y += groundY / 2;
    octant = monsterOctant(body, hero);
  }
  return octant;
}

describe("which way a monster faces", () => {
  test("a monster that has not moved faces the plaza's centre, as its one sprite did", () => {
    expect(heroView(monsterOctant(monster(CENTRE_X - 100, 300), FAR_HERO))).toEqual({ drawn: "se", mirrored: false });
    expect(heroView(monsterOctant(monster(CENTRE_X + 100, 300), FAR_HERO))).toEqual({ drawn: "se", mirrored: true });
  });

  test("faces the way it has moved, each of the eight ways", () => {
    const along = [
      [1, 0],
      [Math.SQRT1_2, Math.SQRT1_2],
      [0, 1],
      [-Math.SQRT1_2, Math.SQRT1_2],
      [-1, 0],
      [-Math.SQRT1_2, -Math.SQRT1_2],
      [0, -1],
      [Math.SQRT1_2, -Math.SQRT1_2],
    ] as const;
    along.forEach(([groundX, groundY], octant) => {
      expect(walk(monster(480, 300), groundX, groundY, 40)).toBe(octant);
    });
  });

  test("is not turned by the sideways wobble of its walk", () => {
    const body = monster(300, 300);
    const octants = new Set<number>();
    for (let step = 0; step < 400; step++) {
      // south-east at 45 degrees, with a lateral swing of a few degrees either way
      const swing = Math.sin(step / 7) * 0.12;
      body.x += Math.cos(Math.PI / 4 + swing);
      body.y += Math.sin(Math.PI / 4 + swing) / 2;
      octants.add(monsterOctant(body, FAR_HERO));
    }
    expect([...octants]).toEqual([1]);
  });

  test("turns to the next octant only once it is well past the edge of the one it faces", () => {
    const body = monster(300, 300);
    expect(walk(body, 1, 0, 30)).toBe(0);
    // 30 degrees round, not yet: an octant is 22.5 degrees either side of its middle, and it turns past 35
    const slightly = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
    const [nearX = 0, nearY = 0] = slightly(30);
    expect(walk(body, nearX, nearY, 40)).toBe(0);
    const [farX = 0, farY = 0] = slightly(40);
    expect(walk(body, farX, farY, 40)).toBe(1);
  });

  test("a monster put far from where it was, not walked there, faces the centre of the plaza again", () => {
    const body = monster(300, 300);
    expect(walk(body, 0, -1, 20)).toBe(6);
    body.x = 800;
    body.y = 450;
    expect(monsterOctant(body, FAR_HERO)).toBe(3);
    body.x = 100;
    expect(monsterOctant(body, FAR_HERO)).toBe(1);
  });

  test("keeps its heading while a blow throws it or holds it", () => {
    const body = monster(300, 300);
    expect(walk(body, 1, 0, 30)).toBe(0);
    body.knockX = -200;
    body.knockY = 0;
    // thrown back along the way it came: it still faces the way it was going
    expect(walk(body, -1, 0, 30)).toBe(0);
    body.knockX = 0;
    body.stun = 0.3;
    expect(walk(body, 0, 1, 30)).toBe(0);
  });

  test("faces the warden when it stands at his side to claw him, and not when it claws a lamp", () => {
    const next = monster(300, 300);
    expect(monsterOctant(next, { x: 300, y: 310 })).toBe(2);
    const lamp = { ...monster(300, 300), snuff: 0.2 };
    // it keeps the way it faced before: towards the centre of the plaza
    expect(monsterOctant(lamp, { x: 300, y: 310 })).toBe(1);
  });
});
