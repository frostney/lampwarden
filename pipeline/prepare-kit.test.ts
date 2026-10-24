import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { preparedKitModule, prepareKitSource } from "./prepare-kit";
import { PREPARED_KIT } from "./prepared-kit";

const KIT = readFileSync(join(import.meta.dirname, "kit", "kit.ts"), "utf8");

describe("the prepared kit (pipeline/prepared-kit.ts)", () => {
  test("is the kit as it is now: `bun run kit` has been run since the kit last changed", () => {
    const fresh = prepareKitSource(KIT);
    expect(PREPARED_KIT.sha256).toBe(fresh.sha256);
    expect(PREPARED_KIT.names).toEqual(fresh.names);
    expect(PREPARED_KIT.body).toBe(fresh.body);
  });

  test("the committed file is exactly what the generator writes", () => {
    expect(readFileSync(join(import.meta.dirname, "prepared-kit.ts"), "utf8")).toBe(
      preparedKitModule(prepareKitSource(KIT)),
    );
  });

  test("is plain JavaScript that exports the builders a build calls", () => {
    expect(() => new Function(PREPARED_KIT.body)).not.toThrow();
    expect(PREPARED_KIT.body).not.toMatch(/^export\s/m);
    for (const name of ["Kit", "post", "humanoid", "satyr", "hero", "lampstand"])
      expect(PREPARED_KIT.names).toContain(name);
  });
});
