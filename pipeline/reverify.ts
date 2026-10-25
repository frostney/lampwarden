// Re-scores committed sprites with today's verifier and acceptance rule, regenerates the ones that fail, and records
// the result in public/sprites/manifest.json as each row's `verified` block.
//
// usage (MUBIT_API_KEY in the environment; resolve it from a file with MUBIT_API_KEY="$(cat ~/.config/mubit/api_key)"):
//   bun --no-env-file pipeline/reverify.ts score [--only satyr,olive] [--write]
//   bun --no-env-file pipeline/reverify.ts regenerate <id> [--brief "text"] [--candidates 3]
//   bun --no-env-file pipeline/reverify.ts install <id>
//   bun --no-env-file pipeline/reverify.ts record
//
// - score: the verifier over each sprite's committed PNG, brief and build code, exactly as the live creature job calls it
//   (pipeline/loop.ts `verify`: same system prompt, same message, the borderline double-take), then the live acceptance
//   rule (`isAccepted`, src/server/creatures/job.ts). The engine stats come from a re-render of the committed code in the Vercel Sandbox (one batch),
//   which `bun run check:pixels` holds to the committed PNG. `--write` stores the result as the manifest's `verified` block.
// - regenerate: the full candidate loop of the live job (`runCandidateLoop`: candidates, best-of, one fix turn when the
//   best is not accepted), rendered in the Vercel Sandbox, for one sprite. Nothing in public/sprites changes: every
//   candidate and the winner are kept under pipeline/runs/reverify/ (git-ignored).
// - record: stores the last score run (pipeline/runs/reverify/scores.json) as `verified` blocks, for rows without one.
// - install: copies a regenerated winner into public/sprites and writes its manifest row.
// Every Mubit call is appended to pipeline/runs/run.jsonl (no key, no headers).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ANCHOR_Y } from "../src/scene/assets";
import { countOption } from "./cli-options";
import { createFileStore } from "./file-store";
import { isAccepted, type LoopCore, type LoopWinner, runCandidateLoop, verify } from "./loop";
import { createMubitClient, shortSha } from "./mubit";
import { renderBatchFromCheckout, renderFromCheckout } from "./render-checkout";
import type { RenderStats } from "./render-types";

const PIPELINE_DIRECTORY = import.meta.dir;
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const MANIFEST_PATH = join(SPRITES_DIRECTORY, "manifest.json");
const RUNS_DIRECTORY = join(PIPELINE_DIRECTORY, "runs");
const REVERIFY_DIRECTORY = join(RUNS_DIRECTORY, "reverify");
const ACCEPTANCE_RULE = "verifier pass, or score >= 6 with no engine flags (isAccepted in src/server/creatures/job.ts)";

const verifiedSchema = z.object({
  date: z.string(),
  verifier_prompt_sha: z.string(),
  rule: z.string(),
  accepted: z.boolean(),
  pass: z.boolean(),
  score: z.number().nullable(),
  scores: z.tuple([z.number(), z.number()]).optional(),
  engine_flags: z.string(),
  issues: z.array(z.string()),
  request_ids: z.array(z.string().nullable()),
});
type Verified = z.infer<typeof verifiedSchema>;

const manifestSchema = z.object({
  setting: z.string(),
  note: z.string(),
  sprites: z.record(z.string(), z.object({ brief: z.string(), code: z.string() }).passthrough()),
  hero_frames: z.unknown(),
});

const regeneratedSchema = z.object({
  id: z.string(),
  row: z.object({
    brief: z.string(),
    session: z.string(),
    gen: z.string().nullable(),
    verify: z.array(z.string().nullable()).optional(),
    first_score: z.number().nullable().optional(),
    candidate_scores: z.array(z.number().nullable()).optional(),
    fix: z.string().nullable().optional(),
    fixed_verify: z.array(z.string().nullable()).optional(),
    fixed_score: z.number().nullable().optional(),
    final: z.enum(["first", "fixed"]).optional(),
    score: z.number().nullable().optional(),
    passed: z.boolean().optional(),
    rendered_with: z.string().optional(),
  }),
  bbox: z.string(),
  verified: verifiedSchema,
});

function readManifest() {
  return manifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
}

