// Play recording for testing and balancing. A night is fully determined by its seed, the legacy it started from and the
// warden's inputs at a fixed 60 Hz step, so a recording is just those inputs (only when they change) plus a per-second
// timeline that the balance analysis can read without replaying anything. Nothing here decides how a night plays out
// (that is the sim and replay.ts), so editing this file does not change the sim fingerprint (tools/sim-fingerprint).
import { z } from "zod";

import { MILLISECONDS_PER_SECOND } from "../lib/units";
import type { RecordedCreature } from "./creature";
import type { Legacy } from "./legacy";
import { type Input, litCount, type State } from "./sim";

// [step, moveX, moveY, melee, ranged, aimX, aimY]   (aim -1,-1 = no aim)
type InputRow = [number, number, number, number, number, number, number];
// [second, kills, lampsLit, health, monsters, lampsLost]
type TimelineRow = [number, number, number, number, number, number];

export interface Play {
  v: 1;
  id: string;
  session: string; // random per browser, no personal data
  build: string; // git sha of the deployment, when known
  sim?: string | undefined; // fingerprint of the sim sources the night was played on (tools/sim-fingerprint); old plays have none
  startedAt: string;
  seed: number;
  // levels as recorded: a play from before an upgrade existed has no entry for it (level 0, see legacyOf). The director
  // is the decision the night was played under (mix and creature share); a play from before it has none (the rules').
  legacy: Pick<Legacy, "night" | "generation" | "tide" | "heir"> & {
    levels: Partial<Legacy["levels"]>;
    director?: unknown;
  };
  // the creature from the sea that joined the night, when one did; a play from before creatures has none
  creature?: RecordedCreature | undefined;
  inputs: InputRow[];
  timeline: TimelineRow[];
  steps: number;
  outcome: string | null; // dawn | dark | fallen | null when abandoned
  // hp and maxHp are the warden's health and maxHealth; the keys stay as recorded so stored plays still read
  stats: State["stats"] & { oilEarned: number; hp: number; maxHp: number; lit: number };
  // Seconds the tab was hidden during the night (it stops the sim; src/game/engagement.ts reads it as time away). Plays from
  // before it was kept have none.
  hiddenSeconds?: number | undefined;
  replay?: { endsMatch: boolean } | undefined; // filled in when a recording is verified by replay
}

const BASE_36 = 36;
const ISO_TO_SECONDS = 19; // "2026-10-24T16:11:46", the start of an ISO time
const randomId = () => Math.random().toString(BASE_36).slice(2, 10);
function sessionId(): string {
  try {
    let session = localStorage.getItem("lampwarden:session");
    if (!session) {
      session = randomId() + randomId();
      localStorage.setItem("lampwarden:session", session);
    }
    return session;
  } catch {
    return "anon";
  }
}

