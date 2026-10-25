// The extents of the sprites the decor placer reads, measured from their PNGs (src/scene/extent.ts). The set is the
// placer's own (`PLACED_SPRITES` in src/scene/decor.ts), not every committed sprite: build.ts writes it into
// src/scene/decor-extents.ts, and `build.ts --check` (part of `bun run check:generated`) fails when that file differs
// from a fresh measurement.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ANCHOR_Y } from "../../src/scene/assets";
import { PLACED_SPRITES } from "../../src/scene/decor";
import { baseBandOf, measureSprite, type SpriteExtents } from "../../src/scene/extent";
import { decodePng } from "../logo/png";

export const repositoryRoot = join(import.meta.dir, "../..");

export function measurePlacedSprites(): Record<string, SpriteExtents> {
  const measured: Record<string, SpriteExtents> = {};
  for (const key of PLACED_SPRITES) {
    const anchorY = Object.entries(ANCHOR_Y).find(([name]) => name === key)?.[1];
    if (anchorY === undefined) {
      throw new Error(`the placer uses the sprite ${key}, which has no ANCHOR_Y in assets.ts`);
    }
    const image = decodePng(readFileSync(join(repositoryRoot, "public/sprites", `${key}.png`)));
    measured[key] = measureSprite(image.data, anchorY, baseBandOf(key));
  }
  return measured;
}
