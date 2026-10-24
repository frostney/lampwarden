import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureCommittedSprites, repositoryRoot } from "../../tools/decor-extents/measure";
import { decodePng } from "../../tools/logo/png";
import { newLegacy } from "../game/legacy";
import { type Play, Recorder } from "../game/recording";
import { creatureOf, legacyOf, STEP } from "../game/replay";
import { CENTRE_X, CENTRE_Y, LAMP_SPOTS, NO_INPUT, newNight, step } from "../game/sim";
import { anchorYFor } from "./assets";
import { DECOR, decorFor, type Placed, SPAWN_POINTS } from "./decor";
import { SPRITE_EXTENTS } from "./decor-extents";
import { baseBandOf, SOLID_ALPHA, SPRITE_SIZE } from "./extent";
import { onPlaza, onSea, plazaInset } from "./plaza";

const SEEDS = 500;
const seedOf = (index: number) => Math.imul(index + 1, 2654435761) >>> 0; // spread over all of 32 bits

// A sprite's painted pixels as the scene draws them: the world position of each pixel's centre when the sprite's anchor
// is at (x, y), with the anchor's exact (fractional) height the way Pixi places it. `base` keeps the rows of its base.
const pictures = new Map<string, { alpha: Uint8Array }>();
const remembered = new WeakMap<Placed, Map<string, { x: number; y: number }[]>>();
function pixelsOf(placed: Placed, onlyBase: boolean, minimumAlpha = 1) {
  const kept = remembered.get(placed) ?? new Map<string, { x: number; y: number }[]>();
  remembered.set(placed, kept);
  const mode = `${onlyBase}/${minimumAlpha}`;
  const known = kept.get(mode);
  if (known) return known;
  let picture = pictures.get(placed.key);
  if (!picture) {
    const image = decodePng(readFileSync(join(repositoryRoot, "public/sprites", `${placed.key}.png`)));
    picture = {
      alpha: Uint8Array.from({ length: SPRITE_SIZE * SPRITE_SIZE }, (_, index) => image.data[index * 4 + 3] ?? 0),
    };
    pictures.set(placed.key, picture);
  }
  const anchorRow = anchorYFor(placed.key) * SPRITE_SIZE;
  const band = baseBandOf(placed.key);
  const pixels: { x: number; y: number }[] = [];
  for (let row = 0; row < SPRITE_SIZE; row++) {
    if (onlyBase && row - anchorRow < -band) continue;
    for (let column = 0; column < SPRITE_SIZE; column++)
      if ((picture.alpha[row * SPRITE_SIZE + column] ?? 0) >= minimumAlpha)
        pixels.push({ x: placed.x + column - SPRITE_SIZE / 2 + 0.5, y: placed.y + row - anchorRow + 0.5 });
  }
  kept.set(mode, pixels);
  return pixels;
}
const ground = (x: number, y: number, otherX: number, otherY: number) => Math.hypot(x - otherX, (y - otherY) * 2);
const marginOf = (key: string) => DECOR.find((kind) => kind.key === key)?.margin ?? 8;
// what stands on the plaza, as against the statue at its middle and the dock on the sea
const land = (layout: { props: Placed[] }) =>
  layout.props.filter((placed) => placed.key !== "zeus-statue" && placed.key !== "galley-dock");

describe("the table of sprite extents", () => {
  test("is what the committed sprites measure (bun run decor writes it)", () => {
    expect(SPRITE_EXTENTS).toEqual(measureCommittedSprites());
  });
});

