// What the creature routes do, with everything they touch injected (store, clock, job starter), so the tests need no
// network. The routes in src/app/api/creatures are thin: they validate the request, call one of these, and shape the
// response.
import type { CreatureJob, NextCreatureRequest, NextCreatureResponse } from "@/game/creature";
import { MILLISECONDS_PER_SECOND } from "@/lib/units";

import { type CreatureConfig, generationAvailable } from "./config";
import { checkStartLimits, visitorKey } from "./limits";
import type { CreatureStore } from "./store";

const SKIPPED_RECORDS_TO_TRY = 5;
const FAILED_AS_STALE = "timed out";
const SUPERSEDED = "another job started first";
const BROKEN = "something went wrong";

export interface ServiceDeps {
  store: CreatureStore;
  now: () => Date;
  config: CreatureConfig;
  newJobId: () => string;
  /** Runs the job after the response has gone out (`after()` in a route). */
  startJob: (jobId: string) => void;
  /** The routes' `maxDuration`: a job whose status has not moved for longer than this reads as failed. */
  maxDurationSeconds: number;
}

const isFinished = (job: CreatureJob) => job.step === "done" || job.step === "failed";

/** A job that is neither done nor failed but has not moved for longer than `maxDuration` can only be dead. */
function isStale(job: CreatureJob, now: Date, maxDurationSeconds: number): boolean {
  return !isFinished(job) && now.getTime() - Date.parse(job.updatedAt) > maxDurationSeconds * MILLISECONDS_PER_SECOND;
}

/** The job as a client should see it: a stale one is reported as failed. */
export async function readJob(deps: ServiceDeps, jobId: string): Promise<CreatureJob | null> {
  const job = await deps.store.getJob(jobId);
  if (!job) {
    return null;
  }
  if (!isStale(job, deps.now(), deps.maxDurationSeconds)) {
    return job;
  }
  return { jobId, step: "failed", error: FAILED_AS_STALE, updatedAt: job.updatedAt };
}

async function newestUnseen(store: CreatureStore, seen: ReadonlySet<string>): Promise<NextCreatureResponse | null> {
  let tried = 0;
  for (const id of await store.listCreatureIds()) {
    if (seen.has(id)) {
      continue;
    }
    const creature = await store.getCreature(id);
    if (creature) {
      return { kind: "ready", creature };
    }
    if (++tried >= SKIPPED_RECORDS_TO_TRY) {
      break;
    }
  }
  return null;
}

/** The job that holds the global slot, if it is still alive. */
async function runningJob(deps: ServiceDeps, lock: { jobId: string } | null): Promise<CreatureJob | null> {
  if (!lock) {
    return null;
  }
  const job = await readJob(deps, lock.jobId);
  return job && !isFinished(job) ? job : null;
}

export interface NextCreatureInput {
  seen: NextCreatureRequest["seen"];
  /** The caller's address, for the per-visitor limit; hashed and never stored. */
  ip: string | null;
}

export async function nextCreature(deps: ServiceDeps, input: NextCreatureInput): Promise<NextCreatureResponse> {
  try {
    const unseen = await newestUnseen(deps.store, new Set(input.seen));
    if (unseen) {
      return unseen;
    }
    if (!generationAvailable(deps.config) || deps.config.rateSalt === null) {
      return { kind: "none", reason: "unavailable" };
    }

    // one job at a time for the whole site: whoever asks while one runs shares it
    const lock = await deps.store.readRunning();
    const alive = await runningJob(deps, lock);
    if (alive) {
      return { kind: "generating", jobId: alive.jobId };
    }

    const now = deps.now();
    const visitor = visitorKey(input.ip, deps.config.rateSalt);
    const decision = await checkStartLimits(deps.store, now, visitor, deps.config.limits);
    if (!decision.allowed) {
      return { kind: "none", reason: "rate-limited", retryAfterSeconds: decision.retryAfterSeconds };
    }

    const jobId = deps.newJobId();
    await deps.store.putJob({ jobId, step: "queued", updatedAt: now.toISOString() });
    if (!(await deps.store.claimRunning(jobId, lock))) {
      // somebody else claimed the slot between our read and our write: theirs is the job to follow
      await deps.store.putJob({ jobId, step: "failed", error: SUPERSEDED, updatedAt: deps.now().toISOString() });
      const winner = await runningJob(deps, await deps.store.readRunning());
      return winner ? { kind: "generating", jobId: winner.jobId } : { kind: "none", reason: "unavailable" };
    }
    try {
      await deps.store.recordStart(visitor, jobId, now);
    } catch (error) {
      await deps.store.putJob({ jobId, step: "failed", error: BROKEN, updatedAt: deps.now().toISOString() });
      throw error;
    }
    deps.startJob(jobId);
    return { kind: "generating", jobId };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "creature-next-failed", kind: error instanceof Error ? error.name : "unknown" }),
    );
    return { kind: "none", reason: "unavailable" };
  }
}
