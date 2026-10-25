// The extents of every committed single sprite, measured from its PNG (src/scene/extent.ts). build.ts writes them into
// src/scene/decor-extents.ts; src/scene/decor.test.ts measures again and fails when the committed table has drifted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANCHOR_Y } from "../../src/scene/assets";
import { baseBandOf, measureSprite, type SpriteExtents } from "../../src/scene/extent";
import { decodePng } from "../logo/png";

export const repositoryRoot = join(import.meta.dir, "../..");

export function measureCommittedSprites(): Record<string, SpriteExtents> {
  const measured: Record<string, SpriteExtents> = {};
  for (const [key, anchorY] of Object.entries(ANCHOR_Y)) {
    if (key === "hero") continue;
    const image = decodePng(readFileSync(join(repositoryRoot, "public/sprites", `${key}.png`)));
    measured[key] = measureSprite(image.data, anchorY, baseBandOf(key));
  }
  return measured;
}
