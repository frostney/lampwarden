import { describe, expect, test } from "bun:test";

import { creatureFrameOf, sheetFrameKey } from "./creature-animation";

const FAR_HERO = { x: 900, y: 900 };
const monster = { x: 100, y: 100, age: 0, snuff: 0, attackCooldown: 0, stun: 0 };

describe("which frame a creature shows", () => {
  test("walks while it travels, a frame every tenth of a second", () => {
    expect(creatureFrameOf({ ...monster, age: 0 }, FAR_HERO)).toEqual({ animation: "walk", frame: 0 });
    expect(creatureFrameOf({ ...monster, age: 0.31 }, FAR_HERO)).toEqual({ animation: "walk", frame: 3 });
    // and round again after its six frames
    expect(creatureFrameOf({ ...monster, age: 0.65 }, FAR_HERO)).toEqual({ animation: "walk", frame: 0 });
  });

  test("claws a lamp with the attack frames, in a loop, while the lamp is being snuffed", () => {
    expect(creatureFrameOf({ ...monster, snuff: 0.01 }, FAR_HERO)).toEqual({ animation: "attack", frame: 0 });
    expect(creatureFrameOf({ ...monster, snuff: 0.22 }, FAR_HERO)).toEqual({ animation: "attack", frame: 3 });
    expect(creatureFrameOf({ ...monster, snuff: 0.4 }, FAR_HERO)).toEqual({ animation: "attack", frame: 0 });
  });

  test("strikes the warden once, from the moment of the blow, then waits", () => {
    const next = { x: 100, y: 100 };
    const nearHero = { ...monster, age: 0.2 };
    // the sim sets the cooldown to 1.1 at the blow and counts it down
    expect(creatureFrameOf({ ...nearHero, attackCooldown: 1.1 }, next)).toEqual({ animation: "attack", frame: 0 });
    expect(creatureFrameOf({ ...nearHero, attackCooldown: 1.1 - 0.16 }, next)).toEqual({
      animation: "attack",
      frame: 2,
    });
    expect(creatureFrameOf({ ...nearHero, attackCooldown: 1.1 - 0.5 }, next)).toEqual({ animation: "idle", frame: 1 });
  });

  test("stands idle at the warden's side and while a hit holds it", () => {
    expect(creatureFrameOf({ ...monster, age: 0.3 }, { x: 100, y: 110 })).toEqual({ animation: "idle", frame: 1 });
    expect(creatureFrameOf({ ...monster, age: 0.3, stun: 0.05 }, FAR_HERO)).toEqual({ animation: "idle", frame: 1 });
  });

  test("never asks for a frame the creature does not have", () => {
    const counts = { idle: 2, walk: 3, attack: 2 };
    for (let tenth = 0; tenth < 60; tenth++) {
      const choice = creatureFrameOf({ ...monster, age: tenth / 10 }, FAR_HERO, counts);
      expect(choice.frame).toBeLessThan(counts[choice.animation]);
    }
  });

  test("names a frame by its pose", () => {
    expect(sheetFrameKey("creature/abc", "ne", "walk", 2)).toBe("creature/abc/ne/walk3");
    expect(sheetFrameKey("satyr", "se", "idle", 0)).toBe("satyr/se/idle1");
  });
});