describe("a night's decorations", () => {
  const layouts = Array.from({ length: SEEDS }, (_, index) => ({
    seed: seedOf(index),
    layout: decorFor(seedOf(index)),
  }));

  test("are the same layout whenever they are asked for, and differ from night to night", () => {
    for (const { seed, layout } of layouts.slice(0, 50)) expect(decorFor(seed)).toEqual(layout);
    expect(new Set(layouts.map(({ layout }) => JSON.stringify(layout))).size).toBeGreaterThan(SEEDS * 0.99);
  });

  test("have the landmarks every night: the statue in the middle, the temple, the house, the stall, olives, both boats", () => {
    for (const { layout } of layouts) {
      const count = (key: string) => [...layout.props, ...layout.boats].filter((placed) => placed.key === key).length;
      expect(layout.props.find((placed) => placed.key === "zeus-statue")).toEqual({
        key: "zeus-statue",
        x: CENTRE_X,
        y: CENTRE_Y + 14,
      });
      for (const key of ["temple", "house", "stall", "galley-dock", "trireme"]) expect(count(key)).toBe(1);
      expect(count("olive")).toBeGreaterThanOrEqual(2);
      expect(layout.planks).toHaveLength(1);
      expect(layout.ripples.length).toBe(10);
    }
    // the optional kinds turn up too, in some layouts
    expect(layouts.some(({ layout }) => layout.props.some((placed) => placed.key === "wall"))).toBe(true);
  });

  test("stand inside the plaza: every pixel of a land prop's base is on the stone, with its margin", () => {
    for (const { seed, layout } of layouts) {
      for (const placed of land(layout)) {
        for (const pixel of pixelsOf(placed, true)) {
          const message = `seed ${seed}: ${placed.key} at ${placed.x},${placed.y}, pixel ${pixel.x},${pixel.y}`;
          if (!onPlaza(Math.floor(pixel.x), Math.floor(pixel.y))) throw new Error(`${message} is off the plaza`);
          // placed at whole pixels with the anchor a little off a whole one: a pixel of slack
          if (plazaInset(pixel.x, pixel.y) < marginOf(placed.key) - 1)
            throw new Error(`${message} is too near the rim`);
        }
      }
    }
  });

  test("keep their boats on the sea, off the stone and its walls, and on the canvas", () => {
    for (const { seed, layout } of layouts)
      for (const boat of [...layout.boats, ...layout.props.filter((placed) => placed.key === "galley-dock")])
        for (const pixel of pixelsOf(boat, false)) {
          const message = `seed ${seed}: ${boat.key} at ${boat.x},${boat.y}, pixel ${pixel.x},${pixel.y}`;
          if (pixel.x < 0 || pixel.x > 960 || pixel.y > 600) throw new Error(`${message} is off the canvas`);
          // only its base is on the water: its body may rise over the plaza's far side, never over the stone it floats by
          if (onPlaza(Math.floor(pixel.x), Math.floor(pixel.y))) throw new Error(`${message} is on the plaza`);
        }
    for (const { layout } of layouts)
      for (const boat of [...layout.boats, ...layout.props.filter((placed) => placed.key === "galley-dock")])
        for (const pixel of pixelsOf(boat, true))
          if (!onSea(Math.floor(pixel.x), Math.floor(pixel.y))) throw new Error(`${boat.key}'s base is not on the sea`);
  });

  test("leave every lamp a ring to be relit from, its lantern in view, and the statue and the warden's start clear", () => {
    const lanterns = LAMP_SPOTS.map(([x, y]) => ({ left: x - 15, right: x + 15, top: y - 100, bottom: y - 62 }));
    for (const { seed, layout } of layouts)
      for (const placed of land(layout)) {
        const solid = pixelsOf(placed, false, SOLID_ALPHA);
        const base = pixelsOf(placed, true, SOLID_ALPHA);
        for (const [lampX, lampY] of LAMP_SPOTS)
          for (const pixel of base)
            if (ground(pixel.x, pixel.y, lampX, lampY) < 40)
              throw new Error(
                `seed ${seed}: ${placed.key} at ${placed.x},${placed.y} is within the relight reach of a lamp`,
              );
        for (const lantern of lanterns)
          for (const pixel of solid)
            if (pixel.x > lantern.left && pixel.x < lantern.right && pixel.y > lantern.top && pixel.y < lantern.bottom)
              throw new Error(`seed ${seed}: ${placed.key} at ${placed.x},${placed.y} is drawn behind a lantern`);
        if (placed.y > CENTRE_Y + 62)
          for (const pixel of solid)
            if (Math.abs(pixel.x - CENTRE_X) < 24 && pixel.y > CENTRE_Y + 62 - 72 && pixel.y < CENTRE_Y + 62)
              throw new Error(`seed ${seed}: ${placed.key} at ${placed.x},${placed.y} hides the warden at his start`);
      }
  });

  test("keep their bases clear of each other", () => {
    for (const { seed, layout } of layouts) {
      const taken = new Map<string, string>();
      for (const placed of layout.props) {
        for (const pixel of pixelsOf(placed, true, SOLID_ALPHA)) {
          const cell = `${Math.floor(pixel.x)},${Math.floor(pixel.y)}`;
          const other = taken.get(cell);
          // the pieces of a wall stand end to end
          if (other && !(other === "wall" && placed.key === "wall"))
            throw new Error(`seed ${seed}: ${placed.key} at ${placed.x},${placed.y} stands on ${other}`);
          taken.set(cell, placed.key);
        }
      }
    }
  });

  test("keep clear of where monsters come ashore, as the sim has them come", () => {
    const spawns: { x: number; y: number }[] = [];
    for (let index = 0; index < 12; index++) {
      const legacy = newLegacy();
      legacy.night = 1 + (index % 4);
      legacy.tide = 1.4;
      const state = newNight(legacy, seedOf(index));
      const known = new Set<number>();
      for (let stepIndex = 0; stepIndex < 60 * 60 && !state.outcome; stepIndex++) {
        step(state, STEP, NO_INPUT);
        for (const monster of state.monsters)
          if (!known.has(monster.id)) {
            known.add(monster.id);
            spawns.push({ x: monster.x, y: monster.y });
          }
      }
    }
    expect(spawns.length).toBeGreaterThan(100);
    for (const spawn of spawns) {
      // on the ellipse the placer keeps clear of, give or take the step the monster has already taken
      const ellipse = ((spawn.x - CENTRE_X) / (384 * 0.9)) ** 2 + ((spawn.y - CENTRE_Y) / (192 * 0.9)) ** 2;
      expect(Math.abs(ellipse - 1)).toBeLessThan(0.03);
    }
    expect(SPAWN_POINTS.length).toBeGreaterThanOrEqual(96);
    for (const { seed, layout } of layouts.slice(0, 100))
      for (const placed of land(layout)) {
        // the placer samples the ellipse every 23 ground px, so a spawn is within 12 of a sample and 26 clear of it means 23 clear of the spawn
        for (const pixel of pixelsOf(placed, true, SOLID_ALPHA))
          for (const spawn of spawns.filter((_, index) => index % 4 === 0))
            if (ground(pixel.x, pixel.y, spawn.x, spawn.y) < 20)
              throw new Error(`seed ${seed}: ${placed.key} at ${placed.x},${placed.y} stands where a monster lands`);
      }
  });
});

