// The practice night: a staged night (staged.ts) that teaches the watch one lesson at a time, each waiting for the
// player to do it. Walk; strike a satyr; shoot a harpy; relight a lamp the sea put out; then hold the plaza against a
// small wave. The night cannot be lost (spare), it is not recorded and it earns nothing: the oil its kills leave stays in
// the state and never reaches the legacy.
import type { Legacy } from "./legacy";
import { ground, type HandMadeKind, type Lamp, type State } from "./sim";
import { rimAngleOf, snuff, spare, stagedNight, summon } from "./staged";

export const LESSONS = ["move", "strike", "shoot", "relight", "hold"] as const;
export type Lesson = (typeof LESSONS)[number] | "done";

// how far the warden walks, on the ground, before the first lesson is learned
const WALK = 90;
// a lesson's monster comes ashore this long after the lesson begins, so its words are read first
const SUMMON_DELAY = 0.8;
// the lamp the sea puts out for the relight lesson is the nearest one at least this far away, so there is a walk to it
const RELIGHT_WALK = 110;
// the closing wave: who comes, a beat apart, from around the rim (turns from the side the warden is on)
const WAVE: { kind: HandMadeKind; turn: number }[] = [
  { kind: "satyr", turn: 0.5 },
  { kind: "satyr", turn: -0.5 },
  { kind: "harpy", turn: 1 },
  { kind: "satyr", turn: 0 },
];
const WAVE_GAP = 1.4;

export interface Practice {
  state: State;
  lesson: Lesson;
  since: number; // the sim seconds the lesson began at
  startX: number; // where the warden stood when the lesson began
  startY: number;
  summoned: number; // how many of the lesson's monsters have come ashore
  kills: number; // the night's kills when the lesson began
  lamp: Lamp | null; // the relight lesson's dark lamp
}

export function newPractice(legacy: Pick<Legacy, "heir" | "levels">, seed: number): Practice {
  const state = stagedNight(legacy, seed);
  return {
    state,
    lesson: "move",
    since: 0,
    startX: state.hero.x,
    startY: state.hero.y,
    summoned: 0,
    kills: 0,
    lamp: null,
  };
}

/** The lessons' place in the practice: 1 for the first, LESSONS.length once done. */
export const lessonNumber = (lesson: Lesson) => (lesson === "done" ? LESSONS.length : LESSONS.indexOf(lesson) + 1);

function begin(practice: Practice, lesson: Lesson) {
  const { state } = practice;
  practice.lesson = lesson;
  practice.since = state.elapsed;
  practice.startX = state.hero.x;
  practice.startY = state.hero.y;
  practice.summoned = 0;
  practice.kills = state.stats.kills;
  practice.lamp = null;
}

// The lamp the relight lesson is about, the nearest a walk away: one the sea already put out, else a lit one put out now
// (the farthest lamp when none is a walk away). A dark lamp right by the warden would light again before the lesson is
// read.
function lampToRelight(state: State): Lamp | null {
  const { hero } = state;
  const byDistance = state.lamps
    .map((lamp) => ({ lamp, distance: ground(lamp.x, lamp.y, hero.x, hero.y) }))
    .sort((first, second) => first.distance - second.distance);
  const away = byDistance.filter(({ distance }) => distance >= RELIGHT_WALK);
  const chosen = away.find(({ lamp }) => !lamp.lit) ?? away[0] ?? byDistance.at(-1);
  if (!chosen) {
    return null;
  }
  if (chosen.lamp.lit) {
    snuff(state, chosen.lamp);
  }
  return chosen.lamp;
}

// Before each step: the lesson's staging (what comes ashore, which lamp goes out), and whether it has been learned.
export function stagePractice(practice: Practice) {
  const { state } = practice;
  spare(state, practice.lamp);
  const since = state.elapsed - practice.since;
  const side = rimAngleOf(state.hero.x, state.hero.y);
  switch (practice.lesson) {
    case "move":
      if (ground(practice.startX, practice.startY, state.hero.x, state.hero.y) >= WALK) {
        begin(practice, "strike");
      }
      return;
    case "strike":
    case "shoot":
      stageFight(practice, since, side);
      return;
    case "relight":
      stageRelight(practice);
      return;
    case "hold":
      stageHold(practice, since, side);
      return;
    case "done":
      return;
  }
}

// the strike and shoot lessons: one creature to slay, then on to the next lesson
function stageFight(practice: Practice, since: number, side: number) {
  const { state } = practice;
  if (practice.summoned === 0) {
    if (since < SUMMON_DELAY) {
      return;
    }
    // the satyr comes ashore on the warden's side, to walk up to; the harpy on the far side, to shoot at
    summon(
      state,
      practice.lesson === "strike" ? "satyr" : "harpy",
      practice.lesson === "strike" ? side : side + Math.PI,
    );
    practice.summoned = 1;
    return;
  }
  const slain = state.stats.kills - practice.kills;
  if (slain >= 1 && state.monsters.length === 0) {
    begin(practice, practice.lesson === "strike" ? "shoot" : "relight");
  }
}

// the relight lesson: a lamp goes out, and is learned once it is lit again
function stageRelight(practice: Practice) {
  if (!practice.lamp) {
    practice.lamp = lampToRelight(practice.state);
    return;
  }
  if (practice.lamp.lit) {
    begin(practice, "hold");
  }
}

// the last lesson: a wave to hold the plaza against
function stageHold(practice: Practice, since: number, side: number) {
  const { state } = practice;
  const entry = WAVE[practice.summoned];
  if (entry && since >= SUMMON_DELAY + WAVE_GAP * practice.summoned) {
    summon(state, entry.kind, side + Math.PI * entry.turn);
    practice.summoned++;
  }
  if (practice.summoned === WAVE.length && state.monsters.length === 0) {
    begin(practice, "done");
  }
}