export class Recorder {
  play: Play;
  private last: InputRow | null = null;
  private hiddenSeconds = 0;
  private hiddenSince: number | null = null;
  // the tab's visibility, kept for the night: a hidden tab is the one way a night is paused
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenSince ??= performance.now();
    } else {
      this.closeHidden();
    }
  };
  private closeHidden() {
    if (this.hiddenSince === null) {
      return;
    }
    this.hiddenSeconds += (performance.now() - this.hiddenSince) / MILLISECONDS_PER_SECOND;
    this.hiddenSince = null;
  }
  constructor(legacy: Legacy, seed: number, build: string, creature: RecordedCreature | null = null, sim?: string) {
    if (typeof document !== "undefined") {
      if (document.visibilityState === "hidden") {
        this.hiddenSince = performance.now();
      }
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    const { night, generation, tide, levels, heir, director } = legacy;
    this.play = {
      v: 1,
      id: `${new Date().toISOString().slice(0, ISO_TO_SECONDS).replace(/[:T]/g, "-")}-${randomId()}`,
      session: sessionId(),
      build,
      ...(sim ? { sim } : {}),
      startedAt: new Date().toISOString(),
      seed,
      legacy: structuredClone({ night, generation, tide, levels, heir, director }),
      ...(creature ? { creature: structuredClone(creature) } : {}),
      inputs: [],
      timeline: [],
      steps: 0,
      outcome: null,
      stats: { kills: 0, lampsLost: 0, hpLost: 0, time: 0, oilEarned: 0, hp: 0, maxHp: 0, lit: 0 },
    };
  }
  // call once per sim step with the input about to be applied; state is the state after steps 0..stepIndex-1
  input(stepIndex: number, input: Input, state: State) {
    this.play.steps = stepIndex + 1;
    if (stepIndex > 0 && stepIndex % 60 === 0) {
      this.play.timeline.push([
        stepIndex / 60,
        state.stats.kills,
        litCount(state),
        Math.ceil(state.hero.health),
        state.monsters.length,
        state.stats.lampsLost,
      ]);
    }
    const row: InputRow = [
      stepIndex,
      input.moveX,
      input.moveY,
      input.melee ? 1 : 0,
      input.ranged ? 1 : 0,
      input.aim ? input.aim.x : -1,
      input.aim ? input.aim.y : -1,
    ];
    const last = this.last;
    if (!last || row[3] || row[4] || last[1] !== row[1] || last[2] !== row[2]) {
      this.play.inputs.push(row);
      this.last = row;
    }
  }
  // The night as it stands, for a tab that is going away while the night may yet go on: the same play (same id), with
  // the outcome and stats so far. Null when no step has been recorded since the last snapshot, so a hide followed by a
  // pagehide sends once. Unlike finish() it leaves the recorder listening, so a night that goes on keeps its hidden time.
  private snapshotSteps = 0;
  snapshot(state: State): Play | null {
    if (this.play.steps === 0 || this.play.steps === this.snapshotSteps) {
      return null;
    }
    this.snapshotSteps = this.play.steps;
    const openSeconds =
      this.hiddenSince === null ? 0 : (performance.now() - this.hiddenSince) / MILLISECONDS_PER_SECOND;
    this.play.hiddenSeconds = Math.round((this.hiddenSeconds + openSeconds) * 10) / 10;
    return this.summarise(state);
  }
  finish(state: State): Play {
    this.closeHidden();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.play.hiddenSeconds = Math.round(this.hiddenSeconds * 10) / 10;
    return this.summarise(state);
  }
  private summarise(state: State): Play {
    const play = this.play;
    play.outcome = state.outcome;
    play.stats = {
      ...state.stats,
      oilEarned: state.oilEarned,
      hp: Math.ceil(state.hero.health),
      maxHp: state.hero.maxHealth,
      lit: litCount(state),
    };
    return play;
  }
}

// ---- getting a recording to the server ----------------------------------------------------------------------------------
// A night is sent when it ends, and a snapshot of it when the tab is hidden. A play the server did not take is kept in
// localStorage (a few, newest last) and sent again, under the same id, on the next load and after the next play that
// goes through. A resend is safe only because /api/plays answers 200 for an id it already has (its own change, not this file's).

export interface PlayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
// a play as it waits: its id and the body that was (or will be) sent
export interface QueuedPlay {
  id: string;
  body: string;
}
// sent: the server has it. retry: it may not have it, try again later. rejected: it never will take it, drop it.
export type UploadResult = "sent" | "retry" | "rejected";

const QUEUE_KEY = "lampwarden:unsent";
export const MAX_QUEUED_PLAYS = 5;
const MAX_QUEUED_CHARS = 800_000; // localStorage holds about 2.5 million; lastPlay and the legacy need room too
export const MAX_PLAY_CHARS = 400_000; // what /api/plays accepts; a bigger play is never queued
const KEEPALIVE_LIMIT = 60_000; // a keepalive request body may not pass 64 KB

const queuedPlaysSchema = z.array(z.object({ id: z.string(), body: z.string() }));

