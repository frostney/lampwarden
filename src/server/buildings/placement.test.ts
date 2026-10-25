import { describe, expect, test } from "bun:test";
import { measureSprite } from "@/scene/extent";
import { buildingPng, framePng, spritePng } from "../../../pipeline/fakes";
import { decodePng } from "../../../tools/logo/png";
import { measurePlacement } from "./placement";

describe("measuring an accepted building", () => {
  test("anchors it by the rule the committed scenery follows, and measures its base the way the table of extents does", () => {
    const placement = measurePlacement(buildingPng(), "34,70,93,109");
    expect(placement?.anchorY).toBe(0.83); // (109 + 1 - 4 rows of shadow) / 128
    expect(placement?.bbox).toEqual([34, 70, 93, 109]);
    expect(placement?.extent).toEqual(measureSprite(decodePng(Buffer.from(buildingPng())).data, 0.83));
  });

  test("the block's base is where it stands: a 60 px wide hull on the anchor, from the middle of the frame", () => {
    const extent = measurePlacement(buildingPng(), "34,70,93,109")?.extent;
    // 60 px wide, columns 34..93 of a 128 px frame centred on 64; the anchor row is 106, the lowest painted row 109
    expect(Math.min(...(extent?.hull.map(([x]) => x) ?? [0]))).toBe(-30);
    expect(Math.max(...(extent?.hull.map(([x]) => x) ?? [0]))).toBe(30);
    expect(Math.max(...(extent?.hull.map(([, y]) => y) ?? [0]))).toBe(4); // row 109 ends at 110, 4 below row 106
    expect(extent?.sprite).toEqual({ left: -30, right: 30, top: -36, bottom: 4 });
    expect(extent?.band).toBe(28);
  });

  test.each([
    ["a bbox that is not numbers", "none"],
    ["a bbox with three numbers", "34,70,93"],
    ["a bbox with a fraction", "34,70.5,93,109"],
    ["a bbox off the frame", "34,70,193,109"],
  ])("gives up on %s", (_description, bbox) => {
    expect(measurePlacement(buildingPng(), bbox)).toBeNull();
  });

  test("gives up on a picture that is not a 128 px frame, or not a picture", () => {
    expect(measurePlacement(spritePng(), "34,70,93,109")).toBeNull();
    expect(measurePlacement(new Uint8Array([1, 2, 3]), "34,70,93,109")).toBeNull();
  });

  test("a sprite that is only a speck still has a base to place, or none and the job fails", () => {
    // a 16 px figure: its base has corners, so it is measurable (the verifier and the engine flags judge its size)
    expect(measurePlacement(framePng(0), "20,60,35,75")?.extent.hull.length).toBeGreaterThanOrEqual(3);
  });
});
