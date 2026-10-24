import { describe, expect, test } from "bun:test";
import { emptyLevels, type Legacy, type Levels, MAX_LEVEL, newLegacy } from "./legacy";
import { STEP } from "./replay";
import {
  CENTRE_X,
  CENTRE_Y,
  type Input,
  MERCY_TIME,
  type MonsterKind,
  NO_INPUT,
  newNight,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  type State,
  step,
} from "./sim";

// A quiet night with the warden at (heroX, heroY) and nothing spawning, so a test places exactly the monsters it wants.
function stage(heroX = CENTRE_X, heroY = CENTRE_Y, legacy = newLegacy()): State {
  const state = newNight(legacy, 1);
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

// a satyr in claw range that strikes the first step it can
function clawer(state: State, offsetX: number, offsetY = 0) {
  const monster = place(state, "satyr", offsetX, offsetY);
  monster.attackCooldown = 0;
  return monster;
}

describe("a monster's blow on the warden", () => {
  test("throws the warden straight away from the attacker, and stuns him a beat", () => {
    const state = stage();
    clawer(state, 20);
    const startX = state.hero.x;
    step(state, STEP, NO_INPUT);
    expect(state.hero.hits).toBe(1);
    expect(state.hero.health).toBe(state.hero.maxHealth - 8);
    // walking is held for the hit-stop, so for a few steps the warden only goes where the blow throws him
    for (let count = 0; count < 3; count++) step(state, STEP, { ...NO_INPUT, moveY: 1 });
    expect(state.hero.y).toBe(CENTRE_Y);
    expect(state.hero.x).toBeLessThan(startX);
    for (let count = 0; count < 40; count++) step(state, STEP, NO_INPUT);
    expect(startX - state.hero.x).toBeGreaterThan(20); // away from the attacker on the east
    expect(state.hero.y).toBeCloseTo(CENTRE_Y, 5);
    step(state, STEP, { ...NO_INPUT, moveY: 1 });
    expect(state.hero.y).toBeGreaterThan(CENTRE_Y); // and he walks again afterwards
  });

  test("throws him along the diagonal when the attacker stands off it", () => {
    const state = stage();
    clawer(state, 12, 6); // south-east on the ground
    run(state, 40);
    expect(state.hero.x).toBeLessThan(CENTRE_X - 10);
    expect(state.hero.y).toBeLessThan(CENTRE_Y - 3);
  });

  test("never throws him off the plaza", () => {
    const state = stage(CENTRE_X + PLAZA_HALF_WIDTH * 0.9, CENTRE_Y);
    clawer(state, -20); // the warden stands at the edge, the attacker on the plaza side
    expect(plazaRim(state.hero.x, state.hero.y)).toBeLessThan(0.92);
    let outermost = 0;
    for (let count = 0; count < 60; count++) {
      step(state, STEP, NO_INPUT);
      outermost = Math.max(outermost, plazaRim(state.hero.x, state.hero.y));
    }
    expect(state.hero.hits).toBe(1);
    expect(outermost).toBeLessThanOrEqual(0.92 + 1e-9);
  });

  test("mercy frames stop a second blow inside the window, and not after it", () => {
    const state = stage();
    clawer(state, 20);
    clawer(state, 18);
    step(state, STEP, NO_INPUT);
    expect(state.hero.hits).toBe(1);
    const health = state.hero.health;
    // the second one is still in reach (put the warden back where the blow found him), and waits
    const startX = state.hero.x;
    for (let count = 0; count < Math.floor((MERCY_TIME - 0.1) / STEP); count++) {
      state.hero.x = startX;
      step(state, STEP, NO_INPUT);
    }
    expect(state.hero.hits).toBe(1);
    expect(state.hero.health).toBe(health);
    for (let count = 0; count < Math.ceil(0.2 / STEP); count++) {
      state.hero.x = startX;
      step(state, STEP, NO_INPUT);
    }
    expect(state.hero.hits).toBe(2);
    expect(state.hero.health).toBe(health - 8);
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

// A legacy with the named upgrades at their top level.
function withLevels(levels: Partial<Levels>, trait: Legacy["heir"]["trait"] = "stout"): Legacy {
  const legacy = newLegacy();
  legacy.heir = { ...legacy.heir, trait };
  legacy.levels = { ...emptyLevels(), ...levels };
  return legacy;
}

describe("the upgrades", () => {
  test("heavy blows throw a monster back further", () => {
    const farthestPush = (legacy: Legacy) => {
      const state = stage(CENTRE_X, CENTRE_Y, legacy);
      const cyclops = place(state, "cyclops", 40);
      step(state, STEP, { ...NO_INPUT, melee: true, moveX: 1 });
      while (cyclops.health === 3) step(state, STEP, NO_INPUT);
      const atHit = cyclops.x;
      let farthest = atHit;
      for (let count = 0; count < 60; count++) {
        step(state, STEP, NO_INPUT);
        farthest = Math.max(farthest, cyclops.x);
      }
      return farthest - atHit;
    };
    const base = farthestPush(withLevels({}));
    expect(farthestPush(withLevels({ knockback: MAX_LEVEL }))).toBeGreaterThan(base * 1.6);
  });

  test("heavy blows also throw back what a shot hits", () => {
    const shotPush = (legacy: Legacy) => {
      const state = stage(CENTRE_X, CENTRE_Y, legacy);
      const cyclops = place(state, "cyclops", 150);
      step(state, STEP, { ...NO_INPUT, ranged: true, aim: { x: cyclops.x, y: cyclops.y - 32 } });
      for (let count = 0; count < 120 && cyclops.health === 3; count++) step(state, STEP, NO_INPUT);
      return cyclops.knockX;
    };
    expect(shotPush(withLevels({ knockback: MAX_LEVEL }))).toBeGreaterThan(shotPush(withLevels({})) * 1.6);
  });

  test("the oil seeker raises the chance that the slain leave oil", () => {
    const oilFromSlain = (legacy: Legacy) => {
      const state = stage(CENTRE_X, CENTRE_Y, legacy);
      for (let count = 0; count < 400; count++) place(state, "satyr", 40);
      run(state, 20, { ...NO_INPUT, melee: true, moveX: 1 });
      expect(state.stats.kills).toBe(400);
      return state.oilEarned / state.stats.kills;
    };
    const base = oilFromSlain(withLevels({}));
    expect(base).toBeGreaterThan(0.2);
    expect(base).toBeLessThan(0.4);
    const seeker = oilFromSlain(withLevels({ seeker: MAX_LEVEL }));
    expect(seeker).toBeGreaterThan(0.5);
    expect(seeker).toBeLessThan(0.7);
  });

  test("a night's oil comes from its seed alone", () => {
    const oilOfNight = () => {
      const state = stage();
      for (let count = 0; count < 50; count++) place(state, "satyr", 40);
      run(state, 20, { ...NO_INPUT, melee: true, moveX: 1 });
      return state.oilEarned;
    };
    expect(oilOfNight()).toBe(oilOfNight());
  });

  test("quick tinder relights a lamp sooner, and stacks with the Lamplighter trait", () => {
    const stepsToRelight = (legacy: Legacy) => {
      const state = stage(CENTRE_X, CENTRE_Y, legacy);
      const lamp = state.lamps[0];
      if (!lamp) throw new Error("no lamp");
      lamp.lit = false;
      state.hero.x = lamp.x;
      state.hero.y = lamp.y;
      let steps = 0;
      while (!lamp.lit && steps < 600) {
        step(state, STEP, NO_INPUT);
        steps++;
      }
      return steps;
    };
    const base = stepsToRelight(withLevels({}));
    const tinder = stepsToRelight(withLevels({ tinder: MAX_LEVEL }));
    const lamplighter = stepsToRelight(withLevels({}, "lamplighter"));
    const both = stepsToRelight(withLevels({ tinder: MAX_LEVEL }, "lamplighter"));
    expect(tinder).toBeLessThan(base * 0.6);
    expect(lamplighter).toBeLessThan(base * 0.6);
    expect(both).toBeLessThan(Math.min(tinder, lamplighter) * 0.6);
  });

  test("light sandals make the warden walk further, on top of the Swift trait", () => {
    const distanceWalked = (legacy: Legacy) => {
      const state = stage(CENTRE_X - 200, CENTRE_Y, legacy);
      const startX = state.hero.x;
      for (let count = 0; count < 60; count++) step(state, STEP, { ...NO_INPUT, moveX: 1 });
      return state.hero.x - startX;
    };
    const base = distanceWalked(withLevels({}));
    expect(distanceWalked(withLevels({ stride: MAX_LEVEL }))).toBeGreaterThan(base * 1.2);
    expect(distanceWalked(withLevels({}, "swift"))).toBeGreaterThan(base * 1.2);
    expect(distanceWalked(withLevels({ stride: MAX_LEVEL }, "swift"))).toBeGreaterThan(
      distanceWalked(withLevels({}, "swift")) * 1.2,
    );
  });

  test("the heart and the thick hide each add to the warden's health", () => {
    const health = (levels: Partial<Levels>) => newNight(withLevels(levels), 1).hero.maxHealth;
    expect(health({ heart: 2 })).toBe(health({}) + 40);
    expect(health({ hide: 2 })).toBe(health({}) + 60);
    expect(health({ heart: 2, hide: 2 })).toBe(health({}) + 100);
  });

  test("the blade, the quiver and the wick still work", () => {
    const base = newNight(withLevels({}), 1).rules;
    const upgraded = newNight(withLevels({ blade: 2, quiver: 2, wick: 2 }), 1).rules;
    expect(upgraded.meleeReach).toBe(base.meleeReach + 20);
    expect(upgraded.meleeDamage).toBe(base.meleeDamage + 1);
    expect(upgraded.shotCooldown).toBeLessThan(base.shotCooldown);
    expect(upgraded.spread).toBe(true);
    expect(upgraded.lightRadius).toBe(base.lightRadius + 24);
    expect(upgraded.snuffMultiplier).toBeGreaterThan(base.snuffMultiplier);
  });
});
