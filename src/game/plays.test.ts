import { describe, expect, test } from "bun:test";

import { newLegacy } from "./legacy";
import { describeNight, playSchema, replaysExactlyOn } from "./plays";
import { Recorder } from "./recording";
import { NO_INPUT, newNight, step } from "./sim";

// a short night as the Recorder sends it, without a creature or a sim (as from before either was recorded)
const legacy = newLegacy(1);
const night = newNight(legacy, 5);
const recorder = new Recorder(legacy, 5, "");
for (let stepIndex = 0; stepIndex < 130; stepIndex++) {
  recorder.input(stepIndex, NO_INPUT, night);
  step(night, 1 / 60, NO_INPUT);
}
const play = JSON.parse(JSON.stringify(recorder.finish(night)));
const creature = {
  id: "brine-hound-1",
  name: "Brine hound",
  archetype: "skulker",
  modifiers: { speed: 1, toughness: 0, bite: -1, snuffing: 0 },
  anchorY: 0.8,
};

describe("the play schema at /api/plays", () => {
  test("a play from before creatures still validates", () => {
    expect(playSchema.safeParse(play).success).toBe(true);
  });

  test("a play with its creature validates and keeps it", () => {
    const parsed = playSchema.safeParse({ ...play, creature });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ steps: 130, creature });
  });

  test("fields a recording does not have are dropped, not stored", () => {
    const parsed = playSchema.safeParse({ ...play, padding: "x".repeat(1000), legacy: { ...play.legacy, extra: 1 } });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("padding");
    expect(parsed.data?.legacy).not.toHaveProperty("extra");
  });

  test("a play that could not replay is refused", () => {
    const { heir } = play.legacy;
    const broken = [
      { ...play, legacy: undefined },
      { ...play, legacy: { ...play.legacy, heir: undefined } },
      { ...play, legacy: { ...play.legacy, heir: { ...heir, trait: "immortal" } } },
      { ...play, legacy: { ...play.legacy, tide: 9 } },
      { ...play, legacy: { ...play.legacy, tide: undefined } },
      { ...play, legacy: { ...play.legacy, night: 0 } },
      { ...play, steps: 1.5 },
      { ...play, steps: 10_000_000 },
      { ...play, outcome: "won" },
      { ...play, inputs: [[0, 0, 0, 0, 0, -1]] },
      { ...play, inputs: Array.from({ length: 10_000 }, (_, index) => [index, 0, 0, 0, 0, -1, -1]) },
      { ...play, stats: { ...play.stats, kills: -1 } },
    ];
    for (const sent of broken) {
      expect(playSchema.safeParse(sent).success).toBe(false);
    }
  });

  test("a creature that could not have been met is refused", () => {
    expect(playSchema.safeParse({ ...play, creature: { ...creature, archetype: "dragon" } }).success).toBe(false);
    expect(playSchema.safeParse({ ...play, creature: { ...creature, anchorY: 4 } }).success).toBe(false);
    expect(
      playSchema.safeParse({ ...play, creature: { ...creature, modifiers: { ...creature.modifiers, speed: 9 } } })
        .success,
    ).toBe(false);
  });
});

describe("describing a recorded night", () => {
  const recorded = {
    legacy: { night: 3, heir: { name: "Theodora" } },
    outcome: "dawn",
    stats: { kills: 17, lampsLost: 1 },
    timeline: [[1], [2]],
  };

  test("says who, which night, how it ended and for how long", () => {
    expect(describeNight(recorded)).toBe("Theodora, night 3: dawn, 17 slain, 1 lamps snuffed, 2 s.");
    expect(describeNight({ ...recorded, outcome: null })).toContain("abandoned");
  });

  test("a recording too odd to describe gives nothing instead of throwing", () => {
    expect(describeNight({ ...recorded, legacy: undefined })).toBeNull();
    expect(describeNight({ ...recorded, stats: { kills: "many" } })).toBeNull();
    expect(describeNight(null)).toBeNull();
  });
});

describe("the sim a play was recorded on", () => {
  const sim = "0123456789ab";

  test("a play from before fingerprints, with no sim, still validates", () => {
    const parsed = playSchema.safeParse(play);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("sim");
  });

  test("a play with its sim validates and keeps it", () => {
    expect(playSchema.safeParse({ ...play, sim }).data).toMatchObject({ sim });
  });

  test("a sim that is not a fingerprint is refused", () => {
    for (const bad of ["", "dev", "0123456789AB", "0123456789abc", 12, null]) {
      expect(playSchema.safeParse({ ...play, sim: bad }).success).toBe(false);
    }
  });

  test("a play replays only on the sim it was recorded on", () => {
    expect(replaysExactlyOn({ sim }, sim)).toBe(true);
    expect(replaysExactlyOn({ sim }, "ba9876543210")).toBe(false);
  });

  test("a play with no recorded sim is never replayed, even where the running sim is unknown too", () => {
    expect(replaysExactlyOn({}, sim)).toBe(false);
    expect(replaysExactlyOn({}, undefined)).toBe(false);
    expect(replaysExactlyOn({ sim }, undefined)).toBe(false);
  });
});
