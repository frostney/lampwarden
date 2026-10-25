import { describe, expect, test } from "bun:test";
import { newLegacy } from "../game/legacy";
import { type Lamp, newNight, type State } from "../game/sim";
import { sceneryAssetList } from "./assets";
import { DECOR, decorFor } from "./decor";
import { isLitProp, nightTint } from "./layers";
import {
  illuminate,
  lampFootTint,
  lampTint,
  lightCharacter,
  lightProp,
  mirroredOctant,
  SHADOW_ANGLES,
} from "./lighting";

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

describe("the warden's light", () => {
  // no lamps lit, the warden at (480, 380): his light is the night's only one
  function wardenAlone(progress = 0): State {
    const state = night(progress);
    state.lamps = [];
    state.hero.x = 480;
    state.hero.y = 380;
    return state;
  }
  const green = (tint: number) => (tint >> 8) & 255;
  const red = (tint: number) => (tint >> 16) & 255;
  const dark = lampTint(0x46559a, 0);
  const monsterAt = (state: State, x: number, y: number) => lightCharacter(state, x, y, false, CALM_CLOCK);

  test("warms a monster near him more than one further off, and not at all beyond his pool", () => {
    const state = wardenAlone();
    const near = monsterAt(state, 500, 380).tint;
    const far = monsterAt(state, 530, 380).tint;
    expect(green(near)).toBeGreaterThan(green(far));
    expect(green(far)).toBeGreaterThan(green(dark));
    expect(monsterAt(state, 480 + 62, 380).tint).toBe(dark);
    expect(monsterAt(state, 480, 380 + 32).tint).toBe(dark);
  });

  test("is a weak light: next to him a monster is lit far less than in a lamp's pool", () => {
    const withWarden = wardenAlone();
    const withLamp = wardenAlone();
    withLamp.lamps = [lamp({ x: 480, y: 380 })];
    withLamp.hero.x = 80;
    withLamp.hero.y = 560;
    const warm = (state: State) => red(monsterAt(state, 484, 380).tint) - red(dark);
    expect(warm(withWarden)).toBeGreaterThan(0);
    expect(warm(withWarden)).toBeLessThan(warm(withLamp) * 0.7);
  });

  test("moves in whole steps, like the lamps' light", () => {
    const state = wardenAlone();
    const steps = new Set<number>();
    for (let x = 480; x < 545; x += 1) steps.add(monsterAt(state, x, 380).tint);
    expect(steps.size).toBeGreaterThan(2);
    expect(steps.size).toBeLessThanOrEqual(5);
  });

  test("puts a rim on the side of a monster that faces him, and casts no shadow", () => {
    const state = wardenAlone();
    const east = monsterAt(state, 510, 380); // east of him: the rim is on its west side
    const north = monsterAt(state, 480, 364); // north of him: the rim is on its south side
    expect(east.rim?.direction).toBe(4);
    expect(north.rim?.direction).toBe(2);
    expect(east.shadows).toHaveLength(1); // the moon's, as in the dark
    expect(monsterAt(state, 80, 560).rim).toBeNull();
    expect(east.shadows[0]?.alpha).toBe(monsterAt(state, 80, 560).shadows[0]?.alpha);
  });

  test("gives the warden himself a slight warm tint, one step, and no rim or shadow of his own light", () => {
    const state = wardenAlone();
    const own = lightCharacter(state, state.hero.x, state.hero.y, false, CALM_CLOCK, "self");
    expect(own.tint).toBe(lampTint(0x46559a, 1 / 6));
    expect(green(own.tint)).toBeGreaterThan(green(dark));
    expect(own.rim).toBeNull();
    expect(own.shadows).toHaveLength(1);
  });

  test("adds to a lamp's light on whoever stands in both", () => {
    const state = night();
    state.lamps = [lamp({ x: 480, y: 380 })];
    state.hero.x = 550;
    state.hero.y = 380;
    // at the lamp's pool edge, where it lights the monster least, and by the warden's side
    const lampOnly = lightCharacter(state, 560, 380, false, CALM_CLOCK, { x: 80, y: 560 }).tint;
    const both = lightCharacter(state, 560, 380, false, CALM_CLOCK).tint;
    expect(green(lampOnly)).toBeGreaterThan(green(dark));
    expect(green(both)).toBeGreaterThan(green(lampOnly));
  });

  test("fades with the dawn, as the lamps' light does", () => {
    const state = wardenAlone(1);
    expect(monsterAt(state, 500, 380).tint).toBe(nightTint(1));
    expect(monsterAt(state, 500, 380).rim).toBeNull();
    const own = lightCharacter(state, 480, 380, false, CALM_CLOCK, "self");
    expect(own.tint).toBe(nightTint(1));
    const late = wardenAlone(0.93);
    expect(green(monsterAt(late, 500, 380).tint)).toBeGreaterThan(green(nightTint(0.93)));
  });
});

