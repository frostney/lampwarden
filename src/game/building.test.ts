import { describe, expect, test } from "bun:test";
import {
  BUILDING_API,
  buildingJobPath,
  buildingSchema,
  buildingSpritePath,
  nextBuildingRequestSchema,
  recordedBuildingSchema,
} from "./building";

const extent = {
  hull: [
    [-30, -28],
    [30, -28],
    [30, 4],
    [-30, 4],
  ],
  solid: [
    [-30, -28],
    [30, -28],
    [30, 3],
    [-30, 3],
  ],
  band: 28,
  sprite: { left: -30, right: 30, top: -40, bottom: 4 },
};

const building = (overrides: Record<string, unknown> = {}) => ({
  id: "0000aaaa-stoa-abc123",
  name: "Stoa of the net-menders",
  brief: "long Ionic marble colonnade with a terracotta tiled roof",
  anchorY: 0.83,
  bbox: [34, 70, 93, 109],
  extent,
  score: 7.5,
  createdAt: "2026-10-25T09:00:00.000Z",
  ...overrides,
});

describe("the building record", () => {
  test("accepts everything the placer needs", () => {
    const parsed = buildingSchema.parse(building());
    expect(parsed.extent.hull).toHaveLength(4);
    expect(parsed.bbox).toEqual([34, 70, 93, 109]);
  });

  test.each([
    ["an id with capitals", { id: "Stoa-Of-Nets" }],
    ["a one-letter name", { name: "S" }],
    ["a name that is too long", { name: "x".repeat(41) }],
    ["a brief that is too long", { brief: "x".repeat(401) }],
    ["an anchor off the frame", { anchorY: 1.4 }],
    ["an anchor too high", { anchorY: 0.2 }],
    ["a bbox with a fractional pixel", { bbox: [34, 70.5, 93, 109] }],
    ["a bbox off the 128 px frame", { bbox: [34, 70, 193, 109] }],
    ["a bbox with three numbers", { bbox: [34, 70, 93] }],
    ["a score above 10", { score: 11 }],
    ["no extent", { extent: undefined }],
    ["a hull of two points", { extent: { ...extent, hull: [extent.hull[0], extent.hull[1]] } }],
    ["a hull point with a third coordinate", { extent: { ...extent, hull: [[0, 0, 0], ...extent.hull] } }],
    ["a fractional hull point", { extent: { ...extent, solid: [[0.5, 0], ...extent.solid.slice(1)] } }],
    ["a sprite box without a side", { extent: { ...extent, sprite: { left: 0, right: 5, top: 0 } } }],
  ])("rejects %s", (_description, overrides) => {
    expect(buildingSchema.safeParse(building(overrides)).success).toBe(false);
  });
});

describe("what a recording keeps", () => {
  test("is the id, the name, the anchor and the extent, and nothing the model wrote at length", () => {
    const recorded = recordedBuildingSchema.parse(building());
    expect(Object.keys(recorded).sort()).toEqual(["anchorY", "extent", "id", "name"]);
  });

  test("a recording whose extent is damaged does not parse, so a replay lays out the committed plaza", () => {
    expect(recordedBuildingSchema.safeParse({ ...building(), extent: { ...extent, band: 0 } }).success).toBe(false);
  });
});

describe("the API", () => {
  test("names its paths under /api/buildings", () => {
    expect(BUILDING_API).toBe("/api/buildings");
    expect(buildingSpritePath("0000aaaa-stoa-abc123")).toBe("/api/buildings/0000aaaa-stoa-abc123/sprite.png");
    expect(buildingJobPath("job-1")).toBe("/api/buildings/jobs/job-1");
  });

  test("a request carries at most 500 seen ids", () => {
    expect(nextBuildingRequestSchema.safeParse({ seen: [] }).success).toBe(true);
    expect(nextBuildingRequestSchema.safeParse({ seen: Array.from({ length: 501 }, () => "x") }).success).toBe(false);
    expect(nextBuildingRequestSchema.safeParse({}).success).toBe(false);
  });
});
