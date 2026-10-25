import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NIGHT_SEA, nightTint } from "./layers";
import { SEA_COLOUR } from "./water";

const hex = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

describe("the colour behind the scene while it loads", () => {
  test("is the open sea under the night's first tint", () => {
    expect(nightTint(0)).toBe(0x46559a);
    expect(SEA_COLOUR).toBe(0x1e5f8a);
    expect(hex(NIGHT_SEA)).toBe("#082053");
  });

  test("is the stage's CSS background too, so nothing changes colour before the canvas draws", () => {
    const css = readFileSync(join(import.meta.dir, "..", "app", "globals.css"), "utf8");
    const stage = css.match(/\.stage \{[^}]*\}/)?.[0] ?? "";
    expect(stage).toContain(`background: ${hex(NIGHT_SEA)};`);
  });
});
