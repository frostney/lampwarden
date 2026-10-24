import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { STEP } from "./replay";
import {
  CENTRE_X,
  CENTRE_Y,
  type Input,
  type MonsterKind,
  NO_INPUT,
  newNight,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  type State,
  step,
} from "./sim";

// A quiet night with the warden at (heroX, heroY) and nothing spawning, so a test places exactly the monsters it wants.
function stage(heroX = CENTRE_X, heroY = CENTRE_Y): State {
  const state = newNight(newLegacy(), 1);
  state.spawnTimer = 1e9;
  state.hero.x = heroX;
  state.hero.y = heroY;
  return state;
}
function place(state: State, kind: MonsterKind, offsetX: number, offsetY = 0) {
  state.monsters.push({
    id: state.nextId++,
    kind,
    x: state.hero.x + offsetX,
    y: state.hero.y + offsetY,
    health: kind === "cyclops" ? 3 : 1,
    age: 0,
    wobble: 0,
    snuff: 0,
    attackCooldown: 99, // it does not claw back while the test watches
    hurt: 0,
    stun: 0,
    knockX: 0,
    knockY: 0,
  });
  const monster = state.monsters[state.monsters.length - 1];
  if (!monster) throw new Error("monster not placed");
  return monster;
}
const run = (state: State, steps: number, input: Input = NO_INPUT) => {
  for (let count = 0; count < steps; count++) step(state, STEP, count === 0 ? input : NO_INPUT);
};
const plazaRim = (x: number, y: number) =>
  Math.abs(x - CENTRE_X) / PLAZA_HALF_WIDTH + Math.abs(y - CENTRE_Y) / PLAZA_HALF_HEIGHT;

describe("the melee swing", () => {
  test("hits what is in front of the warden and throws it back", () => {
    const state = stage();
    const cyclops = place(state, "cyclops", 40);
    step(state, STEP, { ...NO_INPUT, melee: true, moveX: 1 });
    while (cyclops.health === 3) step(state, STEP, NO_INPUT);
    expect(cyclops.health).toBe(1);
    expect(state.puffs.some((puff) => puff.kind === "hit")).toBe(true);
    const distanceAtHit = cyclops.x - state.hero.x;
    let farthest = distanceAtHit;
    for (let count = 0; count < 30; count++) {
      step(state, STEP, NO_INPUT);
      farthest = Math.max(farthest, cyclops.x - state.hero.x);
    }
    expect(farthest).toBeGreaterThan(distanceAtHit + 8);
  });

  test("misses what is behind the warden", () => {
    const state = stage();
    const cyclops = place(state, "cyclops", -40);
    run(state, 20, { ...NO_INPUT, melee: true, moveX: 1 });
    expect(cyclops.health).toBe(3);
    expect(state.puffs.some((puff) => puff.kind === "hit")).toBe(false);
  });

  test("turns to the direction held with the strike", () => {
    const state = stage();
    const satyr = place(state, "satyr", -40);
    run(state, 20, { ...NO_INPUT, melee: true, moveX: -1 });
    expect(state.monsters).not.toContain(satyr);
    expect(state.stats.kills).toBe(1);
  });

  test("misses what is just outside the arc, hits what is just inside it", () => {
    // facing right; ground y is doubled, so a screen offset of 17 is 34 on the ground: 40 degrees off the facing
    const inside = stage();
    const near = place(inside, "cyclops", 40, 17);
    run(inside, 20, { ...NO_INPUT, melee: true, moveX: 1 });
    expect(near.health).toBe(1);
    // 100 degrees off the facing
    const outside = stage();
    const far = place(outside, "cyclops", -8, 22);
    run(outside, 20, { ...NO_INPUT, melee: true, moveX: 1 });
    expect(far.health).toBe(3);
  });

  test("a kill leaves the monster's silhouette to fly back along the blow", () => {
    const state = stage();
    place(state, "harpy", 40);
    run(state, 10, { ...NO_INPUT, melee: true, moveX: 1 });
    const kill = state.puffs.find((puff) => puff.kind === "kill");
    expect(kill?.ghost?.monster).toBe("harpy");
    expect(kill?.directionX).toBeGreaterThan(0.9);
  });

  test("a push never carries a monster past the edge of the plaza", () => {
    const state = stage(CENTRE_X + PLAZA_HALF_WIDTH * 0.8, CENTRE_Y);
    const cyclops = place(state, "cyclops", 50);
    const startRim = plazaRim(cyclops.x, cyclops.y);
    expect(startRim).toBeLessThan(0.95);
    step(state, STEP, { ...NO_INPUT, melee: true, moveX: 1 });
    let outermost = startRim;
    for (let count = 0; count < 60; count++) {
      step(state, STEP, NO_INPUT);
      outermost = Math.max(outermost, plazaRim(cyclops.x, cyclops.y));
    }
    expect(cyclops.health).toBe(1);
    expect(outermost).toBeGreaterThan(startRim); // it was thrown...
    expect(outermost).toBeLessThanOrEqual(0.95 + 1e-9); // ...but only as far as the edge
  });
});

describe("shots", () => {
  test("a stone freezes a monster where it lands and throws it back", () => {
    const state = stage();
    const cyclops = place(state, "cyclops", 150);
    step(state, STEP, { ...NO_INPUT, ranged: true, aim: { x: cyclops.x, y: cyclops.y - 32 } });
    for (let count = 0; count < 120 && cyclops.health === 3; count++) step(state, STEP, NO_INPUT);
    expect(cyclops.health).toBe(2);
    expect(cyclops.stun).toBeGreaterThan(0);
    expect(cyclops.knockX).toBeGreaterThan(0);
    expect(state.puffs.some((puff) => puff.kind === "hit")).toBe(true);
  });
});
