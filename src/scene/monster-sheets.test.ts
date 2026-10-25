import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atlasCellPixels } from "../../pipeline/hero-atlas";
import { monsterFrameBuilds } from "../../pipeline/monster-source";
import { decodePng } from "../../tools/logo/png";
import { CREATURE_DIRECTIONS, creatureAtlasLayout } from "../game/creature-frames";
import { MONSTER } from "../game/sim";
import { isSheetKind, monsterAtlasPath, SHEET_CANVASES, SHEET_FRAMES, SHEET_KINDS } from "./monster-sheets";

const publicDirectory = join(import.meta.dir, "../../public");
const opaque = (pixels: Uint8Array) => pixels.filter((value, index) => index % 4 === 3 && value > 200).length;

describe("the hand-made monsters' frames", () => {
  test("are the monsters the sim has", () => {
    expect(Object.keys(MONSTER).sort()).toEqual([...SHEET_KINDS].sort());
    expect(SHEET_KINDS.every(isSheetKind)).toBe(true);
    expect(isSheetKind("creature")).toBe(false);
  });

  for (const kind of SHEET_KINDS) {
    describe(`the ${kind}`, () => {
      const frames = SHEET_FRAMES[kind];
      const layout = creatureAtlasLayout(frames);
      const atlas = decodePng(readFileSync(join(publicDirectory, monsterAtlasPath(kind))));

      test("has an atlas of the five directions, a figure in every cell", () => {
        expect(frames.directions).toEqual([...CREATURE_DIRECTIONS]);
        expect([atlas.width, atlas.height]).toEqual([640, 1920]);
        expect([layout.width, layout.height]).toEqual([640, 1920]);
        expect(layout.cells).toHaveLength(75);
        for (const cell of layout.cells) expect(opaque(atlasCellPixels(atlas, cell.x, cell.y))).toBeGreaterThan(300);
      });

      test("looks different from every direction, and walks", () => {
        const standing = layout.cells.filter((cell) => cell.animation === "idle" && cell.frame === 0);
        const pictures = standing.map((cell) => Buffer.from(atlasCellPixels(atlas, cell.x, cell.y)).toString("base64"));
        expect(new Set(pictures).size).toBe(5);
        for (const direction of CREATURE_DIRECTIONS) {
          const steps = layout.cells
            .filter((cell) => cell.direction === direction && cell.animation === "walk")
            .map((cell) => Buffer.from(atlasCellPixels(atlas, cell.x, cell.y)).toString("base64"));
          expect(new Set(steps).size).toBeGreaterThan(1);
        }
      });

      test("records the slide of every frame, as the kit makes it: whole six pixel steps", () => {
        expect(frames.shifts).toHaveLength(75);
        for (const [across, down] of frames.shifts ?? []) {
          expect(across % 6).toBe(0);
          expect(down % 6).toBe(0);
        }
        expect(SHEET_CANVASES[kind].scale).toBeGreaterThan(0.5);
      });

      test("is drawn by the pipeline from the committed code, one render a frame, each named as its cell", () => {
        const code = readFileSync(join(publicDirectory, "sprites", `${kind}.ts`), "utf8");
        expect(code).toContain("POSE");
        const builds = monsterFrameBuilds(kind, code);
        expect(builds).toHaveLength(75);
        expect(new Set(builds.map((build) => build.request.name)).size).toBe(75);
        expect(builds[0]?.request.name).toBe(`${kind}_e_idle1`);
        expect(builds.every((build) => build.request.view?.scale === SHEET_CANVASES[kind].scale)).toBe(true);
        expect(builds.map((build) => [build.x, build.y])).toEqual(layout.cells.map((cell) => [cell.x, cell.y]));
      });
    });
  }
});
