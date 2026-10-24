import { describe, expect, test } from "bun:test";
import {
  ARCHETYPES,
  type CreatureStats,
  creatureStats,
  MODIFIER_NAMES,
  type ModifierName,
  type Modifiers,
  statsOf,
} from "./creature";
import { newLegacy } from "./legacy";
import { STEP } from "./replay";
import {
  CENTRE_X,
  CENTRE_Y,
  MONSTER,
  monsterStats,
  type NightCreature,
  NO_INPUT,
  newNight,
  nightCreature,
  type State,
  step,
} from "./sim";

const NEUTRAL: Modifiers = { speed: 0, toughness: 0, bite: 0, snuffing: 0 };
const STRONG: Modifiers = { speed: 1, toughness: 1, bite: 1, snuffing: 1 };
const WEAK: Modifiers = { speed: -1, toughness: -1, bite: -1, snuffing: -1 };

const creatureOf = (archetype: (typeof ARCHETYPES)[number], modifiers: Modifiers = NEUTRAL): NightCreature =>
  nightCreature({ id: `test-${archetype}-creature`, archetype, modifiers, anchorY: 0.8 });

// Every monster of an idle night, with the second it appeared and the health it came with, and the most creatures alive at once
function watchNight(creature: NightCreature | null, seed: number) {
  const legacy = newLegacy(seed);
  legacy.night = 3;
  const state = newNight(legacy, seed, creature);
  const spawned = new Map<number, { kind: string; second: number; health: number }>();
  let mostAlive = 0;
  while (!state.outcome) {
    step(state, STEP, NO_INPUT);
    let alive = 0;
    for (const monster of state.monsters) {
      if (monster.kind === "creature") alive++;
      if (!spawned.has(monster.id))
        spawned.set(monster.id, { kind: monster.kind, second: state.elapsed, health: monster.health });
    }
    mostAlive = Math.max(mostAlive, alive);
  }
  const creatures = [...spawned.values()].filter((monster) => monster.kind === "creature");
  return { state, spawned, creatures, mostAlive };
}

const STAT_NAMES = [
  "speed",
  "health",
  "damage",
  "snuff",
  "oil",
  "fly",
  "recoil",
] as const satisfies (keyof CreatureStats)[];

describe("a creature's modifiers", () => {
  test("each moves its own stat when raised, and no other", () => {
    const moves: Record<ModifierName, keyof CreatureStats> = {
      speed: "speed",
      toughness: "health",
      bite: "damage",
      snuffing: "snuff",
    };
    for (const archetype of ARCHETYPES)
      for (const name of MODIFIER_NAMES) {
        const neutral = creatureStats(archetype, NEUTRAL);
        for (const level of [-1, 1] as const) {
          const stats = creatureStats(archetype, { ...NEUTRAL, [name]: level });
          for (const stat of STAT_NAMES) {
            if (stat !== moves[name]) expect(stats[stat]).toBe(neutral[stat]);
            else if (level === 1) expect(stats[stat]).not.toBe(neutral[stat]); // weaker may be held at a floor
          }
        }
      }
  });
});

