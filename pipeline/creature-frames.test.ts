import { describe, expect, test } from "bun:test";
import {
  CREATURE_DIRECTIONS,
  creatureAtlasLayout,
  creatureFramesSchema,
  creatureRecordSchema,
} from "../src/game/creature-frames";
import { DRAWN_DIRECTIONS } from "../src/scene/assets";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import {
  assembleFrameSet,
  canvasOfStill,
  extentOf,
  fitFactor,
  frameRequests,
  renderFrameSet,
  slidesOf,
} from "./creature-frames";
import { CLEAN_STATS, fakeFrameBatch, framePng, spritePng } from "./fakes";
import { kitFacing } from "./hero-animation";
import type { RenderRequest, RenderResult, RenderStats } from "./render-types";

const STILL = { scale: 1, dx: 0, dy: 0 };
const okResult = (png: Uint8Array, stats: RenderStats = CLEAN_STATS): RenderResult => ({ ok: true, stats, png });
const distinctSet = () => frameRequests("x", STILL).map((_request, index) => okResult(framePng(index + 1)));
const withStats = (changes: Partial<RenderStats>): RenderStats => ({ ...CLEAN_STATS, ...changes });

describe("a creature's atlas layout", () => {
  test("without directions it is a row for each animation and a column for each frame, 128 px cells, south-east", () => {
    const layout = creatureAtlasLayout({ idle: 4, walk: 6, attack: 5 });
    expect(layout.width).toBe(768);
    expect(layout.height).toBe(384);
    expect(layout.cells).toHaveLength(15);
    expect(layout.cells.find((cell) => cell.animation === "walk" && cell.frame === 3)).toEqual({
      animation: "walk",
      frame: 3,
      direction: "se",
      x: 384,
      y: 128,
      shift: [0, 0],
    });
    expect(layout.cells.at(-1)).toMatchObject({ animation: "attack", frame: 4, x: 512, y: 256 });
  });

  test("with directions it is a column for each direction and a row for each frame, the warden's layout", () => {
    const layout = creatureAtlasLayout({ idle: 4, walk: 6, attack: 5, directions: [...CREATURE_DIRECTIONS] });
    expect([layout.width, layout.height]).toEqual([640, 1920]);
    expect(layout.cells).toHaveLength(75);
    expect(
      layout.cells.find((cell) => cell.direction === "s" && cell.animation === "walk" && cell.frame === 2),
    ).toEqual({ animation: "walk", frame: 2, direction: "s", x: 256, y: 6 * 128, shift: [0, 0] });
    expect(layout.cells.at(-1)).toMatchObject({ direction: "n", animation: "attack", frame: 4, x: 512, y: 14 * 128 });
    expect(new Set(layout.cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(75);
  });

  test("each cell says how far its frame was slid, when the record says so for every cell", () => {
    const shifts = Array.from({ length: 15 }, (_unused, index): [number, number] => [index * 6, index]);
    const layout = creatureAtlasLayout({ idle: 4, walk: 6, attack: 5, shifts });
    expect(layout.cells[0]?.shift).toEqual([0, 0]);
    expect(layout.cells[14]?.shift).toEqual([84, 14]);
    const short = creatureAtlasLayout({ idle: 4, walk: 6, attack: 5, shifts: shifts.slice(0, 14) });
    expect(short.cells.every((cell) => cell.shift[0] === 0 && cell.shift[1] === 0)).toBe(true);
  });

  test("a creature's five directions are the warden's", () => {
    expect([...CREATURE_DIRECTIONS]).toEqual([...DRAWN_DIRECTIONS]);
  });

  test("a record's frames are optional, counts must be 1 to 8 and directions are drawn ones, each once", () => {
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
    const directions = [...CREATURE_DIRECTIONS];
    expect(
      creatureRecordSchema.parse({ ...base, frames: { idle: 4, walk: 6, attack: 5, directions } }).frames?.directions,
    ).toEqual(directions);
    expect(creatureFramesSchema.safeParse({ idle: 0, walk: 6, attack: 5 }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 9, attack: 5 }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, directions: [] }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, directions: ["se", "se"] }).success).toBe(
      false,
    );
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, directions: ["w"] }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, shifts: [[0, -6]] }).success).toBe(true);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, shifts: [[0.5, 0]] }).success).toBe(false);
    expect(creatureFramesSchema.safeParse({ idle: 4, walk: 6, attack: 5, shifts: [[0, 900]] }).success).toBe(false);
  });
});

