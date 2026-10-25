// The hand-made monsters' frames, as the live creatures' are: for each of the satyr, cyclops and harpy one atlas
// (public/sprites/<kind>-frames.png) of every direction (the warden's five, the others mirrored) and every frame of idle,
// walk and attack, laid out as a creature's atlas is (src/game/creature-frames.ts). pipeline/monster-frames.ts draws them
// from the committed sprite code, on the canvas its still was drawn on, and records that canvas and how far each frame was
// slid along its cell in monster-frames.json; the scene cuts one texture a frame out of each atlas when it loads and draws
// a frame that far the other way. Kept out of assets.ts, which the sim fingerprint covers, because frames are only ever
// drawn.
import { z } from "zod";
import { CREATURE_ALL_DIRECTIONS, type CreatureFrames, creatureFramesSchema } from "../game/creature-frames";
import recorded from "./monster-frames.json";

export const SHEET_KINDS = ["satyr", "cyclops", "harpy"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

const canvasSchema = z.object({ scale: z.number().positive(), dx: z.number(), dy: z.number() });
const sheetSchema = z.object({ canvas: canvasSchema, shifts: creatureFramesSchema.shape.shifts.unwrap().length(75) });
const recordedSchema = z.object({ satyr: sheetSchema, cyclops: sheetSchema, harpy: sheetSchema });

const sheets = recordedSchema.parse(recorded);

/** The canvas each monster's frames were drawn on: how big, and where the ground origin is. */
export const SHEET_CANVASES = {
  satyr: sheets.satyr.canvas,
  cyclops: sheets.cyclops.canvas,
  harpy: sheets.harpy.canvas,
} as const;

/** The frames each hand-made monster has: the creatures' counts, from every direction, each slid as recorded. */
export const SHEET_FRAMES: Record<SheetKind, CreatureFrames> = {
  satyr: { ...CREATURE_ALL_DIRECTIONS, shifts: sheets.satyr.shifts },
  cyclops: { ...CREATURE_ALL_DIRECTIONS, shifts: sheets.cyclops.shifts },
  harpy: { ...CREATURE_ALL_DIRECTIONS, shifts: sheets.harpy.shifts },
};

export const monsterAtlasPath = (kind: SheetKind) => `/sprites/${kind}-frames.png`;
export const monsterAtlasKey = (kind: SheetKind) => `monster-atlas/${kind}`;

export const isSheetKind = (kind: string): kind is SheetKind => SHEET_KINDS.some((sheetKind) => sheetKind === kind);
