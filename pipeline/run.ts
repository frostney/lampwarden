// Lampwarden asset pipeline: brief -> generator (Opus via Mubit) -> render -> verifier (Opus via Mubit, image) -> one fix
// -> best-of -> public/sprites.
//
// usage: bun run assets -- [--out public/sprites] [--pose idle] [--concurrency 4] [--no-prompt-caching] "brief one" ...
//        bun run assets -- --file briefs.json      # {"id": ["category", "brief"], ...}
//        bun run assets -- --candidates 3 --file briefs.json   # the live job's loop: three candidates a brief, one fix,
//                                                              # best-of; only a winner the live job accepts is written
// `bun run assets` is `varlock run --inject vars --filter=#pipeline -- bun --no-env-file pipeline/run.ts`: the variables
// tagged `pipeline` in .env.schema (MUBIT_API_KEY, VERCEL_SANDBOX_SNAPSHOT_ID, VERCEL_OIDC_TOKEN) reach this process and
// nothing else. Every render runs in the Vercel Sandbox (docs/tooling.md, "Rendering needs Vercel auth"). The keys are read
// from the environment only; they are never printed, logged or written to disk.
// Every Mubit call (request id, status, tokens, verdict) is appended to pipeline/runs/run.jsonl (no key, no headers).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { createMubitClient, shortSha } from "./mubit";
import { checkoutSandboxOptions, renderFromCheckout } from "./render-checkout";
import { RENDERED_WITH } from "./render-types";
import { type Brief, type LoopContext, processBrief, processBriefWithCandidates, slugify } from "./sprite-loop";

const PIPELINE_DIRECTORY = import.meta.dir;
/** Briefs in flight at once, each with at most one sandbox render at a time (Vercel Sandbox has been measured to 25). */
const DEFAULT_CONCURRENCY = 4;
/** The live creature job's own cap on candidates a brief (src/server/creatures/config.ts). */
const MAXIMUM_CANDIDATES = 5;
const briefsFileSchema = z.record(z.string(), z.tuple([z.string(), z.string()]));

/** Runs `work` over `items`, at most `limit` at a time. A failure in one item does not stop the others. */
async function runPool<Item>(items: readonly Item[], limit: number, work: (item: Item) => Promise<unknown>) {
  const queue = items[Symbol.iterator]();
  let failures = 0;
  const worker = async () => {
    for (let step = queue.next(); !step.done; step = queue.next()) {
      try {
        await work(step.value);
      } catch (error) {
        failures++;
        console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failures;
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    file: { type: "string" },
    out: { type: "string", default: join(PIPELINE_DIRECTORY, "..", "public", "sprites") },
    pose: { type: "string", default: "" },
    concurrency: { type: "string" },
    candidates: { type: "string" },
    "no-prompt-caching": { type: "boolean", default: false },
  },
});
checkoutSandboxOptions(); // fail now, not at the first render, when the snapshot id is missing
const briefs: Brief[] = values.file
  ? Object.entries(briefsFileSchema.parse(JSON.parse(readFileSync(values.file, "utf8")))).map(
      ([id, [category, text]]) => ({ id, category, text }),
    )
  : positionals.map((text) => ({ id: slugify(text), category: "brief", text }));
if (briefs.length === 0) {
  throw new Error("give at least one brief");
}
const apiKey = process.env.MUBIT_API_KEY;
if (!apiKey) {
  throw new Error(
    "MUBIT_API_KEY is not set (export it in your shell, or resolve it from .env.local; see docs/tooling.md)",
  );
}

const generatorPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "generator.md"), "utf8");
const verifierPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "verifier.md"), "utf8");
const context: LoopContext = {
  model: createMubitClient({ apiKey, promptCaching: !values["no-prompt-caching"] }),
  render: renderFromCheckout,
  pose: values.pose,
  generatorPrompt,
  verifierPrompt,
  outputDirectory: resolve(values.out),
  workDirectory: join(PIPELINE_DIRECTORY, "runs", "work"),
  logPath: join(PIPELINE_DIRECTORY, "runs", "run.jsonl"),
};
console.log({
  generator_prompt_sha: shortSha(generatorPrompt),
  verifier_prompt_sha: shortSha(verifierPrompt),
  render: RENDERED_WITH,
});
const candidateCount = values.candidates === undefined ? 1 : Number(values.candidates);
if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > MAXIMUM_CANDIDATES) {
  throw new Error(`--candidates takes a whole number from 1 to ${MAXIMUM_CANDIDATES}`);
}

/** One brief with several candidates. Prints the summary line the sprite tables are made from. */
async function processWithCandidates(brief: Brief) {
  const run = await processBriefWithCandidates(context, brief, candidateCount);
  if (!run) {
    throw new Error(`${brief.id}: nothing renderable came out`);
  }
  const { row, winner } = run.outcome;
  console.log(
    `SUMMARY ${JSON.stringify({
      id: brief.id,
      accepted: run.accepted,
      score: row.score,
      final: row.final,
      flags: winner.stats.flags,
      bbox: winner.stats.bbox,
      candidate_scores: row.candidate_scores,
      first_score: row.first_score,
      fixed_score: row.fixed_score,
      gen: row.gen,
      candidate_gen: row.candidate_gen,
      verify: row.verify,
      fix: row.fix,
      fixed_verify: row.fixed_verify,
    })}`,
  );
  // a brief the live job's rule rejects wrote nothing: the run ends in failure, as when a build does not render
  if (!run.accepted) {
    throw new Error(`${brief.id}: the best candidate (score ${row.score}) is not accepted, so nothing was written`);
  }
}

const failures = await runPool(briefs, Number(values.concurrency ?? DEFAULT_CONCURRENCY), (brief) =>
  candidateCount > 1 ? processWithCandidates(brief) : processBrief(context, brief),
);
console.log("ALL DONE");
if (failures > 0) {
  process.exit(1);
}
