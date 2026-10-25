// What a director's decision does to a night, and that the night still replays exactly from a recording that carries it.
import { describe, expect, test } from "bun:test";

import { clampProposal, type Director, EVEN_MIX } from "./director";
import { applyDirector, type Legacy, newLegacy, parseLegacy, setRulesDirector } from "./legacy";
import { type Play, Recorder } from "./recording";
import { legacyOf, quantise, STEP, verifyPlay } from "./replay";
import {
  bodyHeight,
  ground,
  type Input,
  type MonsterKind,
  NO_INPUT,
  newNight,
  nightCreature,
  type State,
  step,
} from "./sim";

const PLAY_ID = "2026-10-24-16-11-46-juith2u0";

function decisionFor(
  overrides: Partial<Parameters<typeof clampProposal>[0]>,
  rulesTide: number,
  night: number,
): Director {
  const decision = clampProposal(
    {
      reasoning: "",
      tide: rulesTide,
      mix: EVEN_MIX,
      creatureShare: 0.25,
      line: "The sea answers.",
      ...overrides,
    },
    rulesTide,
    night,
    PLAY_ID,
  );
  if (!decision) {
    throw new Error("no decision");
  }
  return decision;
}

/** A legacy on `night` whose coming night is played under `decision` (tide included, as applyDirector leaves it). */
function legacyUnder(night: number, rulesTide: number, decision: Director | null): Legacy {
  const legacy = newLegacy(1);
  legacy.night = night;
  setRulesDirector(legacy, rulesTide, night - 1, PLAY_ID);
  if (decision && !applyDirector(legacy, decision)) {
    throw new Error("decision not applied");
  }
  return legacy;
}

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
  if (!nearest) {
    return NO_INPUT;
  }
  if (nearestDistance < state.rules.meleeReach - 8) {
    return {
      ...NO_INPUT,
      melee: true,
      moveX: (nearest.x - hero.x) / nearestDistance,
      moveY: ((nearest.y - hero.y) * 2) / nearestDistance,
    };
  }
  if (hero.shotCooldown <= 0 && nearestDistance > 180) {
    return { ...NO_INPUT, ranged: true, aim: { x: nearest.x + 0.37, y: nearest.y - bodyHeight(state, nearest.kind) } };
  }
  return { ...NO_INPUT, moveX: Math.sign(nearest.x - hero.x), moveY: Math.sign(nearest.y - hero.y) };
}

