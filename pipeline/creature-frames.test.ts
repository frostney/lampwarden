import { describe, expect, test } from "bun:test";
import { creatureAtlasLayout, creatureFramesSchema, creatureRecordSchema } from "../src/game/creature-frames";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { assembleFrameSet, frameRequests, renderFrameSet } from "./creature-frames";
import { CLEAN_STATS, fakeFrameBatch, framePng, spritePng } from "./fakes";
import type { RenderResult } from "./render-types";

const okResult = (png: Uint8Array): RenderResult => ({ ok: true, stats: CLEAN_STATS, png });
const distinctSet = () => frameRequests("x").map((_request, index) => okResult(framePng(index + 1)));

describe("a creature's atlas layout", () => {
  test("is a row for each animation and a column for each frame, 128 px cells", () => {
    const layout = creatureAtlasLayout({ idle: 4, walk: 6, attack: 5 });
    expect(layout.width).toBe(768);
    expect(layout.height).toBe(384);
    expect(layout.cells).toHaveLength(15);
    expect(layout.cells.find((cell) => cell.animation === "walk" && cell.frame === 3)).toEqual({
      animation: "walk",
      frame: 3,
      x: 384,
      y: 128,
    });
    expect(layout.cells.at(-1)).toMatchObject({ animation: "attack", frame: 4, x: 512, y: 256 });
  });

  test("a record's frames are optional, and counts must be 1 to 8", () => {
    const base = {
      id: "abcdefgh-brine",
      name: "Brine hound",
      lore: "It follows the smell of lamp oil.",
      brief: "a sleek sea-hound with green fur",
      archetype: "skulker",
      modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
      anchorY: 0.8,
      score: 7,
      createdAt: "2026-10-24T00:00:00.000Z",
    };
    expect(creatureRecordSchema.safeParse(base).success).toBe(true);
    expect(creatureRecordSchema.parse({ ...base, frames: { idle: 4, walk: 6, attack: 5 } }).frames).toEqual({
      idle: 4,
      walk: 6,
      attack: 5,
    });
    expect(creatureFramesSchema.safeParse({ idle: 0, walk: 6, attack: 5 }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 9, attack: 5 }).success).toBe(false);
  });
});

describe("a frame set", () => {
  test("asks for one render of the code in each pose, named as the pose", () => {
    const requests = frameRequests("function build(k) {}");
    expect(requests).toHaveLength(15);
    expect(requests[0]).toEqual({ code: "function build(k) {}", name: "idle1", pose: "idle1" });
    expect(requests[14]).toMatchObject({ name: "attack5", pose: "attack5" });
  });

  test("is packed into the atlas, each frame in its cell", () => {
    const set = assembleFrameSet(distinctSet());
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.frames).toEqual({ idle: 4, walk: 6, attack: 5 });
    const atlas = decodePng(Buffer.from(set.atlas));
    expect([atlas.width, atlas.height]).toEqual([768, 384]);
    // frame number 6 (walk2, index 5) sits at column 1 of row 1 and carries the block framePng(6) drew
    const marker = atlas.get(128 + 20 + (6 % 90), 128 + 60);
    expect(marker).toEqual([200, 100, 50, 255]);
    expect(atlas.get(0, 0)[3]).toBe(0);
  });

  test("is refused when the walk frames are all one picture", () => {
    const results = distinctSet().map((result, index) => (index >= 4 && index < 10 ? okResult(framePng(1)) : result));
    expect(assembleFrameSet(results)).toMatchObject({ ok: false, kind: "static" });
  });

  test("is refused when a pose draws no figure", () => {
    const empty = distinctSet();
    const blank = new PixelImage(128, 128);
    empty[11] = okResult(encodePng(blank));
    expect(assembleFrameSet(empty)).toMatchObject({ ok: false, kind: "blank" });
  });

  test("is refused when a frame did not render, is not 128 px, or the batch came back short", () => {
    const failed = distinctSet();
    failed[7] = { ok: false, error: "exit 1: error: boom" };
    expect(assembleFrameSet(failed)).toMatchObject({ ok: false, kind: "render" });
    const small = distinctSet();
    small[2] = okResult(spritePng());
    expect(assembleFrameSet(small)).toMatchObject({ ok: false, kind: "picture" });
    expect(assembleFrameSet(distinctSet().slice(0, 14))).toMatchObject({ ok: false, kind: "incomplete" });
    const notPng = distinctSet();
    notPng[0] = okResult(new Uint8Array([1, 2, 3]));
    expect(assembleFrameSet(notPng)).toMatchObject({ ok: false, kind: "picture" });
  });

  test("renders in one batch through the renderer it is given", async () => {
    const batch = fakeFrameBatch();
    const set = await renderFrameSet(batch.render, "function build(k) {}");
    expect(set.ok).toBe(true);
    expect(batch.batches).toHaveLength(1);
  });
});
