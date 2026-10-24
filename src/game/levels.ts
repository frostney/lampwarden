// The upgrade ids and a warden's levels in them. Split from legacy.ts because a recorded night replays from levels
// (replay.ts: levelsOf), so this file is covered by the sim fingerprint; legacy.ts, with the shop's wording, is not.
import { z } from "zod";

export const UPGRADE_IDS = [
  "wick",
  "blade",
  "quiver",
  "heart",
  "hide",
  "knockback",
  "seeker",
  "tinder",
  "stride",
] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];
export type Levels = Record<UpgradeId, number>;
export const MAX_LEVEL = 3;

export const emptyLevels = (): Levels => ({
  wick: 0,
  blade: 0,
  quiver: 0,
  heart: 0,
  hide: 0,
  knockback: 0,
  seeker: 0,
  tinder: 0,
  stride: 0,
});

// Levels from anything stored, a saved legacy or a recorded play: an upgrade it does not have (one added since) is
// level 0, and so is a value that is not a level.
const levelSchema = z.number().int().min(0).max(MAX_LEVEL);
export function levelsOf(stored: unknown): Levels {
  const levels = emptyLevels();
  if (typeof stored !== "object" || stored === null) return levels;
  for (const id of UPGRADE_IDS) {
    const parsed = levelSchema.safeParse(Reflect.get(stored, id));
    if (parsed.success) levels[id] = parsed.data;
  }
  return levels;
}
