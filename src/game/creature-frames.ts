// A creature's animation frames: the extension of the creature record (src/game/creature.ts) that lets the game animate
// a creature from the sea. The server renders a frame set from the creature's own build code (it takes its pose from
// the runner's POSE and its direction from the kit's turn), packs it into one atlas PNG and stores it beside the record,
// which then carries `frames`: how many frames each animation has and, for a creature drawn from every side, which
// directions. A record without `frames` is a creature from before animation (or one whose frames could not be made): it
// keeps its single sprite and stands still. A record whose `frames` has no `directions` has one direction, south-east,
// which the game flips as it does the other monsters. A frame whose figure (a spear thrust, a raised club) did not fit
// its cell was drawn slid along it; `shifts` says how far, and the game draws the frame that far the other way.
//
// This file is deliberately not part of creature.ts: that file is in the sim fingerprint, and frames are only ever
// drawn, never played (the sim neither reads nor writes them), so adding them must not make old recordings unplayable.
import { z } from "zod";

import { CREATURE_API, creatureSchema } from "./creature";

const CREATURE_ANIMATIONS = ["idle", "walk", "attack"] as const;
export type CreatureAnimation = (typeof CREATURE_ANIMATIONS)[number];

/**
 * The directions a creature is drawn from, the warden's five (DRAWN_DIRECTIONS in src/scene/assets.ts, which a test holds
 * this to): east, south-east, south, north-east and north. The other three are these mirrored, as the warden's are.
 */
export const CREATURE_DIRECTIONS = ["e", "se", "s", "ne", "n"] as const;
export type CreatureDirection = (typeof CREATURE_DIRECTIONS)[number];
/** The one direction of a creature that was drawn from a single side: the one its sprite faces. */
export const STILL_DIRECTION: CreatureDirection = "se";

/** How many frames of each animation the server renders: the hand-made hero's counts (src/scene/assets.ts) for idle and walk, and its melee swing for attack. */
export const CREATURE_FRAME_COUNTS: Record<CreatureAnimation, number> = { idle: 4, walk: 6, attack: 5 };
/** The pace each animation plays at: the hero's idle, walk and melee rates (FRAMES_PER_SECOND in src/scene/assets.ts). */
export const CREATURE_FRAMES_PER_SECOND: Record<CreatureAnimation, number> = { idle: 6, walk: 10, attack: 14 };
export const CREATURE_FRAME_SIZE = 128;
/** The builder's pose names for a frame (`walk3`), which is also the render's name: `idle1`..`idle4`, `walk1`..`walk6`, `attack1`..`attack5`. */
export const creaturePoseName = (animation: CreatureAnimation, frame: number) => `${animation}${frame + 1}`;

const MAX_FRAMES = 8; // in one animation
const MAX_CELLS = 120; // in one atlas: every frame of every animation from every side, and room to spare
const frameCount = z.number().int().min(1).max(MAX_FRAMES);
const directionList = z
  .array(z.enum(CREATURE_DIRECTIONS))
  .min(1)
  .max(CREATURE_DIRECTIONS.length)
  .refine((directions) => new Set(directions).size === directions.length, "a direction twice");
/** How far a frame was slid along its cell, in pixels: across, then down. */
const cellOffset = z.number().int().min(-CREATURE_FRAME_SIZE).max(CREATURE_FRAME_SIZE);
const cellShift = z.tuple([cellOffset, cellOffset]);
export const creatureFramesSchema = z.object({
  idle: frameCount,
  walk: frameCount,
  attack: frameCount,
  /** The directions the atlas has a column for, in order; none means one direction (south-east) in a row of frames. */
  directions: directionList.optional(),
  /** For each cell of the atlas, in `creatureAtlasLayout`'s order, how far its figure was slid from where it stands; none means none was. */
  shifts: z.array(cellShift).max(MAX_CELLS).optional(),
});
export type CreatureFrames = z.infer<typeof creatureFramesSchema>;

/** The frames of a creature drawn from every side, with the usual counts. */
export const CREATURE_ALL_DIRECTIONS: CreatureFrames = {
  ...CREATURE_FRAME_COUNTS,
  directions: [...CREATURE_DIRECTIONS],
};

/** The record as the gallery stores it and the API serves it: the contract's creature plus the optional frame counts. */
export const creatureRecordSchema = creatureSchema.extend({ frames: creatureFramesSchema.optional() });
export type CreatureRecord = z.infer<typeof creatureRecordSchema>;

export const creatureAtlasPath = (id: string) => `${CREATURE_API}/${id}/atlas.png`;

export interface AtlasCell {
  animation: CreatureAnimation;
  frame: number;
  direction: CreatureDirection;
  /** In pixels, from the atlas's top left. */
  x: number;
  y: number;
  /** How far the frame was slid along its cell to keep its figure inside it: across, down. [0, 0] when it was not. */
  shift: readonly [number, number];
}

/**
 * Where each frame is in the atlas. A creature with `directions` has a column for each direction and a row for each frame
 * of each animation in turn (idle, walk, attack), the warden's layout. One without has a row for each animation and a
 * column for each frame, as wide as the longest animation, all of them south-east. 128 px cells either way; the layout
 * follows from the record's `frames`, so it needs no more. Each cell says how far its frame was slid along it (`shifts`,
 * which counts only when it has a shift for every cell).
 */
export function creatureAtlasLayout(frames: CreatureFrames): { width: number; height: number; cells: AtlasCell[] } {
  const { directions } = frames;
  const placed =
    (shift: (index: number) => readonly [number, number]) => (cell: Omit<AtlasCell, "shift">, index: number) => ({
      ...cell,
      shift: shift(index),
    });
  let size: { width: number; height: number };
  let cells: Omit<AtlasCell, "shift">[];
  if (directions) {
    cells = directions.flatMap((direction, column) => {
      let row = 0;
      return CREATURE_ANIMATIONS.flatMap((animation) =>
        Array.from({ length: frames[animation] }, (_unused, frame) => ({
          animation,
          frame,
          direction,
          x: column * CREATURE_FRAME_SIZE,
          y: row++ * CREATURE_FRAME_SIZE,
        })),
      );
    });
    const rows = CREATURE_ANIMATIONS.reduce((total, animation) => total + frames[animation], 0);
    size = { width: directions.length * CREATURE_FRAME_SIZE, height: rows * CREATURE_FRAME_SIZE };
  } else {
    cells = CREATURE_ANIMATIONS.flatMap((animation, row) =>
      Array.from({ length: frames[animation] }, (_unused, frame) => ({
        animation,
        frame,
        direction: STILL_DIRECTION,
        x: frame * CREATURE_FRAME_SIZE,
        y: row * CREATURE_FRAME_SIZE,
      })),
    );
    const columns = Math.max(frames.idle, frames.walk, frames.attack);
    size = { width: columns * CREATURE_FRAME_SIZE, height: CREATURE_ANIMATIONS.length * CREATURE_FRAME_SIZE };
  }
  const { shifts } = frames;
  const shiftOf =
    shifts && shifts.length === cells.length ? (index: number) => shifts[index] ?? NO_SHIFT : () => NO_SHIFT;
  return { ...size, cells: cells.map(placed(shiftOf)) };
}

const NO_SHIFT: readonly [number, number] = [0, 0];
