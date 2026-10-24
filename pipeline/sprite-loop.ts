// The command line's sprite loop: the loop in loop.ts (model and renderer injected) with its records written to files,
// public/sprites for the winner and pipeline/runs for every attempt and every model call. A Vercel function uses loop.ts
// directly with a store of its own, since it has no filesystem to write to.
import { createFileStore, writeSpriteOutputs } from "./file-store";
import { type Brief, type LoopCore, runLoop, type SpriteRow, slugify } from "./loop";

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
