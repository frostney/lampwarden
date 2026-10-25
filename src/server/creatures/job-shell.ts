// What every live generation job does, whatever it makes (a creature, a building): report to the store at every step,
// stop on a deadline with everything it started, and end as one of a few fixed reasons. The kinds differ in the work they
// do between the first step and the last (job.ts for a creature, ../buildings/job.ts for a building); this is the rest.
//
// The job reports to the store at every step, and every failure ends as a short fixed reason; no model output and no
// stack trace is ever stored, returned or logged.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { JobStep } from "@/game/creature";
import { bindMubitSignal, type CallRecord, type MubitClient } from "../../../pipeline/mubit";
import { bindRenderSignal, type Renderer, withDeadline } from "../../../pipeline/render-types";
import type { JobKind, JobStore, StoredJob } from "./store";

/** The lowest pixel under the feet that the shadow adds: the anchor sits this far above the bottom of the bbox. */
const SHADOW_ROWS = 4;
const FRAME = 128;

/** Where its feet touch the ground, as a fraction of the frame: the lowest opaque row of the bbox, less the shadow. */
export function anchorYFromBbox(bbox: string): number {
  const lowestRow = Number(bbox.split(",")[3]);
  if (!Number.isFinite(lowestRow)) return 0.85;
  const anchor = Math.round(((lowestRow + 1 - SHADOW_ROWS) / FRAME) * 100) / 100;
  return Math.min(1, Math.max(0.5, anchor));
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Ids start with their creation time in seconds (base 36, fixed width), so sorting them sorts by age. */
export function galleryId(now: Date, name: string, entropy: string, fallbackSlug: string): string {
  const seconds = Math.floor(now.getTime() / 1000)
    .toString(36)
    .padStart(8, "0");
  const slug = slugOf(name) || fallbackSlug;
  return `${seconds}-${slug}-${entropy}`.slice(0, 80).replace(/-+$/, "");
}

/** A random hex string for ids that must not collide (not a secret). */
export function randomEntropy(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 6);
}

const verdictSummarySchema = z.object({ score: z.number().nullable(), pass: z.boolean() });
const firstTrySchema = z.object({ status: z.number().nullable(), ms: z.number() });

/** The only fields of a Mubit call that are safe to log: ids, status, timings, token counts and the verifier's score. */
function safeCallSummary(record: CallRecord): Record<string, unknown> {
  const verdict = verdictSummarySchema.safeParse(record.verdict);
  const firstTry = firstTrySchema.safeParse(record.first_try);
  return {
    task: record.task,
    status: record.status,
    rid: record.rid,
    milliseconds: record.ms,
    ...(firstTry.success ? { first_try_status: firstTry.data.status, first_try_milliseconds: firstTry.data.ms } : {}),
    ...(verdict.success ? { score: verdict.data.score, pass: verdict.data.pass } : {}),
    in_tokens: record.in_tokens,
    out_tokens: record.out_tokens,
    cache_creation_input_tokens: record.cache_creation_input_tokens,
    cache_read_input_tokens: record.cache_read_input_tokens,
  };
}

export interface JobShellDeps {
  store: Pick<JobStore, "putJob">;
  now: () => Date;
  model: MubitClient;
  render: Renderer;
  /** The job gives up after this long and records a timeout. */
  budgetMilliseconds: number;
  /** Progress and call summaries (never model output). Defaults to the console. */
  log?: (event: Record<string, unknown>) => void;
}

/** The two reasons the shell itself ends a job with; the work's own are the fixed reasons its kind of job names. */
type ShellFailure = "timed out" | "something went wrong";

/**
 * What the work of one kind of job is handed: the model and renderer tied to the job's deadline, and its way to report.
 * `Failure` is the closed set of reasons that kind of job may fail with, so no text the model wrote can be a reason.
 */