function writeManifest(manifest: z.infer<typeof manifestSchema>): void {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 1)}\n`);
}

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    only: { type: "string" },
    write: { type: "boolean", default: false },
    brief: { type: "string" },
    candidates: { type: "string" },
  },
});
const candidateCount = countOption("candidates", values.candidates, 3);
const [command, ...targets] = positionals;
const verifierPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "verifier.md"), "utf8");
const generatorPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "generator.md"), "utf8");
const today = new Date().toISOString().slice(0, 10);

function createLoop(): LoopCore {
  const apiKey = process.env.MUBIT_API_KEY;
  if (!apiKey) throw new Error("MUBIT_API_KEY is not set");
  return {
    model: createMubitClient({ apiKey }),
    render: renderFromCheckout,
    pose: "",
    generatorPrompt,
    verifierPrompt,
    store: createFileStore({
      workDirectory: join(REVERIFY_DIRECTORY, "work"),
      logPath: join(RUNS_DIRECTORY, "run.jsonl"),
    }),
    print: (line) => console.log(line),
  };
}

const sessionOf = (id: string, brief: string) =>
  `lampwarden-${id}-${Array.from(brief.replace(/[^\p{L}\p{N}_]+/gu, "-"))
    .slice(0, 34)
    .join("")}`;

function verifiedFrom(winner: Pick<LoopWinner, "verdict" | "stats">, requestIds: Array<string | null>): Verified {
  const { verdict, stats } = winner;
  return {
    date: today,
    verifier_prompt_sha: shortSha(verifierPrompt),
    rule: ACCEPTANCE_RULE,
    accepted: isAccepted(winner),
    pass: verdict.pass,
    score: verdict.score,
    ...(verdict.scores ? { scores: verdict.scores } : {}),
    engine_flags: stats.flags,
    issues: verdict.issues,
    request_ids: requestIds,
  };
}

async function scoreSprites(): Promise<void> {
  const manifest = readManifest();
  const used = Object.keys(ANCHOR_Y).filter((key) => key !== "hero");
  const ids = values.only ? values.only.split(",") : used;
  const loop = createLoop();
  const codes = ids.map((id) => {
    const row = manifest.sprites[id];
    if (!row) throw new Error(`${id} is not in the manifest`);
    return readFileSync(join(SPRITES_DIRECTORY, row.code), "utf8");
  });
  const renders = await renderBatchFromCheckout(
    ids.map((id, position) => ({ code: codes[position] ?? "", name: id, pose: "" })),
  );
  const results: Record<string, Verified & { fix: string }> = {};
  const queue = ids.entries();
  const worker = async () => {
    for (let step = queue.next(); !step.done; step = queue.next()) {
      const [position, id] = step.value;
      const row = manifest.sprites[id];
      const code = codes[position];
      if (!row || code === undefined) throw new Error(`${id} is not in the manifest`);
      const png = new Uint8Array(readFileSync(join(SPRITES_DIRECTORY, `${id}.png`)));
      const rendered = renders[position];
      if (!rendered?.ok) throw new Error(`${id} did not render: ${rendered?.error}`);
      const { verdict, requestIds } = await verify(
        loop,
        png,
        row.brief,
        code,
        rendered.stats,
        sessionOf(id, row.brief),
        {
          bid: id,
          brief: row.brief,
          reverify: true,
        },
      );
      const verified = verifiedFrom({ verdict, stats: rendered.stats }, requestIds);
      results[id] = { ...verified, fix: verdict.fix };
      console.log(
        `${id.padEnd(12)} score ${String(verdict.score).padEnd(4)} ${verdict.scores ? `(${verdict.scores.join(", ")}) ` : ""}pass=${verdict.pass} accepted=${verified.accepted} flags=${rendered.stats.flags}`,
      );
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  mkdirSync(REVERIFY_DIRECTORY, { recursive: true });
  writeFileSync(join(REVERIFY_DIRECTORY, "scores.json"), `${JSON.stringify(results, null, 1)}\n`);
  if (values.write) {
    for (const [id, { fix: _fix, ...verified }] of Object.entries(results)) {
      const row = manifest.sprites[id];
      if (row) row.verified = verified;
    }
    writeManifest(manifest);
    console.log("manifest updated");
  }
}

async function regenerateSprite(id: string): Promise<void> {
  const manifest = readManifest();
  const brief = values.brief ?? manifest.sprites[id]?.brief;
  if (!brief) throw new Error(`${id} is not in the manifest; give --brief`);
  const loop = createLoop();
  const outcome = await runCandidateLoop(
    loop,
    { id, category: "sprite", text: brief },
    candidateCount,
    // The live job skips the fix turn for any accepted sprite; a committed sprite is held to a higher bar, so the fix
    // turn (the verifier's issues sent back to the generator) runs unless the verifier passed it outright.
    (candidate) => candidate.verdict.pass,
  );
  if (!outcome) throw new Error(`${id}: nothing renderable came out`);
  const directory = join(REVERIFY_DIRECTORY, id);
  mkdirSync(directory, { recursive: true });
  for (const candidate of outcome.candidates) {
    writeFileSync(join(directory, `${candidate.name}.ts`), `${candidate.code}\n`);
    if (candidate.png) writeFileSync(join(directory, `${candidate.name}.png`), candidate.png);
  }
  const { row, winner } = outcome;
  const requestIds = winner.which === "fixed" ? (row.fixed_verify ?? []) : (row.verify ?? []);
  const stats: RenderStats = winner.stats;
  writeFileSync(join(directory, "winner.ts"), `${winner.code}\n`);
  writeFileSync(join(directory, "winner.png"), winner.png);
  writeFileSync(
    join(directory, "result.json"),
    `${JSON.stringify({ id, row, bbox: stats.bbox, verified: verifiedFrom(winner, requestIds) }, null, 1)}\n`,
  );
  console.log(
    `${id}: candidates ${JSON.stringify(row.candidate_scores)} fixed ${row.fixed_score ?? "-"} -> ${winner.which} score ${winner.verdict.score} accepted ${isAccepted(winner)} bbox ${stats.bbox}`,
  );
}

function installSprite(id: string): void {
  const directory = join(REVERIFY_DIRECTORY, id);
  const resultPath = join(directory, "result.json");
  if (!existsSync(resultPath)) throw new Error(`${id} has no regenerated result; run regenerate first`);
  const result = regeneratedSchema.parse(JSON.parse(readFileSync(resultPath, "utf8")));
  copyFileSync(join(directory, "winner.png"), join(SPRITES_DIRECTORY, `${id}.png`));
  copyFileSync(join(directory, "winner.ts"), join(SPRITES_DIRECTORY, `${id}.ts`));
  const { row } = result;
  const manifest = readManifest();
  manifest.sprites[id] = {
    brief: row.brief,
    file: `${id}.png`,
    code: `${id}.ts`,
    final: row.final,
    first_score: row.first_score,
    fixed_score: row.fixed_score ?? null,
    score: row.score,
    passed: row.passed,
    candidate_scores: row.candidate_scores,
    session: row.session,
    mubit_request_ids: {
      gen: row.gen,
      verify: row.verify ?? null,
      fix: row.fix ?? null,
      fixed_verify: row.fixed_verify ?? null,
    },
    rendered_with: row.rendered_with,
    bbox: result.bbox,
    verified: result.verified,
  };
  writeManifest(manifest);
  console.log(`${id} installed`);
}

/** Stores the last `score` run's results as `verified` blocks, except for rows that already have one (an installed replacement). */
function recordScores(): void {
  const scores = z
    .record(z.string(), verifiedSchema.extend({ fix: z.string() }))
    .parse(JSON.parse(readFileSync(join(REVERIFY_DIRECTORY, "scores.json"), "utf8")));
  const manifest = readManifest();
  for (const [id, { fix: _fix, ...verified }] of Object.entries(scores)) {
    const row = manifest.sprites[id];
    if (row && !row.verified) row.verified = verified;
  }
  writeManifest(manifest);
}

if (command === "score") await scoreSprites();
else if (command === "record") recordScores();
else if (command === "regenerate" && targets.length === 1 && targets[0]) await regenerateSprite(targets[0]);
else if (command === "install" && targets.length === 1 && targets[0]) installSprite(targets[0]);
else {
  console.error(
    "usage: reverify.ts score [--only a,b] [--write] | regenerate <id> [--brief text] | install <id> | record",
  );
  process.exit(2);
}