describe("a creature in the night", () => {
  test("its stats come from its archetype and modifiers, and the sim plays by them", () => {
    const creature = creatureOf("brute", STRONG);
    const state = newNight(newLegacy(), 1, creature);
    expect(monsterStats(state, "creature")).toEqual(statsOf({ archetype: "brute", modifiers: STRONG }));
    expect(monsterStats(state, "creature").health).toBe(MONSTER.cyclops.health + 1);
    expect(monsterStats(state, "satyr")).toEqual(MONSTER.satyr); // the hand-made monsters are untouched
  });

  test("it spawns with the health of its stats", () => {
    for (const modifiers of [WEAK, NEUTRAL, STRONG]) {
      const { creatures } = watchNight(creatureOf("brute", modifiers), 5);
      expect(creatures.length).toBeGreaterThan(0);
      for (const creature of creatures) expect(creature.health).toBe(statsOf({ archetype: "brute", modifiers }).health);
    }
  });

  test("its health decides how many blows it takes", () => {
    const blowsToKill = (modifiers: Modifiers) => {
      const state = newNight(newLegacy(), 1, creatureOf("brute", modifiers));
      state.spawnTimer = 1e9;
      state.hero.x = CENTRE_X;
      state.hero.y = CENTRE_Y;
      state.monsters.push({
        id: state.nextId++,
        kind: "creature",
        x: state.hero.x + 40,
        y: state.hero.y,
        health: monsterStats(state, "creature").health,
        age: 0,
        wobble: 0,
        snuff: 0,
        attackCooldown: 99,
        hurt: 0,
        stun: 0,
        knockX: 0,
        knockY: 0,
      });
      let blows = 0;
      while (state.monsters.length > 0 && blows < 10) {
        blows++;
        step(state, STEP, { ...NO_INPUT, melee: true, moveX: 1 });
        for (let count = 0; count < 60 && state.monsters.length > 0; count++) {
          step(state, STEP, NO_INPUT);
          const monster = state.monsters[0];
          if (monster) {
            monster.x = state.hero.x + 40; // stays in reach: the test counts blows, not knockback
            monster.y = state.hero.y;
            monster.knockX = 0;
            monster.knockY = 0;
          }
        }
      }
      return blows;
    };
    expect(blowsToKill(WEAK)).toBe(1);
    expect(blowsToKill(STRONG)).toBe(2);
  });

  test("it moves at the speed of its stats", () => {
    // one creature alone on the plaza, the warden far away and the lamps lit: how far it walks in a second
    const walked = (modifiers: Modifiers) => {
      const state = newNight(newLegacy(), 1, creatureOf("skulker", modifiers));
      state.spawnTimer = 1e9;
      state.hero.x = CENTRE_X + 300;
      state.hero.y = CENTRE_Y + 100;
      state.monsters.push({
        id: state.nextId++,
        kind: "creature",
        x: CENTRE_X - 300,
        y: CENTRE_Y,
        health: 1,
        age: 0,
        wobble: 0,
        snuff: 0,
        attackCooldown: 0,
        hurt: 0,
        stun: 0,
        knockX: 0,
        knockY: 0,
      });
      const monster = state.monsters[0];
      if (!monster) throw new Error("no monster");
      const startX = monster.x;
      for (let count = 0; count < 60; count++) step(state, STEP, NO_INPUT);
      return Math.abs(monster.x - startX);
    };
    expect(walked(STRONG)).toBeGreaterThan(walked(NEUTRAL));
    expect(walked(NEUTRAL)).toBeGreaterThan(walked(WEAK));
  });

  test("it comes from eight seconds in, a share of the spawns, never more than two at once", () => {
    let creatures = 0;
    let spawns = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const night = watchNight(creatureOf("skulker"), seed);
      for (const creature of night.creatures) expect(creature.second).toBeGreaterThanOrEqual(8);
      expect(night.mostAlive).toBeLessThanOrEqual(2);
      creatures += night.creatures.length;
      spawns += night.spawned.size;
    }
    expect(creatures).toBeGreaterThan(0);
    expect(creatures / spawns).toBeLessThan(0.3);
  });

  test("a night without a creature draws exactly what it always did, and one with a creature does until it can come", () => {
    const seed = 99;
    const legacy = newLegacy(seed);
    legacy.night = 4;
    const without = newNight(legacy, seed);
    const omitted = newNight(legacy, seed, null);
    const with_ = newNight(legacy, seed, creatureOf("flyer", STRONG));
    const snapshot = (state: State) => JSON.stringify({ ...state, creature: null });
    for (let count = 0; count < 7 * 60; count++) {
      step(without, STEP, NO_INPUT);
      step(omitted, STEP, NO_INPUT);
      step(with_, STEP, NO_INPUT);
    }
    expect(snapshot(omitted)).toBe(snapshot(without));
    expect(snapshot(with_)).toBe(snapshot(without)); // before eight seconds the creature has not drawn anything
    expect(without.monsters.some((monster) => monster.kind === "creature")).toBe(false);
  });
});