export interface JobContext<Failure extends string> {
  jobId: string;
  model: MubitClient;
  render: Renderer;
  /** Fires at the deadline, or when the work throws: bind anything else the work starts to it. */
  signal: AbortSignal;
  /** True once the job has ended (timed out, say); the work must not store anything then. */
  ended: () => boolean;
  /** Moves the job to a step. Throws once the job has ended, which stops the work that was about to go on. */
  report: (step: JobStep) => Promise<void>;
  /** Ends the job as failed with one of the work's fixed reasons. */
  fail: (reason: Failure) => Promise<void>;
  /** Ends the job as done, with what it made. */
  conclude: (made: Pick<StoredJob, "creature" | "building">) => Promise<void>;
  /** Logs a Mubit call (no text) under the job's id. */
  onCall: (record: CallRecord) => void;
  log: (event: Record<string, unknown>) => void;
}

/**
 * Runs one job to its end around `work`. Never throws: every outcome is recorded in the job. `eventPrefix` names its log
 * events ("creature-job", "building-job").
 */
export async function runJobShell<Failure extends string>(
  deps: JobShellDeps,
  jobId: string,
  kind: JobKind,
  eventPrefix: string,
  work: (context: JobContext<Failure>) => Promise<void>,
): Promise<StoredJob> {
  const log = deps.log ?? ((event) => console.info(JSON.stringify(event)));
  let ended = false;
  let concluded = false; // the job's last state, done or failed, has been written
  let settled = false; // the job's last state has been chosen: the first to conclude a job is the one that does
  // a creature job has no `kind` in the store, as before buildings existed: no kind means a creature
  const kindField = kind === "building" ? ({ kind } as const) : {};
  let latest: StoredJob = { jobId, ...kindField, step: "queued", updatedAt: deps.now().toISOString() };
  // fired at the deadline, or when the job's work throws: the model calls and sandboxes it started stop with it, so a
  // job the store calls failed (and whose slot the next job takes) spends nothing more
  const stop = new AbortController();

  async function write(step: JobStep, extra: Pick<StoredJob, "creature" | "building" | "error"> = {}): Promise<void> {
    latest = { jobId, ...kindField, step, ...extra, updatedAt: deps.now().toISOString() };
    log({ event: eventPrefix, jobId, step, at: latest.updatedAt });
    await deps.store.putJob(latest);
  }

  // a step of a job that has already ended (timed out, say) must not overwrite how it ended: it stops the loop instead
  async function report(step: JobStep): Promise<void> {
    if (ended) throw new Error("the job has ended");
    await write(step);
  }

  // a job ends once: a late "done" (the deadline passed while its record was being stored) never turns a failed job done
  async function conclude(step: "done" | "failed", extra: Pick<StoredJob, "creature" | "building" | "error">) {
    if (settled) return;
    settled = true;
    ended = true;
    try {
      await write(step, extra);
    } catch (error) {
      settled = false; // the store did not take it: a job that could not be written done may still be written failed
      throw error;
    }
    concluded = true;
  }
  const failWith = (reason: Failure | ShellFailure) => conclude("failed", { error: reason });

  const context: JobContext<Failure> = {
    jobId,
    model: bindMubitSignal(deps.model, stop.signal),
    render: bindRenderSignal(deps.render, stop.signal),
    signal: stop.signal,
    ended: () => ended,
    report,
    fail: failWith,
    conclude: (made) => conclude("done", made),
    onCall: (record) => log({ event: "mubit-call", jobId, ...safeCallSummary(record) }),
    log,
  };

  try {
    await withDeadline(work(context), deps.budgetMilliseconds, "timed out", stop);
  } catch (error) {
    // only the kind of failure is kept: a message can carry model output (a zod issue quotes the value it rejected)
    log({ event: `${eventPrefix}-failed`, jobId, kind: error instanceof Error ? error.name : "unknown" });
    if (!concluded) {
      const timedOut = error instanceof Error && error.message === "timed out";
      await failWith(timedOut ? "timed out" : "something went wrong").catch(() => {});
    }
  }
  ended = true;
  return latest;
}
