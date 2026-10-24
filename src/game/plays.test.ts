import { describe, expect, test } from "bun:test";
import { describeNight, incomingPlay, replaysExactlyOn } from "./plays";

const play = { v: 1, id: "2026-10-24-12-00-00-abc123", seed: 5, inputs: [[0, 0, 0, 0, 0, -1, -1]], steps: 10 };
const creature = {
  id: "brine-hound-1",
  name: "Brine hound",
  archetype: "skulker",
  modifiers: { speed: 1, toughness: 0, bite: -1, snuffing: 0 },
  anchorY: 0.8,
};

describe("the play schema at /api/plays", () => {
  test("a play from before creatures still validates", () => {
    expect(incomingPlay.safeParse(play).success).toBe(true);
  });

  test("a play with its creature validates, and keeps what else it was sent", () => {
    const parsed = incomingPlay.safeParse({ ...play, creature });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ steps: 10, creature });
  });

  test("a creature that could not have been met is refused", () => {
    expect(incomingPlay.safeParse({ ...play, creature: { ...creature, archetype: "dragon" } }).success).toBe(false);
    expect(incomingPlay.safeParse({ ...play, creature: { ...creature, anchorY: 4 } }).success).toBe(false);
    expect(
      incomingPlay.safeParse({ ...play, creature: { ...creature, modifiers: { ...creature.modifiers, speed: 9 } } })
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
    const parsed = incomingPlay.safeParse(play);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("sim");
  });

  test("a play with its sim validates and keeps it", () => {
    expect(incomingPlay.safeParse({ ...play, sim }).data).toMatchObject({ sim });
  });

  test("a sim that is not a fingerprint is refused", () => {
    for (const bad of ["", "dev", "0123456789AB", "0123456789abc", 12, null])
      expect(incomingPlay.safeParse({ ...play, sim: bad }).success).toBe(false);
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