export function queuedPlays(storage: PlayStorage): QueuedPlay[] {
  try {
    const parsed = queuedPlaysSchema.safeParse(JSON.parse(storage.getItem(QUEUE_KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function saveQueue(storage: PlayStorage, queue: QueuedPlay[]) {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* full or unavailable: the play is lost, as it was before the queue */
  }
}

// Keeps a play for a later try. A play with this id already waiting is replaced (a snapshot gives way to the finished
// night); past the bounds the oldest waiting plays are dropped.
export function queuePlay(storage: PlayStorage, queued: QueuedPlay) {
  if (queued.body.length > MAX_PLAY_CHARS) {
    return;
  }
  const queue = [...queuedPlays(storage).filter((waiting) => waiting.id !== queued.id), queued];
  let chars = queue.reduce((total, waiting) => total + waiting.body.length, 0);
  while (queue.length > MAX_QUEUED_PLAYS || chars > MAX_QUEUED_CHARS) {
    const dropped = queue.shift();
    if (!dropped) {
      break;
    }
    chars -= dropped.body.length;
  }
  saveQueue(storage, queue);
}

export function unqueuePlay(storage: PlayStorage, id: string) {
  const queue = queuedPlays(storage);
  const remaining = queue.filter((waiting) => waiting.id !== id);
  if (remaining.length !== queue.length) {
    saveQueue(storage, remaining);
  }
}

// Sends the waiting plays oldest first, skipping the ids in `skip` (plays on their way right now). A play that went
// through, or that the server will never take, leaves the queue; the first that must wait stops the run, since the
// ones behind it would meet the same network.
export async function flushQueue(
  storage: PlayStorage,
  send: (queued: QueuedPlay) => Promise<UploadResult>,
  skip: { has(id: string): boolean } = new Set(),
) {
  for (const queued of queuedPlays(storage)) {
    if (skip.has(queued.id)) {
      continue;
    }
    const result = await send(queued);
    if (result === "retry") {
      return;
    }
    unqueuePlay(storage, queued.id);
  }
}

function localStorageOrNull(): PlayStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// the visual verifier's nights are not real plays, so they are never uploaded or queued (a stubbed server answers them)
const isVerifying = () => new URLSearchParams(location.search).has("verify");

// statuses worth sending the night again for: a timeout, too early, too many requests, and any fault of the server's
const RETRY_STATUSES = { timeout: 408, tooEarly: 425, tooMany: 429 };
const SERVER_ERROR = 500;

async function fetchPlay(body: string, keepalive: boolean): Promise<UploadResult> {
  const response = await fetch("/api/plays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: keepalive && body.length < KEEPALIVE_LIMIT,
  });
  if (response.ok) {
    return "sent";
  }
  return Object.values(RETRY_STATUSES).includes(response.status) || response.status >= SERVER_ERROR
    ? "retry"
    : "rejected";
}

// `leaving`: the page is hiding or going away. A body too big for keepalive goes by beacon, whose outcome nobody sees,
// so it counts as "retry": it stays queued until a later load sends it again and the server answers.
async function post(queued: QueuedPlay, leaving: boolean): Promise<UploadResult> {
  try {
    if (leaving && queued.body.length >= KEEPALIVE_LIMIT) {
      const beacon = new Blob([queued.body], { type: "application/json" });
      if (navigator.sendBeacon("/api/plays", beacon)) {
        return "retry";
      }
    }
    return await fetchPlay(queued.body, leaving);
  } catch {
    return "retry";
  }
}

// ids being sent right now, counted: a snapshot and the finished night of one id can be on their way together
const inFlight = new Map<string, number>();
function sending(id: string, change: 1 | -1) {
  const count = (inFlight.get(id) ?? 0) + change;
  if (count > 0) {
    inFlight.set(id, count);
  } else {
    inFlight.delete(id);
  }
}

// the body of the latest upload of each id still on its way
const newest = new Map<string, string>();

// Sends a play; true when the server has it. One that did not go through is queued and tried again on the next load
// and after the next play that does. `leaving`: the page is hiding or going away, so the play is queued first, since
// the request may not finish.
export async function upload(play: Play, leaving = false): Promise<boolean> {
  if (isVerifying()) {
    return true;
  }
  const storage = localStorageOrNull();
  const queued: QueuedPlay = { id: play.id, body: JSON.stringify(play) };
  if (storage && leaving) {
    queuePlay(storage, queued);
  }
  sending(queued.id, 1);
  newest.set(queued.id, queued.body);
  const result = await post(queued, leaving);
  sending(queued.id, -1);
  const stale = newest.get(queued.id) !== queued.body; // a later upload of this night owns its queue entry
  if (!stale) {
    newest.delete(queued.id);
  }
  if (storage) {
    if (!stale) {
      if (result === "retry") {
        queuePlay(storage, queued);
      } else {
        unqueuePlay(storage, queued.id);
      }
    }
    if (result === "sent") {
      flushQueue(storage, (waiting) => post(waiting, false), inFlight).catch(reportError); // the caller does not wait
    }
  }
  return result === "sent";
}

// On a load: sends the plays that earlier pages could not.
export async function resendQueuedPlays() {
  const storage = localStorageOrNull();
  if (!storage || isVerifying()) {
    return;
  }
  await flushQueue(storage, (waiting) => post(waiting, false), inFlight);
}
