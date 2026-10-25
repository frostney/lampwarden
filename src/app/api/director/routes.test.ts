import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTOR_API, directorRequestSchema } from "@/game/director-api";
import { DIRECTOR_MAX_DURATION_SECONDS } from "@/server/director/config";

const ROUTE = join(import.meta.dir, "route.ts");

describe("POST /api/director", () => {
  test("is the path the game fetches, and a route file is there", () => {
    expect(existsSync(join(import.meta.dir, "..", "..", "..", "..", "src", "app", DIRECTOR_API, "route.ts"))).toBe(
      true,
    );
  });

  test("runs on Node and declares the maxDuration the play lookup, the model's deadline and the log are budgeted in", () => {
    const source = readFileSync(ROUTE, "utf8");
    expect(source).toContain('export const runtime = "nodejs";');
    expect(Number(/export const maxDuration = (\d+);/.exec(source)?.[1])).toBe(DIRECTOR_MAX_DURATION_SECONDS);
  });

  test("takes only a play id of the recorded format", () => {
    expect(directorRequestSchema.safeParse({ playId: "2026-10-24-16-11-46-juith2u0" }).success).toBe(true);
    for (const playId of ["../../etc/passwd", "", "2026-10-24-16-11-46", "x".repeat(200), 5, null])
      expect(directorRequestSchema.safeParse({ playId }).success).toBe(false);
    expect(directorRequestSchema.safeParse({}).success).toBe(false);
  });
});
