// The command line's sprite loop: the loop in loop.ts (model and renderer injected) with its records written to files,
// public/sprites for the winner and pipeline/runs for every attempt and every model call. A Vercel function uses loop.ts
// directly with a store of its own, since it has no filesystem to write to.
import { anchorYFromBbox } from "../src/server/creatures/job-shell";
import { createFileStore, writeSpriteOutputs } from "./file-store";
import {
  type Brief,
  type CandidateOutcome,
  isAccepted,
  type LoopCore,
  type LoopOutcome,
  runCandidateLoop,
  runLoop,
  type SpriteRow,
  slugify,
} from "./loop";

export type { Brief } from "./loop";
export { correctionMessage, engineFlagIssues, formatFixed, parseVerdict, slugify } from "./loop";

/** The command line's context: the loop's context with directories in place of a store. */
export interface LoopContext extends Omit<LoopCore, "store"> {
  /** Where the winning PNG, build code and manifest.json go (public/sprites). */
  outputDirectory: string;
  /** Every attempt's build code and PNG are kept here (pipeline/runs/work). */
  workDirectory: string;
  /** One JSON row per model call is appended here (pipeline/runs/run.jsonl). */
  logPath: string;
}

/** Runs the whole loop for one brief and writes its outputs. Returns its manifest row, or null when nothing renderable came out. */
export async function processBrief(context: LoopContext, brief: Brief): Promise<SpriteRow | null> {
  const outcome = await runLoop({ ...context, store: createFileStore(context) }, brief);
  if (!outcome) return null;
  writeSpriteOutputs(context.outputDirectory, slugify(brief.id), outcome);
  return outcome.row;
}

/** What a brief drawn with several candidates came to: every candidate, the winner, and whether the live job's rule takes it. */
export interface CandidateRun {
  outcome: CandidateOutcome;
  accepted: boolean;
}

/**
 * The manifest keys of a sprite the pipeline made: where it came from, what the engine said and where its base touches
 * the ground, measured the way the live creatures' anchors are (`anchorYFromBbox`).
 */
function mubitFields(outcome: LoopOutcome): Record<string, unknown> {
  return {
    source: "mubit",
    flags: outcome.winner.stats.flags,
    bbox: outcome.winner.stats.bbox,
    anchor_y: anchorYFromBbox(outcome.winner.stats.bbox),
  };
}

/**
 * The loop with `candidateCount` candidates (loop.ts, `runCandidateLoop`), the same loop the live creature job runs. The
 * winner is written only when the live job's acceptance rule (`isAccepted`: a verifier pass, or a score of at least 6
 * with no engine flag) takes it; a fix turn runs unless the best candidate already passes the verifier. Returns null
 * when nothing renderable came out.
 */
export async function processBriefWithCandidates(
  context: LoopContext,
  brief: Brief,
  candidateCount: number,
): Promise<CandidateRun | null> {
  const outcome = await runCandidateLoop(
    { ...context, store: createFileStore(context) },
    brief,
    candidateCount,
    (winner) => winner.verdict.pass,
  );
  if (!outcome) return null;
  const accepted = isAccepted(outcome.winner);
  if (accepted) writeSpriteOutputs(context.outputDirectory, slugify(brief.id), outcome, mubitFields(outcome));
  return { outcome, accepted };
}
