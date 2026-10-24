// One creature generation job: brief writer -> generator -> tripwire -> render (QuickJS in a worker thread, or a Vercel
// Sandbox) -> engine flags -> verifier -> one fix -> best-of (pipeline/loop.ts), then accept or fail. Model output is text
// and a PNG here: the code it wrote reaches only the renderer, never this process. What the job keeps of a creature is
// that code, and the hashes of the code and of the pixels the verifier judged, so the player's browser can draw it and
// check that it drew the same thing.
//
// The job reports to the store at every step, and every failure ends as a short fixed reason; no model output and no
// stack trace is ever stored, returned or logged.
import { createHash } from "node:crypto";
import { z } from "zod";
import { type Creature, type CreatureJob, creatureSchema, type JobStep } from "@/game/creature";
import { sha256Hex } from "@/game/creature-build";
import { type CreatureBrief, writeCreatureBrief } from "../../../pipeline/creature-brief";
import { type CandidateOutcome, type LoopStage, type LoopWinner, runCandidateLoop } from "../../../pipeline/loop";
import type { CallRecord, MubitClient } from "../../../pipeline/mubit";
import { type Renderer, type RendererName, withDeadline } from "../../../pipeline/render-types";
import { decodePng } from "../../../tools/logo/png";
import type { CreatureStore } from "./store";

/** The lowest verifier score that is accepted without a verifier pass, and only with a clean engine report. */
const MINIMUM_UNPASSED_SCORE = 6;
/** The lowest pixel under the feet that the shadow adds: the anchor sits this far above the bottom of the bbox. */
const SHADOW_ROWS = 4;
const FRAME = 128;
const NAME_HISTORY = 60;

type JobFailure =
  | "generation is unavailable"
  | "no creature was written"
  | "no sprite could be drawn"
  | "the sprite was not good enough"
  | "the sprite would not draw the same in the browser"
  | "timed out"
  | "something went wrong";

