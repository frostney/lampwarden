import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "./manifest";

test("the manifest is a landscape fullscreen app whose icons are the committed ones", () => {
  const { display, orientation, icons } = manifest();
  expect(display).toBe("fullscreen");
  expect(orientation).toBe("landscape");
  expect(icons?.length).toBeGreaterThan(0);
  // Next serves src/app/icon.png at /icon.png and src/app/apple-icon.png at /apple-icon.png
  for (const icon of icons ?? []) expect(existsSync(join(import.meta.dir, icon.src))).toBe(true);
});
