// Replaying a recording: the fixed step, input quantisation, the Replayer that feeds a recording's inputs back, and the
// headless check that a night ends where it was played. These decide what a night does, so this file is covered by the
// sim fingerprint (tools/sim-fingerprint); the Recorder and the upload live in recording.ts and are not.
import { recordedCreatureSchema } from "./creature";
import { directorFrom } from "./director";
import { type Legacy, levelsOf } from "./legacy";
import type { Play } from "./recording";
import { type Input, type NightCreature, newNight, nightCreature, type State, step } from "./sim";

export const STEP = 1 / 60;

// Inputs are quantised before they reach the sim, so live play and replay see identical numbers.
export function quantise(input: Input): Input {
  return input.aim ? { ...input, aim: { x: Math.round(input.aim.x), y: Math.round(input.aim.y) } } : input;
}

// Feeds a recording's inputs back step by step.
export class Replayer {
  private nextRow = 0;
  private current: Input = { moveX: 0, moveY: 0, melee: false, ranged: false, aim: null };
  constructor(public play: Play) {}
  input(stepIndex: number): Input {
    const rows = this.play.inputs;
    let edge = false;
    let row = rows[this.nextRow];
    while (row && row[0] <= stepIndex) {
      const [rowStep, moveX, moveY, melee, ranged, aimX, aimY] = row;
      this.current = {
        moveX,
        moveY,
        melee: melee === 1,
        ranged: ranged === 1,
        aim: aimX >= 0 ? { x: aimX, y: aimY } : null,
      };
      edge = rowStep === stepIndex;
      this.nextRow++;
      row = rows[this.nextRow];
    }
    return edge ? this.current : { ...this.current, melee: false, ranged: false };
  }
}

export function legacyOf(play: Play): Legacy {
  return {
    ...play.legacy,
    levels: levelsOf(play.legacy.levels),
    director: directorFrom(play.legacy.director, play.legacy.tide, play.legacy.night),
    bestiary: [],
    offerSeed: 0,
    offers: [],
    bestNight: 0,
    oil: 0,
    fallen: [],
  };
}

// The night's creature as a recording names it; a recording from before creatures (or one the API would not have
// stored) has none, and its night has no creature.
export function creatureOf(play: Play): NightCreature | null {
  const parsed = recordedCreatureSchema.safeParse(play.creature);
  return parsed.success ? nightCreature(parsed.data) : null;
}

// Replays a recording headlessly and reports whether it ends where the live play ended: the same outcome on the same
// step, with the same kills, lamps lost, health and oil.
export function verifyPlay(play: Play): { state: State; endsMatch: boolean } {
  const state = newNight(legacyOf(play), play.seed, creatureOf(play));
  const replayer = new Replayer(play);
  let stepIndex = 0;
  for (; stepIndex < play.steps && !state.outcome; stepIndex++) step(state, STEP, replayer.input(stepIndex));
  const endsMatch =
    state.outcome === play.outcome &&
    stepIndex === play.steps &&
    state.stats.kills === play.stats.kills &&
    state.stats.lampsLost === play.stats.lampsLost &&
    Math.ceil(state.hero.health) === play.stats.hp &&
    state.oilEarned === play.stats.oilEarned;
  return { state, endsMatch };
}
