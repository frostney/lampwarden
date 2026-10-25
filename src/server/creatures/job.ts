// One creature generation job: brief writer -> generator -> tripwire -> render in the sandbox -> engine flags ->
// verifier -> one fix -> best-of (pipeline/loop.ts, reused), accept or fail, then the accepted sprite's code is rendered
// again in every pose of its animations in one sandbox batch and packed into an atlas. Model output is text and a PNG
// here: the code it wrote reaches only the renderer (a Vercel Sandbox in production), never this process.
//
// The job's shell (job-shell.ts) reports to the store at every step and ends every failure as a short fixed reason; no
// model output and no stack trace is ever stored, returned or logged. A building job (../buildings/job.ts) shares it.

import type { CreatureJob } from "@/game/creature";
import { type CreatureFrames, type CreatureRecord, creatureRecordSchema } from "@/game/creature-frames";
import { ignore } from "@/lib/ignore";

import { type CreatureBrief, writeCreatureBrief } from "../../../pipeline/creature-brief";
import {
  type BatchRenderer,
  bindBatchRenderSignal,
  canvasOfStill,
  type FrameSetFailure,
  renderFrameSet,
} from "../../../pipeline/creature-frames";
import {
  type CandidateOutcome,
  isAccepted,
  type LoopStage,
  type LoopWinner,
  runCandidateLoop,
} from "../../../pipeline/loop";
import type { MubitClient } from "../../../pipeline/mubit";
import type { Renderer } from "../../../pipeline/render-types";
import { anchorYFromBbox, galleryId, type JobContext, judgedEvent, runJobShell } from "./job-shell";
import type { CreatureStore } from "./store";

const NAME_HISTORY = 60;
/** How many accepted candidates get their frames rendered: the winner and the next best. Each is a sandbox batch. */
const FRAME_ATTEMPTS = 2;

/** Ids start with their creation time in seconds (base 36, fixed width), so sorting them sorts by age. */
export const creatureId = (now: Date, name: string, entropy: string) => galleryId(now, name, entropy, "creature");

type CreatureFailure =
  | "generation is unavailable"
  | "no creature was written"
  | "no sprite could be drawn"
  | "the sprite was not good enough"
  | "it could not be animated";

export interface JobDeps {
  store: CreatureStore;
  now: () => Date;
  model: MubitClient;
  render: Renderer;
  /** Renders a creature's frames, all of them in one sandbox batch. */
  renderBatch: BatchRenderer;
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
  return runJobShell<CreatureFailure>(deps, jobId, "creature", "creature-job", async (job) => {
    const renderBatch = bindBatchRenderSignal(deps.renderBatch, job.signal);

    await job.report("writing");
    const names = await namesOfNewestCreatures(deps.store);
    const written = await writeCreatureBrief(
      { model: job.model, prompt: deps.prompts.creature, onCall: job.onCall },
      names,
      `lampwarden-creature-${jobId}`,
    );
    if (!written.ok) {
      return job.fail(written.reason === "unavailable" ? "generation is unavailable" : "no creature was written");
    }

    const id = creatureId(deps.now(), written.brief.name, deps.entropy());
    const outcome = await runCandidateLoop(
      {
        model: job.model,
        render: job.render,
        pose: "",
        generatorPrompt: deps.prompts.generator,
        verifierPrompt: deps.prompts.verifier,
        store: { logCall: job.onCall, saveAttemptCode: ignore, saveAttemptPng: ignore },
        print: ignore,
        onStage: (stage: LoopStage) => job.report(stage),
      },
      { id, category: "creature", text: written.brief.brief },
      deps.candidates,
      isAccepted,
    );
    if (job.ended()) {
      return;
    }
    if (!outcome) {
      return job.fail("no sprite could be drawn");
    }
    const accepted = isAccepted(outcome.winner);
    deps.onOutcome?.({ jobId, id, brief: written.brief, accepted, outcome });
    job.log(judgedEvent("creature-job", jobId, accepted, outcome));
    if (!accepted) {
      return job.fail("the sprite was not good enough");
    }

    // The judged sprite is one still. Its code is drawn again in every pose; if that fails (a pose that does not render,
    // a builder that ignores its pose), the next best accepted candidate gets the same chance.
    await job.report("rendering");
    const framesStarted = Date.now();
    const { animated, tried, batches } = await animate(job, renderBatch, outcome);
    if (job.ended()) {
      return; // timed out while rendering: do not put a creature in the gallery for a job that failed
    }
    job.log(framesEvent(jobId, animated, tried, batches, Date.now() - framesStarted));
    if (!animated) {
      return job.fail("it could not be animated");
    }

    const creature = buildCreature(id, written.brief, animated.candidate, animated.frames, deps.now());
    await deps.store.putCreature(creature, animated.candidate.png, animated.candidate.code, animated.atlas, job.signal);
    await job.conclude({ creature });
  });
}