function recordNight(legacy: Legacy, seed: number): { live: State; play: Play } {
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

/** How many of each kind come over `nights` seeded nights of an idle warden, counted as they rise from the sea. */
function spawnedKinds(legacy: Legacy, seeds: number[]): Record<MonsterKind, number> {
  const counts: Record<MonsterKind, number> = { satyr: 0, cyclops: 0, harpy: 0, creature: 0 };
  for (const seed of seeds) {
    const state = newNight(
      legacy,
      seed,
      nightCreature({
        id: "sea-1",
        archetype: "brute",
        modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
        anchorY: 0.8,
      }),
    );
    state.hero.health = 1e9; // it must not end the night early
    state.hero.maxHealth = 1e9;
    const seen = new Set<number>();
    while (!state.outcome) {
      step(state, STEP, NO_INPUT);
      for (const monster of state.monsters) {
        if (!seen.has(monster.id)) {
          seen.add(monster.id);
          counts[monster.kind]++;
        }
      }
      for (const lamp of state.lamps) {
        lamp.lit = true; // lamps never fall, so the night runs its length
      }
      state.monsters = []; // and the sea never fills to its cap, so it keeps sending at its own pace
    }
  }
  return counts;
}

describe("what a decision does to the night", () => {
  const seeds = Array.from({ length: 12 }, (_, index) => 300 + index);

  test("the mix moves the kinds that come: more cyclops and fewer harpies when asked", () => {
    const even = spawnedKinds(legacyUnder(4, 1.1, null), seeds);
    const mixed = spawnedKinds(
      legacyUnder(4, 1.1, decisionFor({ mix: { satyr: 1, cyclops: 2, harpy: 0.5 } }, 1.1, 3)),
      seeds,
    );
    expect(mixed.cyclops / even.cyclops).toBeGreaterThan(1.2);
    expect(mixed.harpy / even.harpy).toBeLessThan(0.8);
  });

  test("the creature share moves how often the creature comes", () => {
    const base = spawnedKinds(legacyUnder(4, 1.1, null), seeds);
    const rarer = spawnedKinds(legacyUnder(4, 1.1, decisionFor({ creatureShare: 0.1 }, 1.1, 3)), seeds);
    const commoner = spawnedKinds(legacyUnder(4, 1.1, decisionFor({ creatureShare: 0.4 }, 1.1, 3)), seeds);
    expect(rarer.creature).toBeLessThan(base.creature);
    expect(commoner.creature).toBeGreaterThan(base.creature);
  });

  test("the rules' director plays exactly the night the sim played before the director existed", () => {
    const state = newNight(legacyUnder(3, 1, null), 77);
    expect(state.mix).toEqual(EVEN_MIX);
    expect(state.creatureShare).toBe(0.25);
    expect(state.tide).toBe(1);
  });

  test("the tide the sim plays at is the decision's, and within 0.15 of the rules'", () => {
    const decision = decisionFor({ tide: 5 }, 1, 2);
    const legacy = legacyUnder(3, 1, decision);
    expect(newNight(legacy, 1).tide).toBe(1.15);
  });
});

describe("a recording that carries a decision", () => {
  const decided = (night: number, rulesTide: number) =>
    legacyUnder(
      night,
      rulesTide,
      decisionFor(
        { tide: rulesTide - 0.12, mix: { satyr: 0.7, cyclops: 1.6, harpy: 0.5 }, creatureShare: 0.35 },
        rulesTide,
        night - 1,
      ),
    );

  test.each([2, 3, 5])("night %i replays to the same end", (night) => {
    for (const seed of [5, 6, 7]) {
      const { live, play } = recordNight(decided(night, 1.1), seed * night);
      expect(play.legacy.director).toMatchObject({ source: "mubit", mix: { cyclops: 1.6 }, creatureShare: 0.35 });
      const replayed = verifyPlay(play);
      expect(replayed.endsMatch).toBe(true);
      expect(replayed.state.stats).toEqual(live.stats);
      expect(replayed.state.elapsed).toBe(live.elapsed);
    }
  });

  test("the director is what the replay builds the night from: take it away and the night is another", () => {
    const { live, play } = recordNight(decided(4, 1.2), 4040);
    const withDirector = verifyPlay(play).state;
    delete play.legacy.director;
    const without = verifyPlay(play).state;
    expect(withDirector.stats).toEqual(live.stats);
    expect(JSON.stringify(without.stats)).not.toBe(JSON.stringify(live.stats));
  });

  test("a recording from before the director replays as it did: the rules' mix and share", () => {
    const { live, play } = recordNight(legacyUnder(3, 1.1, null), 2024);
    delete play.legacy.director;
    expect(legacyOf(play).director.source).toBe("rules");
    const replayed = verifyPlay(play);
    expect(replayed.endsMatch).toBe(true);
    expect(replayed.state.stats).toEqual(live.stats);
    expect(replayed.state.hero).toEqual(live.hero);
  });

  test("a recording whose director was tampered with out of bounds replays under the rules'", () => {
    const legacy = decided(3, 1.1);
    const { play } = recordNight(legacy, 99);
    play.legacy.director = { ...legacy.director, mix: { satyr: 50, cyclops: 50, harpy: 50 } };
    expect(legacyOf(play).director.mix).toEqual(EVEN_MIX);
  });

  test("a saved legacy keeps the decision through a reload", () => {
    const legacy = decided(3, 1.1);
    const reloaded = parseLegacy(JSON.parse(JSON.stringify(legacy)));
    expect(reloaded.director).toEqual(legacy.director);
    expect(reloaded.tide).toBe(legacy.tide);
  });
});
