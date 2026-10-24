// Was the player there? An engagement summary worked out from a recorded night, so a night that was left alone, or
// played with the tab away, is never taken for a night that was too hard. Pure and shared: the game reads it at night end
// for the rules' director, the server for the model's.
//
// What a recording keeps. The inputs are recorded when they change (a move, a strike, a shot), so the share of the night
// spent moving and the strikes and shots come straight from them. Time away is not in the sim: the sim only advances
// while frames are drawn, so a hidden tab stops it, and a frame that is long is clamped to 50 ms (Scene.tsx). So the
// time away is the real time minus the sim's, and the recorder keeps the real time: `wallSeconds`, from a monotonic clock
// (performance.now()), not from `startedAt` and the server's `receivedAt`, which come from two clocks that can disagree by
// minutes. A play without it (from before it was kept) has no pause time: it is judged on its inputs alone.
import type { EngagementKind } from "./director";

/** Moving for less of the night than this, and acting less often than ACTIONS_PER_MINUTE, is idle. */
const IDLE_MOVING_SHARE = 0.15;
/** Strikes and shots a minute. A warden who stands still but fights is engaged: the fixture nights that move least still act 26 times a minute. */
const IDLE_ACTIONS_PER_MINUTE = 6;
/** More than this share of the real time spent away (and at least PAUSED_MINIMUM_SECONDS of it) is mostly paused. */
const PAUSED_SHARE = 0.5;
const PAUSED_MINIMUM_SECONDS = 10;
const STEPS_PER_SECOND = 60;

/** The parts of a recorded play the summary reads (a stored play and the recorder's both fit). */
export interface RecordedEngagement {
  inputs: readonly (readonly number[])[];
  steps: number;
  outcome: string | null;
  wallSeconds?: number | undefined;
}

export interface Engagement {
  kind: EngagementKind;
  simSeconds: number;
  /** The share of the night the warden was moving (0 to 1). */
  movingShare: number;
  strikes: number;
  shots: number;
  /** Rows of input recorded: every change of direction, every strike and shot. */
  inputChanges: number;
  actionsPerMinute: number;
  /** Real time from the night's start to its end, when the recording kept it. */
  wallSeconds: number | null;
  /** Real time minus the sim's, when both are known: the time the tab was away or the frames too slow to count. */
  pausedSeconds: number | null;
  pausedShare: number | null;
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const hundredth = (value: number) => Math.round(value * 100) / 100;

/**
 * The classification, in order: left (the night did not finish, so it says nothing about how hard it was), paused (most of
 * the real time was spent away), idle (hardly moving and hardly acting), engaged.
 */
export function engagementOf(play: RecordedEngagement): Engagement {
  const { inputs, steps } = play;
  const simSeconds = steps / STEPS_PER_SECOND;
  let movingSteps = 0;
  let strikes = 0;
  let shots = 0;
  for (const [index, row] of inputs.entries()) {
    const [start = 0, moveX = 0, moveY = 0, melee = 0, ranged = 0] = row;
    const end = inputs[index + 1]?.[0] ?? steps;
    if (moveX !== 0 || moveY !== 0) movingSteps += Math.max(0, end - start);
    if (melee) strikes++;
    if (ranged) shots++;
  }
  const movingShare = steps > 0 ? Math.min(1, movingSteps / steps) : 0;
  const actionsPerMinute = simSeconds > 0 ? (strikes + shots) / (simSeconds / 60) : 0;
  const wallSeconds = play.wallSeconds ?? null;
  const pausedSeconds = wallSeconds === null ? null : Math.max(0, wallSeconds - simSeconds);
  const pausedShare =
    wallSeconds === null || wallSeconds <= 0 || pausedSeconds === null ? null : pausedSeconds / wallSeconds;

  let kind: EngagementKind = "engaged";
  if (play.outcome === null) kind = "left";
  else if (pausedShare !== null && pausedShare > PAUSED_SHARE && (pausedSeconds ?? 0) >= PAUSED_MINIMUM_SECONDS)
    kind = "paused";
  else if (movingShare < IDLE_MOVING_SHARE && actionsPerMinute < IDLE_ACTIONS_PER_MINUTE) kind = "idle";

  return {
    kind,
    simSeconds: tenth(simSeconds),
    movingShare: hundredth(movingShare),
    strikes,
    shots,
    inputChanges: inputs.length,
    actionsPerMinute: tenth(actionsPerMinute),
    wallSeconds: wallSeconds === null ? null : tenth(wallSeconds),
    pausedSeconds: pausedSeconds === null ? null : tenth(pausedSeconds),
    pausedShare: pausedShare === null ? null : hundredth(pausedShare),
  };
}
