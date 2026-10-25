// Which frame of its animation a monster with frames shows (a creature from the sea, or one of the hand-made three), from what
// the sim already says about it. Drawing only: the sim never reads this, and a monster without frames shows its one sprite
// as it did before.
//
// The creature walks while it travels towards a lamp or the warden, claws (the attack frames) while it snuffs a lamp
// and for the first moments after a blow on the warden, and stands (idle) when it waits for its next blow or is held by a
// hit. Each animation runs at the warden's own rate for it (CREATURE_FRAMES_PER_SECOND), from the monster's own age, so a
// creature's feet do not move in step with its neighbour's.
import {
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAMES_PER_SECOND,
  type CreatureAnimation,
  type CreatureDirection,
  type CreatureFrames,
  creaturePoseName,
} from "../game/creature-frames";
import { ground, type Monster } from "../game/sim";

/** What the sim sets a monster's `attackCooldown` to when it strikes the warden (src/game/sim.ts, "claw the warden"). */
const CLAW_COOLDOWN = 1.1;
/** Within this ground distance of the warden a monster stands and claws instead of walking (the sim's 26). */
export const CLAW_REACH = 26;

/**
 * The texture key of one frame of a sheet, seen from one direction, such as `creature/<id>/ne/walk3`: the sheet is a
 * creature's key (`creature/<id>`) or a hand-made monster's kind (`satyr`).
 */
export const sheetFrameKey = (
  sheet: string,
  direction: CreatureDirection,
  animation: CreatureAnimation,
  frame: number,
) => `${sheet}/${direction}/${creaturePoseName(animation, frame)}`;

export interface CreatureFrameChoice {
  animation: CreatureAnimation;
  frame: number;
}

const loopFrame = (seconds: number, animation: CreatureAnimation, counts: CreatureFrames) =>
  Math.floor(seconds * CREATURE_FRAMES_PER_SECOND[animation]) % Math.max(1, counts[animation]);

/** The frame a monster that is a creature shows now. `hero` is where the warden stands. */
export function creatureFrameOf(
  monster: Pick<Monster, "x" | "y" | "age" | "snuff" | "attackCooldown" | "stun">,
  hero: { x: number; y: number },
  counts: CreatureFrames = CREATURE_FRAME_COUNTS,
): CreatureFrameChoice {
  // clawing a lamp: the attack frames, round and round while the lamp is being put out
  if (monster.snuff > 0) {
    return { animation: "attack", frame: loopFrame(monster.snuff, "attack", counts) };
  }
  // the blow on the warden: the attack frames once, from the moment of the blow
  const sinceBlow = CLAW_COOLDOWN - monster.attackCooldown;
  const blowLasts = counts.attack / CREATURE_FRAMES_PER_SECOND.attack;
  if (monster.attackCooldown > 0 && sinceBlow < blowLasts) {
    return {
      animation: "attack",
      frame: Math.min(counts.attack - 1, Math.floor(sinceBlow * CREATURE_FRAMES_PER_SECOND.attack)),
    };
  }
  const waiting = monster.stun > 0 || ground(monster.x, monster.y, hero.x, hero.y) < CLAW_REACH;
  if (waiting) {
    return { animation: "idle", frame: loopFrame(monster.age, "idle", counts) };
  }
  return { animation: "walk", frame: loopFrame(monster.age, "walk", counts) };
}
