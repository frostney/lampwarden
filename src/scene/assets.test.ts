import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { heroFrameBuilds, kitFacing } from "../../pipeline/hero-animation";
import { atlasCellPixels } from "../../pipeline/hero-atlas";
import { decodePng } from "../../tools/logo/png";
import {
  DIRECTIONS,
  DRAWN_DIRECTIONS,
  FRAMES,
  HERO_ANIMATIONS,
  HERO_ATLAS_SIZE,
  HERO_FRAME_SIZE,
  heroAtlasPath,
  heroFrames,
  heroView,
  octantOf,
  SEXES,
} from "./assets";

describe("the warden's eight directions", () => {
  test("three are the mirror images of drawn ones, and the other five are drawn as they are", () => {
    const views = DIRECTIONS.map((_, octant) => heroView(octant));
    expect(views.map((view) => view.drawn)).toEqual(["e", "se", "s", "se", "e", "ne", "n", "ne"]);
    expect(views.map((view) => view.mirrored)).toEqual([false, false, false, true, true, true, false, false]);
    expect(new Set(views.map((view) => view.drawn))).toEqual(new Set(DRAWN_DIRECTIONS));
  });

  test("a heading falls in the octant it is nearest, whatever the sign of the turn", () => {
    expect(octantOf(1, 0)).toBe(0);
    expect(octantOf(1, 0.4)).toBe(0);
    expect(octantOf(1, 0.5)).toBe(1);
    expect(octantOf(0, 1)).toBe(2);
    expect(octantOf(-1, 0.1)).toBe(4);
    expect(octantOf(-1, -0.1)).toBe(4);
    expect(octantOf(1, -0.5)).toBe(7);
    expect(octantOf(0, -1)).toBe(6);
  });

  test("the kit draws each direction facing that way on the ground: south-east is its 0, and a step is 45 degrees", () => {
    expect(DRAWN_DIRECTIONS.map(kitFacing)).toEqual([-45, 0, 45, 270, 225]);
  });

  test("every frame the scene cuts out has a cell in a committed atlas, and the pipeline builds exactly those", () => {
    for (const sex of SEXES) {
      const atlas = decodePng(readFileSync(join(import.meta.dir, "../../public", heroAtlasPath(sex))));
      expect([atlas.width, atlas.height]).toEqual([HERO_ATLAS_SIZE.width, HERO_ATLAS_SIZE.height]);
      const frames = heroFrames(sex);
      const framesPerSex = HERO_ANIMATIONS.reduce((total, animation) => total + FRAMES[animation], 0);
      expect(frames.length).toBe(framesPerSex * DRAWN_DIRECTIONS.length);
      // no two frames share a cell, every cell lies inside the atlas and holds a drawn figure
      expect(new Set(frames.map((frame) => `${frame.x},${frame.y}`)).size).toBe(frames.length);
      for (const frame of frames) {
        expect(frame.x + HERO_FRAME_SIZE).toBeLessThanOrEqual(atlas.width);
        expect(frame.y + HERO_FRAME_SIZE).toBeLessThanOrEqual(atlas.height);
        expect(atlasCellPixels(atlas, frame.x, frame.y).some((value, index) => index % 4 === 3 && value > 0)).toBe(
          true,
        );
      }
      const built = HERO_ANIMATIONS.flatMap((animation) =>
        heroFrameBuilds(sex, animation).map((build) => `hero/${build.name}`),
      );
      expect(new Set(built)).toEqual(new Set(frames.map((frame) => frame.key)));
    }
  });
});