describe("the canvas a frame is drawn on", () => {
  test("is read from the still's fit string and scale", () => {
    expect(slidesOf("")).toEqual({ dx: 0, dy: 0 });
    expect(slidesOf("0:6,0:6")).toEqual({ dx: 0, dy: 12 });
    expect(slidesOf("-6:6,6:0,0:-6")).toEqual({ dx: 0, dy: 0 });
    expect(canvasOfStill({ fit: "-6:6", scale: 1.4 })).toEqual({ scale: 1.4, dx: -6, dy: 6 });
    expect(canvasOfStill({ fit: "" })).toEqual({ scale: 1, dx: 0, dy: 0 });
  });

  test("a set whose frames all fit needs no change", () => {
    const extent = extentOf([okResult(framePng(1)), okResult(framePng(2))]);
    expect(extent.touching).toBe(false);
    expect(fitFactor(extent)).toBe(1);
  });

  test("a set is drawn so that its biggest frame fits, whatever way the kit slid it", () => {
    // a frame 150 rows tall at the size of its still: it must be drawn at 116 / 150 of it
    const big = okResult(framePng(1), withStats({ fit: "0:6", bbox: "40,3,90,152" }));
    const extent = extentOf([okResult(framePng(2)), big]);
    expect(extent).toMatchObject({ width: 61, height: 150, touching: false });
    expect(fitFactor(extent)).toBeCloseTo(116 / 150, 5);
  });

  test("a probe drawn at half size is measured back at full size", () => {
    const probe = okResult(framePng(1), withStats({ bbox: "50,10,80,84" }));
    expect(extentOf([probe], 0.5)).toMatchObject({ width: 62, height: 150 });
  });

  test("a frame cut off at the edge is reported, for its size is only a lower bound", () => {
    const cut = okResult(framePng(1), withStats({ flags: "clipped_at_edge|too_big", bbox: "40,0,90,127" }));
    expect(extentOf([cut]).touching).toBe(true);
  });
});

/**
 * What the kit would report of a figure that stands `tall` rows high at the size of its still when it faces north-east
 * (and is 90 rows high facing any other way), when it is drawn at the size the request says: slid 6 px down to clear the
 * top, or, when it is too tall for the canvas, cut off at the edge.
 */
const figureTall =
  (tall: number) =>
  (request: RenderRequest): RenderStats => {
    const scale = request.view?.scale ?? 1;
    const height = Math.round((request.name.startsWith("ne_") ? tall : 90) * scale);
    if (height >= 126) return withStats({ flags: "clipped_at_edge", bbox: "40,0,90,127" });
    if (request.name.startsWith("ne_")) return withStats({ fit: "0:6", bbox: `40,3,90,${2 + height}` });
    return withStats({ bbox: `40,10,90,${9 + height}` });
  };

