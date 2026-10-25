import { describe, expect, test } from "bun:test";

import { ARCHETYPES, creatureStats, type Modifiers } from "./creature";
import { MONSTER } from "./sim";

const neutral: Modifiers = { speed: 0, toughness: 0, bite: 0, snuffing: 0 };

describe("creature stats", () => {
  test("a neutral creature plays exactly like the hand-made monster of its archetype", () => {
    expect(creatureStats("skulker", neutral)).toEqual(MONSTER.satyr);
    expect(creatureStats("brute", neutral)).toEqual(MONSTER.cyclops);
    expect(creatureStats("flyer", neutral)).toEqual(MONSTER.harpy);
  });

  test("no combination of modifiers leaves a creature unkillable, harmless or frozen", () => {
    const values = [-1, 0, 1] as const;
    const everyModifiers = values.flatMap((speed) =>
      values.flatMap((toughness) =>
        values.flatMap((bite) => values.map((snuffing) => ({ speed, toughness, bite, snuffing }))),
      ),
    );
    for (const archetype of ARCHETYPES) {
      for (const modifiers of everyModifiers) {
        const stats = creatureStats(archetype, modifiers);
        expect(stats.health).toBeGreaterThanOrEqual(1);
        expect(stats.health).toBeLessThanOrEqual(4);
        expect(stats.speed).toBeGreaterThan(20);
        expect(stats.damage).toBeGreaterThan(0);
        expect(stats.snuff).toBeGreaterThan(1);
      }
    }
  });
});
