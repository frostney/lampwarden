// A creature's animation frames: the extension of the creature record (src/game/creature.ts) that lets the game animate
// a creature from the sea. The server renders a frame set from the creature's own build code (it takes its pose from
// the runner's POSE), packs it into one atlas PNG and stores it beside the record, which then carries `frames`, how many
// frames each animation has. A record without `frames` is a creature from before animation (or one whose frames could
// not be made): it keeps its single sprite and stands still.
//
// This file is deliberately not part of creature.ts: that file is in the sim fingerprint, and frames are only ever
// drawn, never played (the sim neither reads nor writes them), so adding them must not make old recordings unplayable.
import { z } from "zod";

import { CREATURE_API, creatureSchema } from "./creature";

const CREATURE_ANIMATIONS = ["idle", "walk", "attack"] as const;
export type CreatureAnimation = (typeof CREATURE_ANIMATIONS)[number];

/** How many frames of each animation the server renders: the hand-made hero's counts (src/scene/assets.ts) for idle and walk, and its melee swing for attack. */
export const CREATURE_FRAME_COUNTS: Record<CreatureAnimation, number> = { idle: 4, walk: 6, attack: 5 };
/** The pace each animation plays at: the hero's idle, walk and melee rates (FRAMES_PER_SECOND in src/scene/assets.ts). */
export const CREATURE_FRAMES_PER_SECOND: Record<CreatureAnimation, number> = { idle: 6, walk: 10, attack: 14 };
export const CREATURE_FRAME_SIZE = 128;
/** The builder's pose names for a frame (`walk3`), which is also the render's name: `idle1`..`idle4`, `walk1`..`walk6`, `attack1`..`attack5`. */
export const creaturePoseName = (animation: CreatureAnimation, frame: number) => `${animation}${frame + 1}`;

const frameCount = z.number().int().min(1).max(8);
export const creatureFramesSchema = z.object({ idle: frameCount, walk: frameCount, attack: frameCount });
export type CreatureFrames = z.infer<typeof creatureFramesSchema>;

/** The record as the gallery stores it and the API serves it: the contract's creature plus the optional frame counts. */
export const creatureRecordSchema = creatureSchema.extend({ frames: creatureFramesSchema.optional() });
export type CreatureRecord = z.infer<typeof creatureRecordSchema>;

export const creatureAtlasPath = (id: string) => `${CREATURE_API}/${id}/atlas.png`;

export interface AtlasCell {
  animation: CreatureAnimation;
  frame: number;
  /** In pixels, from the atlas's top left. */
  x: number;
  y: number;
}

/**
 * Where each frame is in the atlas: a row for each animation in turn (idle, walk, attack) and a column for each frame,
 * 128 px cells, as wide as the longest animation. The layout follows from the counts, so the record needs no more.
 */
export function creatureAtlasLayout(frames: CreatureFrames): { width: number; height: number; cells: AtlasCell[] } {
  const columns = Math.max(frames.idle, frames.walk, frames.attack);
  const cells = CREATURE_ANIMATIONS.flatMap((animation, row) =>
    Array.from({ length: frames[animation] }, (_unused, frame) => ({
      animation,
      frame,
      x: frame * CREATURE_FRAME_SIZE,
      y: row * CREATURE_FRAME_SIZE,
    })),
  );
  return {
    width: columns * CREATURE_FRAME_SIZE,
    height: CREATURE_ANIMATIONS.length * CREATURE_FRAME_SIZE,
    cells,
  };
}
