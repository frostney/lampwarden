import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { type Play, quantise, Recorder, STEP, verifyPlay } from "./replay";
import { ground, type Input, MONSTER, NO_INPUT, newNight, type State, step } from "./sim";

// A simple warden: strike what is close (turned towards it), shoot what is far, walk towards the nearest monster.
function botInput(state: State): Input {
  const hero = state.hero;
  let nearest: State["monsters"][number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const monster of state.monsters) {
    const distance = ground(monster.x, monster.y, hero.x, hero.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = monster;
    }
  }
  if (!nearest) return NO_INPUT;
  if (nearestDistance < state.rules.meleeReach - 8)
    return {
      ...NO_INPUT,
      melee: true,
      moveX: (nearest.x - hero.x) / nearestDistance,
      moveY: ((nearest.y - hero.y) * 2) / nearestDistance,
    };
  if (hero.shotCooldown <= 0 && nearestDistance > 180)
    return {
      ...NO_INPUT,
      ranged: true,
      aim: { x: nearest.x + 0.37, y: nearest.y - (MONSTER[nearest.kind].fly ? 56 : 32) },
    };
  return { ...NO_INPUT, moveX: Math.sign(nearest.x - hero.x), moveY: Math.sign(nearest.y - hero.y) };
}

// Plays one night with the bot through the Recorder, as the scene does, and returns the recording as it travels (JSON).
function recordNight(night: number, tide: number, seed: number): { live: State; play: Play } {
  const legacy = newLegacy();
  legacy.night = night;
  legacy.tide = tide;
  const live = newNight(legacy, seed);
  const recorder = new Recorder(legacy, seed, "test");
  let input = NO_INPUT;
  for (let stepIndex = 0; !live.outcome; stepIndex++) {
    input = stepIndex % 9 === 0 ? botInput(live) : { ...input, melee: false, ranged: false };
    const quantised = quantise(input);
    recorder.input(stepIndex, quantised, live);
    step(live, STEP, quantised);
  }
  return { live, play: JSON.parse(JSON.stringify(recorder.finish(live))) };
}

describe("recorded nights", () => {
  const cases = [1, 2, 3, 4, 5, 6].flatMap((night) =>
    [1, 1.2, 1.4].map((tide) => ({ night, tide, seed: night * 7919 + tide * 104729 })),
  );
  test.each(cases)("night $night at tide $tide replays to the same end", ({ night, tide, seed }) => {
    const { live, play } = recordNight(night, tide, seed);
    const replayed = verifyPlay(play);
    expect(replayed.endsMatch).toBe(true);
    expect(replayed.state.stats).toEqual(live.stats);
  });

  test("a recording stays small", () => {
    const { play } = recordNight(1, 1, 12345);
    expect(JSON.stringify(play).length).toBeLessThan(20_000);
  });
});
