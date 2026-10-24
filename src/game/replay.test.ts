import { describe, expect, test } from "bun:test";
import { emptyLevels, newLegacy } from "./legacy";
import { type RecordedCreature, recordedCreatureSchema } from "./plays";
import { legacyOf, type Play, quantise, Recorder, STEP, verifyPlay } from "./replay";
import { bodyHeight, ground, type Input, NO_INPUT, newNight, nightCreature, type State, step } from "./sim";

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
      aim: { x: nearest.x + 0.37, y: nearest.y - bodyHeight(state, nearest.kind) },
    };
  return { ...NO_INPUT, moveX: Math.sign(nearest.x - hero.x), moveY: Math.sign(nearest.y - hero.y) };
}

// Plays one night with the bot through the Recorder, as the scene does, and returns the recording as it travels (JSON).
function recordNight(
  night: number,
  tide: number,
  seed: number,
  creature: RecordedCreature | null = null,
  policy: (state: State) => Input = botInput,
): { live: State; play: Play } {
  const legacy = newLegacy();
  legacy.night = night;
  legacy.tide = tide;
  const live = newNight(legacy, seed, creature && nightCreature(creature));
  const recorder = new Recorder(legacy, seed, "test", creature);
  let input = NO_INPUT;
  for (let stepIndex = 0; !live.outcome; stepIndex++) {
    input = stepIndex % 9 === 0 ? policy(live) : { ...input, melee: false, ranged: false };
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

  test("a recording from before the newer upgrades replays with those at level 0", () => {
    const { live, play } = recordNight(3, 1.1, 777);
    play.legacy.levels = { wick: 0, blade: 0, quiver: 0, heart: 0 }; // the four upgrades of the first build
    expect(legacyOf(play).levels).toEqual(emptyLevels());
    const replayed = verifyPlay(play);
    expect(replayed.endsMatch).toBe(true);
    expect(replayed.state.stats).toEqual(live.stats);
  });

  test("a night of wounds replays the knockback, hit-stop and mercy frames exactly", () => {
    // a warden who only stands his ground is clawed again and again
    const { live, play } = recordNight(3, 1.1, 4242, null, () => NO_INPUT);
    expect(live.hero.hits).toBeGreaterThan(1);
    const replayed = verifyPlay(play);
    expect(replayed.endsMatch).toBe(true);
    expect(replayed.state.hero).toEqual(live.hero);
  });

  test("a recording stays small", () => {
    const { play } = recordNight(1, 1, 12345);
    expect(JSON.stringify(play).length).toBeLessThan(20_000);
  });
});

const SEA_CREATURES: RecordedCreature[] = [
  {
    id: "brine-hound-1",
    name: "Brine hound",
    archetype: "skulker",
    modifiers: { speed: 1, toughness: 0, bite: 1, snuffing: 0 },
    anchorY: 0.8,
  },
  {
    id: "tide-giant-22",
    name: "Tide giant",
    archetype: "brute",
    modifiers: { speed: 1, toughness: 1, bite: 1, snuffing: 1 },
    anchorY: 0.82,
  },
  {
    id: "gull-shade-333",
    name: "Gull shade",
    archetype: "flyer",
    modifiers: { speed: -1, toughness: -1, bite: -1, snuffing: -1 },
    anchorY: 0.7,
  },
];

describe("a night with a creature from the sea", () => {
  test.each(SEA_CREATURES)("$name: the recording carries it and the replay builds the same night", (creature) => {
    for (const seed of [11, 12, 13]) {
      const { live, play } = recordNight(3, 1.1, seed, creature);
      expect(play.creature).toEqual(creature);
      expect(recordedCreatureSchema.safeParse(play.creature).success).toBe(true);
      const replayed = verifyPlay(play);
      expect(replayed.endsMatch).toBe(true);
      expect(replayed.state.stats).toEqual(live.stats);
      expect(replayed.state.oilEarned).toBe(live.oilEarned);
      expect(replayed.state.elapsed).toBe(live.elapsed);
      expect(replayed.state.creature).toEqual(live.creature);
    }
  });

  test("the creature really takes part: the night differs from the same night without it", () => {
    const [creature] = SEA_CREATURES;
    if (!creature) throw new Error("no creature");
    const { live: withCreature } = recordNight(4, 1.2, 5, creature);
    const { live: without, play } = recordNight(4, 1.2, 5);
    expect(JSON.stringify(withCreature.stats)).not.toBe(JSON.stringify(without.stats));
    expect(play).not.toHaveProperty("creature"); // a night without one records none
  });

  test("a recording from before creatures still replays", () => {
    const { live, play } = recordNight(2, 1, 4242);
    delete play.creature;
    const replayed = verifyPlay(play);
    expect(replayed.endsMatch).toBe(true);
    expect(replayed.state.stats).toEqual(live.stats);
    expect(replayed.state.creature).toBeNull();
  });
});
