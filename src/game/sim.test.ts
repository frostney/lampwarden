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
  nextTide,
  nightLength,
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

describe("the warden's facing", () => {
  const HEADINGS: [string, number, number, number][] = [
    ["east", 1, 0, 0],
    ["south-east", 1, 1, 1],
    ["south", 0, 1, 2],
    ["south-west", -1, 1, 3],
    ["west", -1, 0, 4],
    ["north-west", -1, -1, 5],
    ["north", 0, -1, 6],
    ["north-east", 1, -1, 7],
  ];
  test.each(HEADINGS)("walking %s faces octant %i", (_name, moveX, moveY, octant) => {
    const state = stage();
    step(state, STEP, { ...NO_INPUT, moveX, moveY });
    expect(state.hero.octant).toBe(octant);
  });

  test("a stick near the edge between two directions does not flicker him between them", () => {
    const state = stage();
    const heading = (degrees: number): Input => ({
      ...NO_INPUT,
      moveX: Math.cos((degrees * Math.PI) / 180),
      moveY: Math.sin((degrees * Math.PI) / 180),
    });
    step(state, STEP, heading(0));
    expect(state.hero.octant).toBe(0);
    for (const degrees of [24, 21, 25, 22.6, 27]) {
      step(state, STEP, heading(degrees)); // nearer the south-east, but not yet clearly past the edge
      expect(state.hero.octant).toBe(0);
    }
    step(state, STEP, heading(40));
    expect(state.hero.octant).toBe(1);
    step(state, STEP, heading(20)); // and back the same way
    expect(state.hero.octant).toBe(1);
    step(state, STEP, heading(10));
    expect(state.hero.octant).toBe(0);
  });

  test("the swing is centred on the direction he faces, not on the stick's exact heading", () => {
    // the stick is held 22 degrees south of east: he faces east, and the arc is centred on east
    const heading: Input = { ...NO_INPUT, melee: true, moveX: 1, moveY: 0.4 };
    const north = stage();
    const northSide = place(north, "cyclops", 40, -23); // 49 degrees north of east on the ground: inside an arc centred on east
    run(north, 20, heading);
    expect(northSide.health).toBe(1);
    const south = stage();
    const southSide = place(south, "cyclops", 20, 30); // 71 degrees south of east: outside it, though inside one centred on the stick
    run(south, 20, heading);
    expect(southSide.health).toBe(3);
  });

  test("shooting at a mouse aim faces the aim, a shot with none keeps the way he faces", () => {
    const aimed = stage();
    // up and to the right of the warden's chest by the same amount on the ground: north-east
    step(aimed, STEP, { ...NO_INPUT, ranged: true, aim: { x: aimed.hero.x + 80, y: aimed.hero.y - 40 - 40 } });
    expect(aimed.hero.octant).toBe(7);
    const keyed = stage();
    step(keyed, STEP, { ...NO_INPUT, moveX: -1 });
    step(keyed, STEP, { ...NO_INPUT, ranged: true });
    expect(keyed.hero.octant).toBe(4);
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

  // the ground's y is twice the screen's, so the way a facing runs on the ground has half its slope on the screen
  const FACINGS: [string, number, number, number, number][] = [
    ["east", 1, 0, 1, 0],
    ["south-east", 1, 1, 1, 0.5],
    ["south", 0, 1, 0, 1],
    ["south-west", -1, 1, -1, 0.5],
    ["west", -1, 0, -1, 0],
    ["north-west", -1, -1, -1, -0.5],
    ["north", 0, -1, 0, -1],
    ["north-east", 1, -1, 1, -0.5],
  ];
  test.each(FACINGS)(
    "with no mouse aim a shot flies the way he faces on the ground (%s)",
    (_name, moveX, moveY, screenX, screenY) => {
      const state = stage();
      step(state, STEP, { ...NO_INPUT, moveX, moveY }); // turn that way...
      step(state, STEP, NO_INPUT); // ...and stand there
      for (let count = 0; count < 5 && state.hero.animation === "walk"; count++) step(state, STEP, NO_INPUT);
      step(state, STEP, { ...NO_INPUT, ranged: true });
      for (let count = 0; count < 120 && state.shots.length === 0; count++) step(state, STEP, NO_INPUT);
      const [shot] = state.shots;
      if (!shot) throw new Error("no shot fired");
      const speed = Math.hypot(shot.velocityX, shot.velocityY);
      const wanted = Math.hypot(screenX, screenY);
      expect(shot.velocityX / speed).toBeCloseTo(screenX / wanted, 5);
      expect(shot.velocityY / speed).toBeCloseTo(screenY / wanted, 5);
    },
  );

  test("a mouse aim still sends the shot at the aim, whatever he faces", () => {
    const state = stage();
    step(state, STEP, { ...NO_INPUT, ranged: true, aim: { x: state.hero.x + 100, y: state.hero.y - 40 + 30 } });
    for (let count = 0; count < 120 && state.shots.length === 0; count++) step(state, STEP, NO_INPUT);
    const [shot] = state.shots;
    if (!shot) throw new Error("no shot fired");
    expect(shot.velocityY / shot.velocityX).toBeCloseTo(0.3, 5);
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
    expect(base).toBeGreaterThan(0.4);
    expect(base).toBeLessThan(0.6);
    const seeker = oilFromSlain(withLevels({ seeker: MAX_LEVEL }));
    expect(seeker).toBeGreaterThan(0.7);
    expect(seeker).toBeLessThan(0.9);
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

describe("the length of a night", () => {
  test("is 28 s on night 1 and 6 s longer each night, up to 64 s from night 7", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(nightLength)).toEqual([28, 34, 40, 46, 52, 58, 64]);
    expect(nightLength(8)).toBe(64);
    expect(nightLength(50)).toBe(64);
    expect(nightLength(Number.POSITIVE_INFINITY)).toBe(64);
  });

  test("a night starts with that length, and dawn comes when it has passed", () => {
    for (const night of [1, 4, 9]) {
      const legacy = newLegacy(1);
      legacy.night = night;
      const state = newNight(legacy, 1);
      expect(state.length).toBe(nightLength(night));
      state.hero.health = Number.POSITIVE_INFINITY;
      for (const lamp of state.lamps) lamp.lit = true;
      while (!state.outcome) {
        step(state, STEP, NO_INPUT);
        for (const lamp of state.lamps) lamp.lit = true; // lamps never fall, so the night runs its length
      }
      expect(state.outcome).toBe("dawn");
      expect(state.elapsed).toBeGreaterThanOrEqual(nightLength(night));
      expect(state.elapsed).toBeLessThan(nightLength(night) + 0.1);
    }
  });
});

describe("the pace of the sea", () => {
  // The seconds between the first spawns of a night, from a warden who cannot be hurt and stands still.
  function spawnGaps(night: number, tide = 1): number[] {
    const legacy = newLegacy(1);
    legacy.night = night;
    legacy.tide = tide;
    const state = newNight(legacy, 1);
    state.hero.health = Number.POSITIVE_INFINITY;
    const seen = new Set<number>();
    const times: number[] = [];
    while (times.length < 4 && !state.outcome) {
      step(state, STEP, NO_INPUT);
      for (const monster of state.monsters)
        if (!seen.has(monster.id)) {
          seen.add(monster.id);
          times.push(state.elapsed);
        }
    }
    return times.slice(1).map((time, index) => time - (times[index] ?? 0));
  }
  const gap = (night: number, tide = 1) => spawnGaps(night, tide).reduce((total, next) => total + next, 0) / 3;

  test("the first monster rises a second into every night, and night 1 sends one every 2.6 s after it", () => {
    for (const night of [1, 4, 8]) {
      const legacy = newLegacy(1);
      legacy.night = night;
      const state = newNight(legacy, 1);
      state.hero.health = Number.POSITIVE_INFINITY;
      let first: number | null = null;
      while (first === null && !state.outcome) {
        step(state, STEP, NO_INPUT);
        if (state.monsters.length > 0) first = state.elapsed;
      }
      expect(first).toBeCloseTo(1, 1);
    }
    expect(gap(1)).toBeCloseTo(2.6, 1);
  });

  test("each night sends monsters faster than the last", () => {
    for (let night = 2; night <= 7; night++) expect(gap(night)).toBeLessThan(gap(night - 1));
  });

  test("the first three nights are gentle: the third is less than a quarter quicker than the first", () => {
    expect(gap(3)).toBeGreaterThan(gap(1) * 0.75);
    expect(gap(2)).toBeGreaterThan(gap(1) * 0.85);
  });

  test("from the fourth night the sea quickens fast: the fourth is over 15% quicker than the third, the seventh more than twice as quick as the first", () => {
    expect(gap(4)).toBeLessThan(gap(3) * 0.85);
    expect(gap(7)).toBeLessThan(gap(1) * 0.45);
  });

  test("a higher tide sends them faster in proportion", () => {
    expect(gap(2, 1.5)).toBeCloseTo(gap(2) / 1.5, 1);
  });
});

describe("the tide after a night", () => {
  // A night that ended at dawn with the lamps and the warden's health kept, killing `kills` monsters in 40 s.
  function cleanDawn(night: number, kills: number): State {
    const legacy = newLegacy(1);
    legacy.night = night;
    const state = newNight(legacy, 1);
    state.outcome = "dawn";
    state.stats.kills = kills;
    state.stats.time = 40;
    return state;
  }

  test("a clean dawn raises it, and a quick warden's raises it further", () => {
    expect(nextTide(1, cleanDawn(3, 10))).toBeGreaterThan(1);
    expect(nextTide(1, cleanDawn(3, 25))).toBeGreaterThan(nextTide(1, cleanDawn(3, 10)));
  });

  test("the first two nights raise it less, while the warden is still learning", () => {
    for (const kills of [10, 25]) {
      expect(nextTide(1, cleanDawn(2, kills))).toBeGreaterThan(1);
      expect(nextTide(1, cleanDawn(2, kills))).toBeLessThan(nextTide(1, cleanDawn(3, kills)));
    }
  });

  test("the kill rate is kills a minute however short the night: 6 kills in 16 s is fast, 4 is not", () => {
    const shortDawn = (kills: number) => {
      const state = cleanDawn(1, kills);
      state.stats.time = 16;
      return state;
    };
    expect(nextTide(1, shortDawn(6))).toBeGreaterThan(nextTide(1, shortDawn(4))); // 22.5 a minute against 15
    expect(nextTide(1, shortDawn(4))).toBeGreaterThan(1);
  });

  test("a night lost eases it off, whatever the night", () => {
    for (const night of [1, 4]) {
      const lost = cleanDawn(night, 10);
      lost.outcome = "fallen";
      expect(nextTide(1, lost)).toBeLessThan(1);
    }
  });
});