describe("lightProp", () => {
  const green = (tint: number) => (tint >> 8) & 255;
  function darkNight(progress = 0): State {
    const state = night(progress);
    state.lamps = [];
    state.hero.x = 80;
    state.hero.y = 560;
    return state;
  }

  test("a prop is the night's tint with no light on it", () => {
    expect(lightProp(darkNight(), 480, 334, CALM_CLOCK)).toBe(nightTint(0));
  });

  test("the warden's light warms the prop he stands beside, more the nearer he is", () => {
    const state = darkNight();
    const tintWith = (x: number) => {
      state.hero.x = x;
      state.hero.y = 340;
      return lightProp(state, 480, 334, CALM_CLOCK);
    };
    expect(green(tintWith(500))).toBeGreaterThan(green(tintWith(530)));
    expect(green(tintWith(530))).toBeGreaterThan(green(nightTint(0)));
    expect(tintWith(80)).toBe(nightTint(0));
  });

  test("a lit lamp's pool warms the prop at its base, and a dark lamp's does not", () => {
    const state = darkNight();
    state.lamps = [lamp({ x: 480, y: 300 })];
    const lit = lightProp(state, 500, 304, CALM_CLOCK);
    expect(green(lit)).toBeGreaterThan(green(nightTint(0)));
    state.lamps = [lamp({ x: 480, y: 300, lit: false })];
    expect(lightProp(state, 500, 304, CALM_CLOCK)).toBe(nightTint(0));
  });

  test("a lamp's own pool does not light its post", () => {
    const state = darkNight();
    const post = lamp({ x: 480, y: 300 });
    state.lamps = [post, lamp({ x: 900, y: 300 })];
    expect(lightProp(state, post.x, post.y, CALM_CLOCK, post)).toBe(nightTint(0));
    expect(lightProp(state, post.x, post.y, CALM_CLOCK)).not.toBe(nightTint(0));
    // another lamp's pool does
    state.lamps = [post, lamp({ x: 540, y: 300 })];
    expect(lightProp(state, post.x, post.y, CALM_CLOCK, post)).not.toBe(nightTint(0));
  });

  test("the dawn takes the light off it", () => {
    const state = darkNight(1);
    state.lamps = [lamp({ x: 480, y: 300 })];
    state.hero.x = 500;
    state.hero.y = 304;
    expect(lightProp(state, 490, 304, CALM_CLOCK)).toBe(nightTint(1));
  });
});

describe("which props are lit", () => {
  // the buildings and boats, which keep the night's tint; everything else the scene draws as a prop is small and is lit
  const BUILDINGS_AND_BOATS = ["temple", "house", "house-ochre", "wall", "galley-dock", "trireme"];
  const SMALL = ["zeus-statue", "stall", "olive", "olive-young", "broken-column", "votive-altar", "amphora-stack"];

  test("the statue, the stall, the trees and the decorations are; the buildings and the boats keep the night's tint", () => {
    for (const key of SMALL) expect(isLitProp(key)).toBe(true);
    for (const key of BUILDINGS_AND_BOATS) expect(isLitProp(key)).toBe(false);
  });

  test("every prop a night's layout can place, and every scenery sprite, is one or the other", () => {
    const known = new Set([...SMALL, ...BUILDINGS_AND_BOATS]);
    for (const kind of DECOR) {
      expect(known.has(kind.key)).toBe(true);
      if (kind.replacedBy) expect(known.has(kind.replacedBy.key)).toBe(true);
    }
    for (const asset of sceneryAssetList()) expect(known.has(asset.alias)).toBe(true);
    for (let seed = 1; seed <= 40; seed++) {
      const layout = decorFor(seed);
      for (const placed of [...layout.props, ...layout.boats]) expect(known.has(placed.key)).toBe(true);
    }
  });
});