describe("a frame set", () => {
  test("asks for one render of the code in each pose from each direction, turned and fitted as asked", () => {
    const canvas = { scale: 1.2, dx: 0, dy: 6 };
    const requests = frameRequests("function build(k) {}", canvas);
    expect(requests).toHaveLength(75);
    expect(requests[0]).toEqual({
      code: "function build(k) {}",
      name: "e_idle1",
      pose: "idle1",
      facing: -45,
      view: { scale: 1.2, dx: 0, dy: 6, slides: 14 },
    });
    expect(requests[14]).toMatchObject({ name: "e_attack5", pose: "attack5", facing: kitFacing("e") });
    expect(requests[15]).toMatchObject({ name: "se_idle1", facing: 0 });
    expect(requests.at(-1)).toMatchObject({ name: "n_attack5", facing: kitFacing("n") });
    expect(new Set(requests.map((request) => request.name)).size).toBe(75);
  });

  test("from one direction it is the single-row layout, facing south-east", () => {
    const requests = frameRequests("x", STILL, ["se"]);
    expect(requests).toHaveLength(15);
    expect(requests.every((request) => request.facing === 0)).toBe(true);
    expect(requests[0]?.name).toBe("se_idle1");
  });

  test("is packed into the atlas, each frame in its cell", () => {
    const set = assembleFrameSet(distinctSet());
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.frames).toEqual({ idle: 4, walk: 6, attack: 5, directions: [...CREATURE_DIRECTIONS] });
    const atlas = decodePng(Buffer.from(set.atlas));
    expect([atlas.width, atlas.height]).toEqual([640, 1920]);
    // frame number 16 (index 15, south-east idle1) sits at column 1, row 0 and carries the block framePng(16) drew
    const marker = atlas.get(128 + 20 + (16 % 90), 60);
    expect(marker).toEqual([200, 100, 50, 255]);
    // the last frame is north's attack5, bottom of the last column
    expect(atlas.get(4 * 128 + 20 + (75 % 90), 14 * 128 + 60)).toEqual([200, 100, 50, 255]);
    expect(atlas.get(0, 0)[3]).toBe(0);
  });

  test("records how far each frame was slid along its cell, when any was", () => {
    const results = distinctSet();
    results[45] = okResult(framePng(46), withStats({ fit: "0:6,0:6" }));
    results[60] = okResult(framePng(61), withStats({ fit: "-6:0,-6:0,-6:0" }));
    const set = assembleFrameSet(results);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.frames.shifts).toHaveLength(75);
    expect(set.frames.shifts?.[45]).toEqual([0, 12]);
    expect(set.frames.shifts?.[60]).toEqual([-18, 0]);
    expect(set.frames.shifts?.[0]).toEqual([0, 0]);
    // and says nothing of it when none was
    const none = assembleFrameSet(distinctSet());
    expect(none.ok && none.frames.shifts).toBeFalsy();
  });

  test("from one direction it is packed as the single-row layout", () => {
    const requests = frameRequests("x", STILL, ["se"]);
    const set = assembleFrameSet(
      requests.map((_request, index) => okResult(framePng(index + 1))),
      ["se"],
    );
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.frames).toEqual({ idle: 4, walk: 6, attack: 5 });
    const atlas = decodePng(Buffer.from(set.atlas));
    expect([atlas.width, atlas.height]).toEqual([768, 384]);
  });

  test("is refused when the walk frames are all one picture, from any side", () => {
    // south's walk (the third direction: indices 30 + 4 .. 30 + 9) is one picture
    const results = distinctSet().map((result, index) => (index >= 34 && index < 40 ? okResult(framePng(1)) : result));
    expect(assembleFrameSet(results)).toMatchObject({ ok: false, kind: "static" });
  });

  test("is refused when two directions are the same picture", () => {
    const results = distinctSet();
    // north-east's standing frame is south's
    results[45] = okResult(framePng(31));
    expect(assembleFrameSet(results)).toMatchObject({ ok: false, kind: "directions" });
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
    expect(assembleFrameSet(distinctSet().slice(0, 74))).toMatchObject({ ok: false, kind: "incomplete" });
    const notPng = distinctSet();
    notPng[0] = okResult(new Uint8Array([1, 2, 3]));
    expect(assembleFrameSet(notPng)).toMatchObject({ ok: false, kind: "picture" });
  });

  test("renders in one batch through the renderer it is given", async () => {
    const batch = fakeFrameBatch();
    const set = await renderFrameSet(batch.render, "function build(k) {}", STILL);
    expect(set).toMatchObject({ ok: true, batches: 1, earlier: [] });
    expect(batch.batches).toHaveLength(1);
    expect(batch.batches[0]).toHaveLength(75);
  });

  test("keeps the still's size when the kit could slide every frame clear of the edge", async () => {
    // facing north-east it stands 120 rows high: too tall for the rows above its feet, but the kit slides it 6 px down
    const batch = fakeFrameBatch({ statsOf: figureTall(120) });
    const set = await renderFrameSet(batch.render, "function build(k) {}", STILL);
    expect(set).toMatchObject({ ok: true, batches: 1 });
    if (!set.ok) return;
    expect(set.canvas.scale).toBe(1);
    expect(set.frames.shifts?.[45]).toEqual([0, 6]);
    expect(set.frames.shifts?.[0]).toEqual([0, 0]);
  });

  test("falls back to the one south-east side when the builder ignores its facing", async () => {
    // every direction draws the picture its pose has, whatever the turn
    const poses = ["idle1", "idle2", "idle3", "idle4", "walk1", "walk2", "walk3", "walk4", "walk5", "walk6"];
    const batch = fakeFrameBatch({
      seedOf: (request) => poses.indexOf(request.pose) + 1 + (request.pose.startsWith("a") ? 20 : 0),
    });
    const set = await renderFrameSet(batch.render, "function build(k) {}", STILL);
    expect(set).toMatchObject({ ok: true, earlier: ["directions"], batches: 2 });
    if (!set.ok) return;
    expect(set.frames).toEqual({ idle: 4, walk: 6, attack: 5 });
    expect(batch.batches.map((requests) => requests.length)).toEqual([75, 15]);
  });

  test("does not fall back when the walk does not move: a builder that ignores its pose is refused", async () => {
    const batch = fakeFrameBatch();
    const set = await renderFrameSet(batch.render, "// STATIC\nfunction build(k) {}", STILL);
    expect(set).toMatchObject({ ok: false, kind: "static", batches: 1 });
  });

  test("draws a figure too big for its cell smaller, in every frame, to the size its biggest frame fits", async () => {
    // facing north-east it stands 150 rows high: no slide helps, a probe at half size measures it, and the set is drawn
    // again at the size that fits
    const batch = fakeFrameBatch({ statsOf: figureTall(150) });
    const set = await renderFrameSet(batch.render, "function build(k) {}", STILL);
    expect(set).toMatchObject({ ok: true, batches: 3 });
    if (!set.ok) return;
    expect(set.canvas.scale).toBeCloseTo((116 / 150) * 0.98, 5);
    const [first, probe, last] = batch.batches;
    expect(first?.every((request) => request.view?.scale === 1)).toBe(true);
    expect(probe?.every((request) => request.view?.scale === 0.5)).toBe(true);
    expect(last).toHaveLength(75);
    expect(last?.every((request) => request.view?.scale === set.canvas.scale)).toBe(true);
    expect(set.frames.shifts?.[45]).toEqual([0, 6]);
  });

  test("falls back to one side when the figure is too big to measure, more than twice the canvas", async () => {
    // a north-east frame 280 rows high: even the half-size probe is cut off at the edge
    const batch = fakeFrameBatch({ statsOf: figureTall(280) });
    const set = await renderFrameSet(batch.render, "function build(k) {}", STILL);
    expect(set).toMatchObject({ ok: true, earlier: ["fit"] });
    if (!set.ok) return;
    expect(set.frames).toEqual({ idle: 4, walk: 6, attack: 5 });
    expect(batch.batches.map((requests) => requests.length)).toEqual([75, 75, 15]);
  });
});
