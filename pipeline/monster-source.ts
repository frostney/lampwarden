// Where the hand-made monsters' frames come from: the committed sprite code (public/sprites/<kind>.ts, which takes its pose
// from POSE like the generator's code) drawn from every direction and in every pose of idle, walk and attack, on the canvas
// the still was drawn on (src/scene/monster-frames.json records it, drawn smaller when a figure is too big for the
// canvas, and how far each frame was slid along its cell). `assets:monsters` writes the atlases and that file;
// `check:pixels` reads both, so they agree.
import { join } from "node:path";

import { creatureAtlasLayout } from "../src/game/creature-frames";
import { SHEET_CANVASES, SHEET_FRAMES, type SheetKind } from "../src/scene/monster-sheets";
import { frameRequests } from "./creature-frames";
import type { RenderRequest } from "./render-types";

export const MONSTER_DIRECTORY = join(import.meta.dir, "..", "public", "sprites");
export const monsterCodePath = (kind: SheetKind) => join(MONSTER_DIRECTORY, `${kind}.ts`);
export const monsterAtlasFile = (kind: SheetKind) => join(MONSTER_DIRECTORY, `${kind}-frames.png`);
export const MONSTER_FRAMES_FILE = join(import.meta.dir, "..", "src", "scene", "monster-frames.json");

export interface MonsterFrameBuild {
  /** The render, named for the monster, the direction and the pose: `satyr_ne_walk3`. */
  request: RenderRequest;
  /** Where the frame is in the monster's atlas, in pixels. */
  x: number;
  y: number;
  /** How far the frame was slid along its cell, as recorded: the render's slides must come to the same. */
  shift: readonly [number, number];
}

/** The 75 frame renders of a monster, in its atlas's order, each with its cell, on the canvas recorded for it. */
export function monsterFrameBuilds(kind: SheetKind, code: string): MonsterFrameBuild[] {
  const requests = frameRequests(code, SHEET_CANVASES[kind]);
  return creatureAtlasLayout(SHEET_FRAMES[kind]).cells.map((cell, index) => {
    const request = requests[index];
    if (!request) {
      throw new Error(`${kind}: no render for cell ${index}`);
    }
    return { request: { ...request, name: `${kind}_${request.name}` }, x: cell.x, y: cell.y, shift: cell.shift };
  });
}