/** Accept a verifier pass, or a score of at least 6 with no engine flags. Anything else fails and stores nothing. */
export function isAccepted(winner: Pick<LoopWinner, "verdict" | "stats">): boolean {
  if (winner.verdict.pass) return true;
  const score = winner.verdict.score;
  return winner.stats.flags === "ok" && score !== null && score >= MINIMUM_UNPASSED_SCORE;
}

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
export function creatureId(now: Date, name: string, entropy: string): string {
  const seconds = Math.floor(now.getTime() / 1000)
    .toString(36)
    .padStart(8, "0");
  const slug = slugOf(name) || "creature";
  return `${seconds}-${slug}-${entropy}`.slice(0, 80).replace(/-+$/, "");
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

export interface JobDeps {
  store: CreatureStore;
  now: () => Date;
  model: MubitClient;
  render: Renderer;
  /** Which renderer `render` is, for the call log. */
  rendererName: RendererName;
  /**
   * With a renderer other than QuickJS: renders the accepted code once more the way the browser will (QuickJS), and the
   * creature is stored only if that draws the very pixels the verifier judged. Without it a creature could be stored that
   * no browser would ever draw, because two engines can differ in the last bit of a float.
   */
  drawCheck?: Renderer;
  prompts: { creature: string; generator: string; verifier: string };
  /** Random hex for ids. */
  entropy: () => string;
  /** The job gives up after this long and records a timeout. */
  budgetMilliseconds: number;
  /** How many candidate sprites to draw side by side from the brief (the best one is kept and gets the fix turn). */
  candidates: number;
  /** Dev only: told how a finished loop went, accepted or not, with every candidate. Must not throw. */
  onOutcome?: (summary: {
    jobId: string;
    id: string;
    brief: CreatureBrief;
    accepted: boolean;
    outcome: CandidateOutcome;
  }) => void;
  /** Progress and call summaries (never model output). Defaults to the console. */
  log?: (event: Record<string, unknown>) => void;
}

/** Runs one job to its end. Never throws: every outcome is recorded in the job. */
export async function runCreatureJob(deps: JobDeps, jobId: string): Promise<CreatureJob> {
  const log = deps.log ?? ((event) => console.info(JSON.stringify(event)));
  let ended = false;
  let concluded = false; // the job's last state, done or failed, has been written
  let latest: CreatureJob = { jobId, step: "queued", updatedAt: deps.now().toISOString() };

  async function write(step: JobStep, extra: Pick<CreatureJob, "creature" | "error"> = {}): Promise<void> {
    latest = { jobId, step, ...extra, updatedAt: deps.now().toISOString() };
    log({ event: "creature-job", jobId, step, at: latest.updatedAt });
    await deps.store.putJob(latest);
  }

  // a step of a job that has already ended (timed out, say) must not overwrite how it ended: it stops the loop instead
  async function report(step: JobStep): Promise<void> {
    if (ended) throw new Error("the job has ended");
    await write(step);
  }

  async function conclude(step: "done" | "failed", extra: Pick<CreatureJob, "creature" | "error">): Promise<void> {
    ended = true;
    await write(step, extra);
    concluded = true;
  }

  const fail = (reason: JobFailure) => conclude("failed", { error: reason });
  const onCall = (record: CallRecord) => log({ event: "mubit-call", jobId, ...safeCallSummary(record) });

  async function work(): Promise<void> {
    await report("writing");
    const names = await namesOfNewestCreatures(deps.store);
    const written = await writeCreatureBrief(
      { model: deps.model, prompt: deps.prompts.creature, onCall },
      names,
      `lampwarden-creature-${jobId}`,
    );
    if (!written.ok) {
      return fail(written.reason === "unavailable" ? "generation is unavailable" : "no creature was written");
    }

    const id = creatureId(deps.now(), written.brief.name, deps.entropy());
    const outcome = await runCandidateLoop(
      {
        model: deps.model,
        render: deps.render,
        rendererName: deps.rendererName,
        pose: "",
        generatorPrompt: deps.prompts.generator,
        verifierPrompt: deps.prompts.verifier,
        store: { logCall: onCall, saveAttemptCode: () => {}, saveAttemptPng: () => {} },
        print: () => {},
        onStage: (stage: LoopStage) => report(stage),
      },
      { id, category: "creature", text: written.brief.brief },
      deps.candidates,
      isAccepted,
    );
    if (ended) return;
    if (!outcome) return fail("no sprite could be drawn");
    const accepted = isAccepted(outcome.winner);
    deps.onOutcome?.({ jobId, id, brief: written.brief, accepted, outcome });
    log({
      event: "creature-job-judged",
      jobId,
      accepted,
      candidate_scores: outcome.row.candidate_scores,
      first_score: outcome.row.first_score,
      fixed_score: outcome.row.fixed_score,
      final: outcome.row.final,
      flags: outcome.winner.stats.flags,
    });
    if (!accepted) return fail("the sprite was not good enough");

    const build = await buildHashes(outcome.winner.code, outcome.winner.png);
    if (deps.drawCheck && !(await drawsTheSame(deps.drawCheck, outcome.winner.code, build.pixelsSha256)))
      return fail("the sprite would not draw the same in the browser");
    const creature = buildCreature(id, written.brief, outcome.winner, build, deps.now());
    await deps.store.putCreature(creature, outcome.winner.code);
    await conclude("done", { creature });
  }

  try {
    await withDeadline(work(), deps.budgetMilliseconds, "timed out");
  } catch (error) {
    // only the kind of failure is kept: a message can carry model output (a zod issue quotes the value it rejected)
    log({ event: "creature-job-failed", jobId, kind: error instanceof Error ? error.name : "unknown" });
    if (!concluded) {
      const timedOut = error instanceof Error && error.message === "timed out";
      await fail(timedOut ? "timed out" : "something went wrong").catch(() => {});
    }
  }
  ended = true;
  return latest;
}

/** The hashes the browser checks: the code as stored, and the RGBA pixels of the render the verifier judged. */
export async function buildHashes(code: string, png: Uint8Array) {
  const pixels = decodePng(Buffer.from(png)).data;
  return { codeSha256: await sha256Hex(code), pixelsSha256: await sha256Hex(pixels) };
}

async function drawsTheSame(render: Renderer, code: string, pixelsSha256: string): Promise<boolean> {
  const again = await render({ code, name: "check", pose: "" });
  return again.ok && (await buildHashes(code, again.png)).pixelsSha256 === pixelsSha256;
}

function buildCreature(
  id: string,
  brief: CreatureBrief,
  winner: LoopWinner,
  build: Creature["build"],
  now: Date,
): Creature {
  return creatureSchema.parse({
    id,
    ...brief,
    anchorY: anchorYFromBbox(winner.stats.bbox),
    score: winner.verdict.score,
    createdAt: now.toISOString(),
    build,
  });
}

async function namesOfNewestCreatures(store: CreatureStore): Promise<string[]> {
  const ids = (await store.listCreatureIds()).slice(0, NAME_HISTORY);
  const creatures = await Promise.all(ids.map((id) => store.getCreature(id)));
  return creatures.flatMap((creature) => (creature ? [creature.name] : []));
}

/** A random hex string for ids that must not collide (not a secret). */
export function randomEntropy(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 6);
}
