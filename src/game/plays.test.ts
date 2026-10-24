import { describe, expect, test } from "bun:test";
import { incomingPlay } from "./plays";

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
