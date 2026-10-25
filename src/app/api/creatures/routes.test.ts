import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CREATURE_API, creatureJobPath, creatureSpritePath } from "@/game/creature";
import { JOB_MAX_DURATION_SECONDS } from "@/server/creatures/config";

// The game fetches these paths (src/game/creature.ts); each must be a route file here.
const ROUTES = join(import.meta.dir, "..", "..", "..", "..", "src", "app");

const routeFileFor = (path: string, dynamicSegments: Record<string, string>) => {
  let relative = path;
  for (const [value, name] of Object.entries(dynamicSegments)) {
    relative = relative.replace(value, `[${name}]`);
  }
  return join(ROUTES, relative, "route.ts");
};

describe("the paths the contract names", () => {
  test("POST /api/creatures/next", () => {
    expect(existsSync(routeFileFor(`${CREATURE_API}/next`, {}))).toBe(true);
  });
  test("GET the job", () => {
    expect(creatureJobPath("JOBID")).toBe("/api/creatures/jobs/JOBID");
    expect(existsSync(routeFileFor(creatureJobPath("JOBID"), { JOBID: "jobId" }))).toBe(true);
  });
  test("GET the sprite", () => {
    expect(creatureSpritePath("CREATUREID")).toBe("/api/creatures/CREATUREID/sprite.png");
    expect(existsSync(routeFileFor(creatureSpritePath("CREATUREID"), { CREATUREID: "id" }))).toBe(true);
  });
});

describe("the route that runs the job", () => {
  test("declares the maxDuration that the stale-job rule and the job budget are built on", () => {
    const source = readFileSync(routeFileFor(`${CREATURE_API}/next`, {}), "utf8");
    expect(Number(/export const maxDuration = (\d+);/.exec(source)?.[1])).toBe(JOB_MAX_DURATION_SECONDS);
  });
});