// what the log says of the frames: whether they came, what was refused on the way, and what it cost
const framesEvent = (
  jobId: string,
  animated: Animated | null,
  refused: FrameSetFailure["kind"][],
  batches: number,
  milliseconds: number,
) => ({
  event: "creature-job-frames",
  jobId,
  animated: animated !== null,
  refused,
  directions: animated?.frames.directions?.length ?? (animated ? 1 : 0),
  batches,
  milliseconds,
  atlasBytes: animated?.atlas.length ?? 0,
});

// Draws the best accepted candidate in every pose, and the next best if that fails; stops when the job ends.
async function animate(
  job: JobContext<CreatureFailure>,
  renderBatch: BatchRenderer,
  outcome: CandidateOutcome,
): Promise<{ animated: Animated | null; tried: FrameSetFailure["kind"][]; batches: number }> {
  const tried: FrameSetFailure["kind"][] = [];
  let batches = 0;
  for (const candidate of acceptedCandidates(outcome).slice(0, FRAME_ATTEMPTS)) {
    if (job.ended()) {
      break;
    }
    const frameSet = await renderFrameSet(renderBatch, candidate.code, canvasOfStill(candidate.stats));
    batches += frameSet.batches;
    tried.push(...frameSet.earlier);
    if (frameSet.ok) {
      return { animated: { candidate, frames: frameSet.frames, atlas: frameSet.atlas }, tried, batches };
    }
    tried.push(frameSet.kind);
  }
  return { animated: null, tried, batches };
}

/** An accepted sprite with the code that drew it. */
interface Candidate {
  code: string;
  png: Uint8Array;
  stats: LoopWinner["stats"];
  score: number | null;
}

interface Animated {
  candidate: Candidate;
  frames: CreatureFrames;
  atlas: Uint8Array;
}

/** The winner first, then the other accepted candidates and fix, best score first (earlier ones first among equals). */
function acceptedCandidates(outcome: CandidateOutcome): Candidate[] {
  const { winner } = outcome;
  const others = outcome.candidates
    .filter(
      (record) =>
        record.name !== winner.name &&
        record.png !== null &&
        record.stats !== null &&
        isAccepted({ verdict: { pass: record.pass, score: record.score }, stats: record.stats }),
    )
    .sort((first, second) => (second.score ?? 0) - (first.score ?? 0));
  const alternatives = others.flatMap((record) =>
    record.png && record.stats
      ? [{ code: record.code, png: record.png, stats: record.stats, score: record.score }]
      : [],
  );
  return [{ code: winner.code, png: winner.png, stats: winner.stats, score: winner.verdict.score }, ...alternatives];
}

function buildCreature(
  id: string,
  brief: CreatureBrief,
  candidate: Candidate,
  frames: CreatureFrames,
  now: Date,
): CreatureRecord {
  return creatureRecordSchema.parse({
    id,
    ...brief,
    anchorY: anchorYFromBbox(candidate.stats.bbox),
    score: candidate.score,
    frames,
    createdAt: now.toISOString(),
  });
}

async function namesOfNewestCreatures(store: CreatureStore): Promise<string[]> {
  const ids = (await store.listCreatureIds()).slice(0, NAME_HISTORY);
  const creatures = await Promise.all(ids.map((id) => store.getCreature(id)));
  return creatures.flatMap((creature) => (creature ? [creature.name] : []));
}
