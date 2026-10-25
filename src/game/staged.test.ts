import { describe, expect, test } from "bun:test";

import { newLegacy } from "./legacy";
import { litCount, MONSTER, NO_INPUT, step } from "./sim";
import { spare, stagedNight, summon, toward } from "./staged";

const night = () => stagedNight(newLegacy(0), 1);

describe("a staged night", () => {
  test("nothing comes ashore by itself and dawn never comes", () => {
    const state = night();
    for (let index = 0; index < 60 * 120; index++) {
      step(state, 1 / 60, NO_INPUT);
    }
    expect(state.monsters).toHaveLength(0);
    expect(state.outcome).toBeNull();
  });

  test("monsters that put out the last lamps in one step cannot darken the plaza", () => {
    const state = night();
    // three lamps out, and a monster about to finish clawing at each of the two still burning
    for (const lamp of state.lamps.slice(0, 3)) {
      lamp.lit = false;
    }
    for (const lamp of state.lamps.slice(3)) {
      summon(state, "satyr", 0);
      const monster = state.monsters.at(-1);
      if (!monster) {
        throw new Error("no monster");
      }
      monster.x = lamp.x;
      monster.y = lamp.y;
      monster.snuff = MONSTER.satyr.snuff * state.rules.snuffMultiplier - 1 / 120;
    }
    state.hero.x = 480;
    state.hero.y = 120; // far from both, so they claw the lamps and not him
    spare(state);
    expect(litCount(state)).toBeGreaterThanOrEqual(3);
    step(state, 1 / 60, NO_INPUT);
    expect(state.outcome).toBeNull();
    expect(litCount(state)).toBeGreaterThanOrEqual(1);
  });

  test("the warden is never clawed below the floor", () => {
    const state = night();
    state.hero.health = 5;
    spare(state);
    expect(state.hero.health).toBe(40);
  });

  test("a step towards the point the warden stands on is no step", () => {
    const state = night();
    expect(toward(state, state.hero.x, state.hero.y, 0)).toBe(NO_INPUT);
  });
});