describe("a night's decorations and the sim", () => {
  test("are laid out from a stream of their own: asking for them leaves the sim's random numbers where they were", () => {
    const outcome = (laidOut: boolean) => {
      const state = newNight(newLegacy(), 424242);
      if (laidOut) decorFor(state.randomState);
      for (let stepIndex = 0; stepIndex < 1500; stepIndex++) {
        step(state, STEP, NO_INPUT);
        if (laidOut && stepIndex % 100 === 0) decorFor(stepIndex);
      }
      return JSON.stringify(state);
    };
    expect(outcome(true)).toBe(outcome(false));
  });

  test("a replay lays out the plaza the recorded night was played on", () => {
    for (let index = 0; index < 20; index++) {
      const seed = seedOf(index); // above 2^31 for half of them: the recording keeps it unsigned, the sim as an int32
      const legacy = newLegacy();
      const live = newNight(legacy, seed);
      const recorded: Play = JSON.parse(JSON.stringify(new Recorder(legacy, seed, "test").finish(live)));
      const replayed = newNight(legacyOf(recorded), recorded.seed, creatureOf(recorded));
      expect(decorFor(replayed.randomState)).toEqual(decorFor(live.randomState));
      expect(decorFor(replayed.randomState)).toEqual(decorFor(seed));
    }
  });
});
