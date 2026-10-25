import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAccepted } from "../../pipeline/loop";
import { decodePng } from "../../tools/logo/png";
import { anchorYFromBbox } from "../server/creatures/job-shell";
import { anchorYFor, assetList, sceneryAssetList, sceneryKeyFor } from "./assets";

const SPRITES = join(import.meta.dir, "../../public/sprites");
const manifestSchema = z.object({
  sprites: z.record(
    z.string(),
    z.object({
      source: z.string().optional(),
      flags: z.string().optional(),
      bbox: z.string(),
      anchor_y: z.number().optional(),
      score: z.number().nullable(),
      passed: z.boolean().nullable(),
      fallback_for: z.string().optional(),
      mubit_request_ids: z.unknown().optional(),
      gen: z.string().nullable().optional(),
      verify: z.array(z.string().nullable()).optional(),
      fix: z.string().nullable().optional(),
    }),
  ),
});
const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(SPRITES, "manifest.json"), "utf8"))).sprites;
const SCENERY_KEYS = sceneryAssetList().map((asset) => asset.alias);
const OPAQUE = 250;
const BUILDINGS = ["temple", "house", "wall", "stall"];

/** The bounding box of the opaque pixels of a committed sprite (not its translucent painted shadow), as the engine's stats write it. */
function opaqueBbox(name: string): string {
  const png = decodePng(readFileSync(join(SPRITES, `${name}.png`)));
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      if ((png.data[(y * png.width + x) * 4 + 3] ?? 0) < OPAQUE) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  return `${left},${top},${right},${bottom}`;
}

describe("the scenery", () => {
  test("every scenery sprite is a committed Mubit sprite the live job's rule accepts, with its request ids", () => {
    expect(SCENERY_KEYS.length).toBeGreaterThan(BUILDINGS.length);
    for (const key of SCENERY_KEYS) {
      const row = manifest[key];
      expect(row?.source).toBe("mubit");
      if (!row) continue;
      expect(row.gen).toMatch(/^mreq_/);
      expect(row.verify?.length).toBeGreaterThan(0);
      const stats = {
        name: key,
        ms: 0,
        fit: "",
        snapped: 0,
        dropped: 0,
        coverage: 0,
        bbox: row.bbox,
        outer: 0,
        inner: 0,
        clamped: 0,
        edge: 0,
        parts: 0,
        flags: row.flags ?? "",
      };
      expect(isAccepted({ verdict: { pass: row.passed === true, score: row.score }, stats })).toBe(true);
    }
  });

  test("each anchor is measured from its sprite's lowest opaque row, as the manifest records it", () => {
    for (const key of [...SCENERY_KEYS, ...BUILDINGS.map((building) => `${building}-handwritten`)]) {
      const row = manifest[key];
      const bbox = opaqueBbox(key);
      expect(row?.bbox).toBe(bbox);
      expect(anchorYFor(key)).toBe(anchorYFromBbox(bbox));
      if (row?.source === "mubit") expect(row.anchor_y).toBe(anchorYFromBbox(bbox));
    }
  });

  test("each building keeps its hand-written sprite, and the scene draws it when the Mubit sprite did not load", () => {
    const required = assetList().map((asset) => asset.alias);
    for (const building of BUILDINGS) {
      const fallback = `${building}-handwritten`;
      expect(required).toContain(fallback);
      expect(manifest[fallback]?.fallback_for).toBe(building);
      expect(manifest[fallback]?.source).toStartWith("hand-written");
      expect(sceneryKeyFor(building, () => true)).toBe(building);
      expect(sceneryKeyFor(building, (key) => key !== building)).toBe(fallback);
    }
    // a decoration has nothing to fall back on: its key stays, and it draws nothing
    expect(sceneryKeyFor("votive-altar", () => false)).toBe("votive-altar");
    // the scenery is loaded sprite by sprite, so it is not in the list whose failure fails the whole load
    for (const key of SCENERY_KEYS) expect(required).not.toContain(key);
  });
});
