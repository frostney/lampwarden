// What the creature and building routes do, with everything they touch injected (store, clock, job starter), so the tests
// need no network. The routes in src/app/api/creatures and src/app/api/buildings are thin: they validate the request, call
// one of these, and shape the response.
//
// Creatures and buildings share ONE slot (the store's `running` mark): at most one model job and one sandbox run at a time,
// whatever is being made. Creatures have priority. A creature that finds a building job running is told to ask again
// shortly (and the store notes that it waited, so no new building job starts before it has asked again); a building that
// finds a creature job running, or a creature waiting, is told the same.
import type { Building, BuildingJob, NextBuildingResponse } from "@/game/building";
import type { CreatureJob, NextCreatureRequest, NextCreatureResponse } from "@/game/creature";
import { MILLISECONDS_PER_SECOND } from "@/lib/units";

import { type CreatureConfig, generationAvailable, type StartLimits } from "./config";
import { checkStartLimits, type StartLedger, visitorKey } from "./limits";
import { type GalleryStore, type JobKind, kindOf, type StoredJob } from "./store";

const SKIPPED_RECORDS_TO_TRY = 5;
const FAILED_AS_STALE = "timed out";
const SUPERSEDED = "another job started first";
const BROKEN = "something went wrong";
/** How long a refused request is told to wait before it asks again for the slot. */
const BUSY_RETRY_SECONDS = 15;
/** How long after a creature had to wait no building job starts, so the creature's next ask finds the slot free. */
const CREATURE_PRIORITY_SECONDS = 30;

export interface ServiceDeps {
  store: GalleryStore;
  now: () => Date;
  config: CreatureConfig;
  newJobId: () => string;
  /** Runs the job after the response has gone out (`after()` in a route). */
  startJob: (jobId: string, kind: JobKind) => void;
  /** The routes' `maxDuration`: a job whose status has not moved for longer than this reads as failed. */
  maxDurationSeconds: number;
}

const isFinished = (job: StoredJob) => job.step === "done" || job.step === "failed";

/** A job that is neither done nor failed but has not moved for longer than `maxDuration` can only be dead. */
function isStale(job: StoredJob, now: Date, maxDurationSeconds: number): boolean {
  return !isFinished(job) && now.getTime() - Date.parse(job.updatedAt) > maxDurationSeconds * MILLISECONDS_PER_SECOND;
}

/** A stored job as a client should see it: a stale one is reported as failed. */
async function readStoredJob(deps: ServiceDeps, jobId: string): Promise<StoredJob | null> {
  const job = await deps.store.getJob(jobId);
  if (!job) {
    return null;
  }
  if (!isStale(job, deps.now(), deps.maxDurationSeconds)) {
    return job;
  }
  return {
    jobId,
    ...(job.kind ? { kind: job.kind } : {}),
    step: "failed",
    error: FAILED_AS_STALE,
    updatedAt: job.updatedAt,
  };
}

/** A creature job as a client should see it, or null when there is none by that id (a building's job is not a creature's). */
export async function readJob(deps: ServiceDeps, jobId: string): Promise<CreatureJob | null> {
  const job = await readStoredJob(deps, jobId);
  return job && kindOf(job) === "creature" ? job : null;
}

/** A building job as a client should see it, or null when there is none by that id. */
export async function readBuildingJob(deps: ServiceDeps, jobId: string): Promise<BuildingJob | null> {
  const job = await readStoredJob(deps, jobId);
  if (!job || kindOf(job) !== "building") {
    return null;
  }
  const { building, error, step, updatedAt } = job;
  return { jobId, step, ...(building ? { building } : {}), ...(error ? { error } : {}), updatedAt };
}

async function newestUnseen<Record extends { id: string }>(
  ids: Promise<string[]>,
  get: (id: string) => Promise<Record | null>,
  seen: ReadonlySet<string>,
): Promise<Record | null> {
  let tried = 0;
  for (const id of await ids) {
    if (seen.has(id)) {
      continue;
    }
    const record = await get(id);
    if (record) {
      return record;
    }
    if (++tried >= SKIPPED_RECORDS_TO_TRY) {
      break;
    }
  }
  return null;
}

/** The job that holds the global slot, if it is still alive. */
async function runningJob(deps: ServiceDeps, lock: { jobId: string } | null): Promise<StoredJob | null> {
  if (!lock) {
    return null;
  }
  const job = await readStoredJob(deps, lock.jobId);
  return job && !isFinished(job) ? job : null;
}

// What asking for a job came to: the job to follow (an alive one, or the one just started), or why there is none.
type Slot =
  | { kind: "job"; jobId: string }
  | { kind: "refused"; reason: "rate-limited" | "busy"; retryAfterSeconds: number }
  | { kind: "refused"; reason: "unavailable" };

interface SlotRequest {
  /** What the caller makes. */
  kind: JobKind;
  /** The caller's address, for the per-visitor limit; hashed and never stored. */
  ip: string | null;
  limits: StartLimits;
  ledger: StartLedger;
  record: (visitor: string, jobId: string, startedAt: Date) => Promise<void>;
}

/**
 * What the caller gets while the slot is not free for it: the running job when it is of the caller's kind, else a busy
 * answer. The other kind's job cannot be shared. A creature waits for a building: it is noted, so no building starts
 * before the creature asks again. A building waits for a creature, or for the creature that is waiting. Null when the
 * caller may start a job.
 */
