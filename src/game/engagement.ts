// Was the player there? An engagement summary worked out from a recorded night, so a night that was left alone, or
// played with the tab away, is never taken for a night that was too hard. Pure and shared: the game reads it at night end
// for the rules' director, the server for the model's.
//
// What a recording keeps. The inputs are recorded when they change (a move, a strike, a shot), so the share of the night
// spent moving and the strikes and shots come straight from them. There is no pause button in a night; the way a night is
// paused is the tab being hidden, which stops the sim (it only advances while frames are drawn). The sim cannot say how long,
// so the recorder keeps it: `hiddenSeconds`, the time the tab was hidden during the night, from a monotonic clock and the
// page's visibility events (not from `startedAt` and the server's `receivedAt`, two clocks that can disagree by minutes, and
// not from the real time minus the sim's, which would read a slow device or a slow start as time away). The real time of the
// night is then the sim's plus that. A play without it (from before it was kept) is judged on its inputs alone.
//
// The recording is the client's, so this holds for an honest client: one that hides what it does, or leaves the field out,
// is judged on what it sent.
import { type EngagementKind, mayEase } from "./director-decision";

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
  /** Seconds the tab was hidden during the night, when the recorder kept it. */
  hiddenSeconds?: number | undefined;
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
  /** The simulated time plus the time hidden, when the recording kept the latter. */
  wallSeconds: number | null;
  /** The time the tab was hidden, when the recording kept it. */
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
    if (moveX !== 0 || moveY !== 0) {
      movingSteps += Math.max(0, end - start);
    }
    if (melee) {
      strikes++;
    }
    if (ranged) {
      shots++;
    }
  }
  const movingShare = steps > 0 ? Math.min(1, movingSteps / steps) : 0;
  const actionsPerMinute = simSeconds > 0 ? (strikes + shots) / (simSeconds / 60) : 0;
  const pausedSeconds = play.hiddenSeconds === undefined ? null : Math.max(0, play.hiddenSeconds);
  const wallSeconds = pausedSeconds === null ? null : simSeconds + pausedSeconds;
  const pausedShare =
    wallSeconds === null || pausedSeconds === null || wallSeconds <= 0 ? null : pausedSeconds / wallSeconds;

  let kind: EngagementKind = "engaged";
  if (play.outcome === null) {
    kind = "left";
  } else if (pausedShare !== null && pausedShare > PAUSED_SHARE && (pausedSeconds ?? 0) >= PAUSED_MINIMUM_SECONDS) {
    kind = "paused";
  } else if (movingShare < IDLE_MOVING_SHARE && actionsPerMinute < IDLE_ACTIONS_PER_MINUTE) {
    kind = "idle";
  }

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

/**
 * The tide the rules pick after a night: `next` (what `nextTide` made of the night), but after a night that was not engaged
 * never below the tide the night was played at. A loss nobody played says nothing about how hard the night was.
 */
export function heldTide(playedTide: number, next: number, engagement: EngagementKind | undefined): number {
  return mayEase(engagement) ? next : Math.max(next, playedTide);
}
