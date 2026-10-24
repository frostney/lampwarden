import { describe, expect, test } from "bun:test";
import { generationAvailable, readCreatureConfig } from "./config";

const SALT = "a-long-enough-test-salt";

describe("the renderer", () => {
  test("is QuickJS unless the environment says sandbox", () => {
    expect(readCreatureConfig({}).renderer).toBe("quickjs");
    expect(readCreatureConfig({ CREATURE_RENDERER: "sandbox" }).renderer).toBe("sandbox");
    expect(readCreatureConfig({ CREATURE_RENDERER: "quickjs" }).renderer).toBe("quickjs");
  });

  test("a value that is neither turns generation off: a misspelt sandbox must not quietly select QuickJS", () => {
    const env = { MUBIT_API_KEY: "key", CREATURE_RATE_SALT: SALT, VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1" };
    for (const value of ["Sandbox", "vercel", "docker"]) {
      const config = readCreatureConfig({ ...env, CREATURE_RENDERER: value });
      expect(config.renderer).toBeNull();
      expect(generationAvailable(config)).toBe(false);
    }
  });

  test("generation with QuickJS needs a key and a salt, and no sandbox snapshot", () => {
    expect(generationAvailable(readCreatureConfig({ MUBIT_API_KEY: "key", CREATURE_RATE_SALT: SALT }))).toBe(true);
    expect(generationAvailable(readCreatureConfig({ MUBIT_API_KEY: "key" }))).toBe(false);
    expect(generationAvailable(readCreatureConfig({ CREATURE_RATE_SALT: SALT }))).toBe(false);
  });

  test("generation with the sandbox also needs its snapshot", () => {
    const base = { MUBIT_API_KEY: "key", CREATURE_RATE_SALT: SALT, CREATURE_RENDERER: "sandbox" };
    expect(generationAvailable(readCreatureConfig(base))).toBe(false);
    expect(generationAvailable(readCreatureConfig({ ...base, VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1" }))).toBe(true);
  });
});
