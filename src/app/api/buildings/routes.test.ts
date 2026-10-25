import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILDING_API, buildingJobPath, buildingSpritePath } from "@/game/building";
import { JOB_MAX_DURATION_SECONDS } from "@/server/creatures/config";

// The game fetches these paths (src/game/building.ts); each must be a route file here.
const ROUTES = join(import.meta.dir, "..", "..", "..", "..", "src", "app");

const routeFileFor = (path: string, dynamicSegments: Record<string, string>) => {
  let relative = path;
  for (const [value, name] of Object.entries(dynamicSegments)) {
    relative = relative.replace(value, `[${name}]`);
  }
  return join(ROUTES, relative, "route.ts");
};

describe("the paths the contract names", () => {
  test("POST /api/buildings/next", () => {
    expect(existsSync(routeFileFor(`${BUILDING_API}/next`, {}))).toBe(true);
  });
  test("GET the job", () => {
    expect(buildingJobPath("JOBID")).toBe("/api/buildings/jobs/JOBID");
    expect(existsSync(routeFileFor(buildingJobPath("JOBID"), { JOBID: "jobId" }))).toBe(true);
  });
  test("GET the sprite", () => {
    expect(buildingSpritePath("BUILDINGID")).toBe("/api/buildings/BUILDINGID/sprite.png");
    expect(existsSync(routeFileFor(buildingSpritePath("BUILDINGID"), { BUILDINGID: "id" }))).toBe(true);
  });
});

describe("the route that runs the job", () => {
  test("declares the maxDuration that the stale-job rule and the job budget are built on", () => {
    const source = readFileSync(routeFileFor(`${BUILDING_API}/next`, {}), "utf8");
    expect(Number(/export const maxDuration = (\d+);/.exec(source)?.[1])).toBe(JOB_MAX_DURATION_SECONDS);
  });
});

describe("the deployment", () => {
  test("traces the files the building job reads at runtime, like the creature job's", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "next.config.ts"), "utf8");
    expect(source).toContain('"/api/buildings/next": ["./pipeline/prompts/*.md"');
    expect(existsSync(join(import.meta.dir, "..", "..", "..", "..", "pipeline", "prompts", "building.md"))).toBe(true);
  });
});
