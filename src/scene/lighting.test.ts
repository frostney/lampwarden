import { describe, expect, test } from "bun:test";
import { newLegacy } from "../game/legacy";
import { type Lamp, newNight, type State } from "../game/sim";
import { nightTint } from "./layers";
import { illuminate, lampFootTint, lampTint, lightCharacter, mirroredOctant, SHADOW_ANGLES } from "./lighting";

const lamp = (overrides: Partial<Lamp> = {}): Lamp => ({
  x: 480,
  y: 300,
  lit: true,
  relight: 0,
  flicker: 0,
  ...overrides,
});
const RADIUS = 92;
// a flicker clock at which the lamp's pool is at its calm size
const CALM_CLOCK = 0;

function night(progress = 0): State {
  const state = newNight(newLegacy(), 7);
  state.elapsed = state.length * progress;
  return state;
}

describe("illuminate", () => {
  test("a dark lamp lights nothing", () => {
    const light = illuminate([lamp({ lit: false })], RADIUS, 480, 300, CALM_CLOCK, 1);
    expect(light.amount).toBe(0);
    expect(light.sources).toHaveLength(0);
  });

  test("a character lights up as it nears a lamp and not at all outside its pool", () => {
    const amountAt = (x: number) => illuminate([lamp()], RADIUS, x, 300, CALM_CLOCK, 1).amount;
    expect(amountAt(480)).toBeGreaterThan(amountAt(530));
    expect(amountAt(530)).toBeGreaterThan(amountAt(570));
    expect(amountAt(480)).toBe(1);
    expect(amountAt(480 + RADIUS * 1.1 + 5)).toBe(0);
  });

  test("the lit amount moves in whole steps", () => {
    for (let x = 480; x < 600; x += 3) {
      const { amount } = illuminate([lamp()], RADIUS, x, 300, CALM_CLOCK, 1);
      expect(Math.abs(amount * 6 - Math.round(amount * 6))).toBeLessThan(1e-9);
    }
  });

  test("the dawn fades the light out", () => {
    const light = illuminate([lamp()], RADIUS, 500, 300, CALM_CLOCK, 0);
    expect(light.amount).toBe(0);
    expect(light.sources).toHaveLength(0);
  });

  test("keeps the two strongest lamps, strongest first", () => {
    const lamps = [lamp({ x: 400 }), lamp({ x: 570 }), lamp({ x: 470 })];
    const { sources } = illuminate(lamps, RADIUS, 480, 300, CALM_CLOCK, 1);
    expect(sources.map((source) => source.lampX)).toEqual([470, 400]);
  });
});

describe("lamp tint", () => {
  test("is the night's own tint with no light and never darker than it with any", () => {
    const nightTint = 0x46559a;
    expect(lampTint(nightTint, 0)).toBe(nightTint);
    for (const amount of [0.2, 0.5, 1]) {
      const tint = lampTint(nightTint, amount);
      for (const shift of [16, 8, 0]) expect((tint >> shift) & 255).toBeGreaterThanOrEqual((nightTint >> shift) & 255);
    }
    expect(lampTint(0xffffff, 1)).toBe(0xffffff);
  });

  test("a lit lamp's foot is warmer than the night's tint, and plain white once the night is gone", () => {
    const green = (tint: number) => (tint >> 8) & 255;
    expect(green(lampFootTint(night(0.3)))).toBeGreaterThan(green(nightTint(0.3)));
    expect(lampFootTint(night(1))).toBe(0xffffff);
  });
});

describe("lightCharacter", () => {
  // a lamp at (480, 300) alone, the night's only light
  function lampAlone(progress = 0): State {
    const state = night(progress);
    state.lamps = [lamp()];
    return state;
  }
  // the ground-angle index (of SHADOW_ANGLES, from +x clockwise on the screen) of the lamp's shadow on a character
  const lampShadow = (x: number, y: number) => {
    const [, shadow] = lightCharacter(lampAlone(), x, y, false, CALM_CLOCK).shadows;
    return shadow;
  };

  test("a shadow falls away from the lamp, on every side", () => {
    expect(lampShadow(540, 300)?.angleIndex).toBe(0); // lamp to the west: shadow to the east
    expect(lampShadow(480, 330)?.angleIndex).toBe(SHADOW_ANGLES / 4); // lamp to the north: shadow to the south
    expect(lampShadow(420, 300)?.angleIndex).toBe(SHADOW_ANGLES / 2);
    expect(lampShadow(480, 270)?.angleIndex).toBe((SHADOW_ANGLES * 3) / 4);
  });

  test("a shadow is shorter and darker close to the lamp", () => {
    const near = lampShadow(500, 300);
    const far = lampShadow(560, 300);
    expect(near && far && near.lengthStep < far.lengthStep).toBe(true);
    expect(near && far && near.alpha > far.alpha).toBe(true);
  });

  test("away from every lamp only the moon's faint shadow remains, and no rim", () => {
    const light = lightCharacter(lampAlone(), 80, 560, false, CALM_CLOCK);
    expect(light.shadows).toHaveLength(1);
    expect(light.rim).toBeNull();
    expect(light.tint).toBe(lampTint(0x46559a, 0));
  });

  test("the rim is on the side facing the lamp, mirrored for a sprite that faces the other way", () => {
    const west = lightCharacter(lampAlone(), 440, 300, false, CALM_CLOCK).rim; // lamp up and to the east
    const east = lightCharacter(lampAlone(), 520, 300, false, CALM_CLOCK).rim; // lamp up and to the west
    expect(west).not.toBeNull();
    expect(east).not.toBeNull();
    // a lamp 77 pixels up and 40 across, seen from a body 32 up: the light comes from the upper side
    expect([6, 7]).toContain(west?.direction ?? -1);
    expect([5, 6]).toContain(east?.direction ?? -1);
    expect(mirroredOctant(7)).toBe(5);
    expect(mirroredOctant(0)).toBe(4);
    expect(mirroredOctant(2)).toBe(2);
  });

  test("lamps going out and the dawn take the character's light with them", () => {
    const state = lampAlone();
    const lit = lightCharacter(state, 500, 300, false, CALM_CLOCK);
    expect(lit.shadows).toHaveLength(2);
    expect(lit.tint).not.toBe(lampTint(0x46559a, 0));
    state.lamps = [lamp({ lit: false })];
    expect(lightCharacter(state, 500, 300, false, CALM_CLOCK).shadows).toHaveLength(1);
    const dawn = lightCharacter(lampAlone(1), 500, 300, false, CALM_CLOCK);
    expect(dawn.shadows).toHaveLength(1);
    expect(dawn.rim).toBeNull();
  });

  test("a flier's shadow is fainter than a walker's", () => {
    const walker = lightCharacter(lampAlone(), 80, 560, false, CALM_CLOCK).shadows[0];
    const flier = lightCharacter(lampAlone(), 80, 560, true, CALM_CLOCK).shadows[0];
    expect(walker && flier && flier.alpha < walker.alpha).toBe(true);
  });
});