async function slotTaken(deps: ServiceDeps, kind: JobKind, alive: StoredJob | null, now: Date): Promise<Slot | null> {
  const busy: Slot = { kind: "refused", reason: "busy", retryAfterSeconds: BUSY_RETRY_SECONDS };
  if (alive) {
    if (kindOf(alive) === kind) {
      return { kind: "job", jobId: alive.jobId };
    }
    if (kind === "creature") {
      await deps.store.noteCreatureWaiting(now);
    }
    return busy;
  }
  if (kind === "building") {
    const waiting = await deps.store.creatureWaitingSince();
    if (waiting && now.getTime() - waiting.getTime() < CREATURE_PRIORITY_SECONDS * MILLISECONDS_PER_SECOND) {
      return busy;
    }
  }
  return null;
}

/** Follows the job that holds the slot when it is the caller's kind, or starts one when the limits allow. */
async function followOrStart(deps: ServiceDeps, request: SlotRequest, rateSalt: string): Promise<Slot> {
  // one job at a time for the whole site: whoever asks while one runs shares it
  const lock = await deps.store.readRunning();
  const alive = await runningJob(deps, lock);
  const now = deps.now();
  const taken = await slotTaken(deps, request.kind, alive, now);
  if (taken) {
    return taken;
  }

  const visitor = visitorKey(request.ip, rateSalt);
  const decision = await checkStartLimits(request.ledger, now, visitor, request.limits);
  if (!decision.allowed) {
    return { kind: "refused", reason: "rate-limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const jobId = deps.newJobId();
  const kindField = request.kind === "building" ? ({ kind: "building" } as const) : {};
  await deps.store.putJob({ jobId, ...kindField, step: "queued", updatedAt: now.toISOString() });
  if (!(await deps.store.claimRunning(jobId, lock))) {
    // somebody else claimed the slot between our read and our write: theirs is the job to follow
    await deps.store.putJob({
      jobId,
      ...kindField,
      step: "failed",
      error: SUPERSEDED,
      updatedAt: deps.now().toISOString(),
    });
    const winner = await runningJob(deps, await deps.store.readRunning());
    if (!winner) {
      return { kind: "refused", reason: "unavailable" };
    }
    return kindOf(winner) === request.kind
      ? { kind: "job", jobId: winner.jobId }
      : { kind: "refused", reason: "busy", retryAfterSeconds: BUSY_RETRY_SECONDS };
  }
  try {
    await request.record(visitor, jobId, now);
  } catch (error) {
    await deps.store.putJob({
      jobId,
      ...kindField,
      step: "failed",
      error: BROKEN,
      updatedAt: deps.now().toISOString(),
    });
    throw error;
  }
  deps.startJob(jobId, request.kind);
  return { kind: "job", jobId };
}

export interface NextCreatureInput {
  seen: NextCreatureRequest["seen"];
  /** The caller's address, for the per-visitor limit; hashed and never stored. */
  ip: string | null;
}

export async function nextCreature(deps: ServiceDeps, input: NextCreatureInput): Promise<NextCreatureResponse> {
  try {
    const unseen = await newestUnseen(
      deps.store.listCreatureIds(),
      (id) => deps.store.getCreature(id),
      new Set(input.seen),
    );
    if (unseen) {
      return { kind: "ready", creature: unseen };
    }
    if (!generationAvailable(deps.config) || deps.config.rateSalt === null) {
      return { kind: "none", reason: "unavailable" };
    }
    const slot = await followOrStart(
      deps,
      {
        kind: "creature",
        ip: input.ip,
        limits: deps.config.limits,
        ledger: deps.store,
        record: (visitor, jobId, startedAt) => deps.store.recordStart(visitor, jobId, startedAt),
      },
      deps.config.rateSalt,
    );
    if (slot.kind === "job") {
      return { kind: "generating", jobId: slot.jobId };
    }
    // The contract has no "busy": a creature that has to wait for a building job's slot is told what a rate limit is told,
    // a delay (a short one), and asks again.
    if (slot.reason === "unavailable") {
      return { kind: "none", reason: "unavailable" };
    }
    return { kind: "none", reason: "rate-limited", retryAfterSeconds: slot.retryAfterSeconds };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "creature-next-failed", kind: error instanceof Error ? error.name : "unknown" }),
    );
    return { kind: "none", reason: "unavailable" };
  }
}

export interface NextBuildingInput {
  seen: readonly string[];
  ip: string | null;
}

export async function nextBuilding(deps: ServiceDeps, input: NextBuildingInput): Promise<NextBuildingResponse> {
  try {
    const unseen = await newestUnseen<Building>(
      deps.store.listBuildingIds(),
      (id) => deps.store.getBuilding(id),
      new Set(input.seen),
    );
    if (unseen) {
      return { kind: "ready", building: unseen };
    }
    if (!generationAvailable(deps.config) || deps.config.rateSalt === null) {
      return { kind: "none", reason: "unavailable" };
    }
    const slot = await followOrStart(
      deps,
      {
        kind: "building",
        ip: input.ip,
        limits: deps.config.buildingLimits,
        ledger: {
          visitorStartsBetween: (visitor, since, until) =>
            deps.store.buildingVisitorStartsBetween(visitor, since, until),
          startsOnDay: (day) => deps.store.buildingStartsOnDay(day),
        },
        record: (visitor, jobId, startedAt) => deps.store.recordBuildingStart(visitor, jobId, startedAt),
      },
      deps.config.rateSalt,
    );
    if (slot.kind === "job") {
      return { kind: "generating", jobId: slot.jobId };
    }
    if (slot.reason === "unavailable") {
      return { kind: "none", reason: "unavailable" };
    }
    return { kind: "none", reason: slot.reason, retryAfterSeconds: slot.retryAfterSeconds };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "building-next-failed", kind: error instanceof Error ? error.name : "unknown" }),
    );
    return { kind: "none", reason: "unavailable" };
  }
}
