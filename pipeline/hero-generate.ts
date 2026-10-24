// Has Mubit write the warden: for each sex, the generator writes the hero's build code (three candidates, one fix, best-of,
// all verified on four representative frames; hero-loop.ts), the winner's 100 frames are rendered in one sandbox batch and
// checked, and the model's warden replaces the deterministic one only if it beats it under the live job's acceptance rule
// (a verifier pass, or a score of at least 6 with no engine flag, on every one of the four frames, and a higher mean score
// than the deterministic warden's own frames earn from the same verifier). Otherwise nothing is written for that sex.
//
// usage: bun run assets:hero:generate -- [--sex male|female] [--candidates 3] [--out public/sprites/hero]
// Writes, for a sex that wins: <out>/<sex>.ts (the model's code), <out>/<sex>.png (its atlas) and a row in
// public/sprites/manifest.json (hero_frames.model). Every attempt's frames and every model call are kept under
// pipeline/runs (git-ignored). `bun run assets:hero` redraws the atlas from the committed code, and `bun run check:pixels`
// proves it. Needs MUBIT_API_KEY, Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID, like `bun run assets`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { HERO_ANIMATIONS, SEXES, type Sex } from "../src/scene/assets";
import { createFileStore } from "./file-store";
import { heroFrameBuilds } from "./hero-animation";
import { type HeroAttempt, type HeroLoopOutcome, judgeCurrentHero, runHeroLoop } from "./hero-loop";
import { assembleHeroAtlas, heroModelFrameBuilds, poseOf } from "./hero-model";
import { committedHeroCode, HERO_DIRECTORY } from "./hero-source";
import type { LoopCore } from "./loop";
import { createMubitClient, shortSha } from "./mubit";
import { checkoutSandboxOptions, renderBatchFromCheckout, renderFromCheckout } from "./render-checkout";
import { RENDERED_WITH } from "./render-types";

const PIPELINE_DIRECTORY = import.meta.dir;
const ATLAS_ATTEMPTS = 2;
/** A new warden replaces one the model already wrote only by this much: the verifier's score on one render is noisy. */
const REPLACEMENT_MARGIN = 0.25;

const { values } = parseArgs({
  options: {
    sex: { type: "string" },
    candidates: { type: "string", default: "3" },
    out: { type: "string", default: HERO_DIRECTORY },
    manifest: { type: "string", default: join(HERO_DIRECTORY, "..", "manifest.json") },
  },
});
const sexes = SEXES.filter((sex) => !values.sex || values.sex === sex);
if (sexes.length === 0) throw new Error(`--sex is male or female, not ${values.sex}`);
checkoutSandboxOptions(); // fail now, not at the first render, when the snapshot id is missing
const apiKey = process.env.MUBIT_API_KEY;
if (!apiKey)
  throw new Error(
    "MUBIT_API_KEY is not set (export it in your shell, or resolve it from .env.local; see docs/tooling.md)",
  );
const outputDirectory = resolve(values.out);
mkdirSync(outputDirectory, { recursive: true });
const runsDirectory = join(PIPELINE_DIRECTORY, "runs");

const generatorPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "generator.md"), "utf8");
const verifierPrompt = readFileSync(join(PIPELINE_DIRECTORY, "prompts", "verifier.md"), "utf8");
console.log({
  generator_prompt_sha: shortSha(generatorPrompt),
  verifier_prompt_sha: shortSha(verifierPrompt),
  render: RENDERED_WITH,
});
const core: LoopCore = {
  model: createMubitClient({ apiKey }),
  render: renderFromCheckout,
  pose: "",
  generatorPrompt,
  verifierPrompt,
  store: createFileStore({
    workDirectory: join(runsDirectory, "work", "hero"),
    logPath: join(runsDirectory, "run.jsonl"),
  }),
};

const attemptSummary = (attempt: HeroAttempt) => ({
  name: attempt.name,
  score: Math.round(attempt.score * 100) / 100,
  accepted: attempt.accepted,
  static_issues: attempt.staticIssues,
  frames: attempt.frames.map((frame) => ({
    pose: frame.pose,
    direction: frame.direction,
    score: frame.score,
    pass: frame.pass,
    accepted: frame.accepted,
    flags: frame.flags,
    issues: frame.issues,
    verify: frame.requestIds,
  })),
});

const manifestSchema = z.record(z.string(), z.unknown());

// read before anything is written, so a wrong --manifest stops the run and not half of it
const manifestPath = resolve(values.manifest);
const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

function recordInManifest(sex: Sex, outcome: HeroLoopOutcome, winner: HeroAttempt, current: HeroAttempt) {
  const heroFrames = manifestSchema.parse(manifest.hero_frames ?? {});
  const models = manifestSchema.parse(heroFrames.model ?? {});
  models[sex] = {
    brief: outcome.brief,
    code: `hero/${sex}.ts`,
    session: outcome.session,
    kept: winner.name,
    final: winner.name.endsWith("-fixed") ? "fixed" : "first",
    score: Math.round(winner.score * 100) / 100,
    passed: winner.frames.every((frame) => frame.pass),
    current_score: Math.round(current.score * 100) / 100,
    candidate_scores: outcome.candidateScores.map((score) => Math.round(score * 100) / 100),
    fixed_score: outcome.fixedScore === null ? null : Math.round(outcome.fixedScore * 100) / 100,
    frames: winner.frames.map((frame) => ({
      pose: frame.pose,
      direction: frame.direction,
      score: frame.score,
      pass: frame.pass,
      flags: frame.flags,
      issues: frame.issues,
    })),
    mubit_request_ids: {
      gen: outcome.generatorRequestIds,
      fix: outcome.fixRequestId,
      attempts: outcome.attempts.map((attempt) => ({
        name: attempt.name,
        verify: attempt.frames.map((frame) => ({
          pose: frame.pose,
          direction: frame.direction,
          ids: frame.requestIds,
        })),
      })),
    },
    current: attemptSummary(current).frames.map((frame) => ({
      pose: frame.pose,
      direction: frame.direction,
      score: frame.score,
      flags: frame.flags,
      verify: frame.verify,
    })),
    rule: "every one of four frames is accepted (a verifier pass, or a score of at least 6 with no engine flag) and the mean score beats the deterministic warden's",
    rendered_with: RENDERED_WITH,
  };
  heroFrames.model = models;
  manifest.hero_frames = heroFrames;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

let kept = 0;
for (const sex of sexes) {
  console.log(`\n== ${sex}`);
  // the warden in use now: the committed model code if a sex has some, else the deterministic builds
  const modelCode = committedHeroCode(sex);
  const deterministic = new Map(
    HERO_ANIMATIONS.flatMap((animation) => heroFrameBuilds(sex, animation)).map(
      (build) => [build.name, build.code] as const,
    ),
  );
  const current = await judgeCurrentHero(
    core,
    sex,
    modelCode !== null
      ? { kind: "model", code: modelCode }
      : {
          kind: "script",
          codeFor: (frame) => {
            const code = deterministic.get(`${sex}_${poseOf(frame)}_${frame.direction}`);
            if (!code) throw new Error(`no deterministic build for ${poseOf(frame)} ${frame.direction}`);
            return code;
          },
        },
  );
  console.log(
    `the warden in use (${modelCode === null ? "deterministic" : "model"}): mean ${current.score.toFixed(2)}, accepted ${current.accepted}`,
    current.frames
      .map(
        (frame) => `${frame.pose}_${frame.direction}=${frame.score}${frame.flags === "ok" ? "" : `(${frame.flags})`}`,
      )
      .join(" "),
  );
  // the score a new warden must beat: the one in use, plus a margin when that one is model code already
  const bar = current.score + (modelCode === null ? 0 : REPLACEMENT_MARGIN);
  const outcome = await runHeroLoop(
    core,
    sex,
    Math.max(1, Number(values.candidates) || 3),
    (attempt) => attempt.accepted && attempt.score > bar,
  );
  if (!outcome) {
    console.log(`${sex}: nothing was drawn; the deterministic warden stays`);
    continue;
  }
  mkdirSync(join(runsDirectory, "hero"), { recursive: true });
  writeFileSync(
    join(runsDirectory, "hero", `${sex}.json`),
    JSON.stringify(
      {
        brief: outcome.brief,
        current: attemptSummary(current),
        attempts: outcome.attempts.map((attempt) => ({ ...attemptSummary(attempt), code: attempt.code })),
        generator: outcome.generatorRequestIds,
        fix: outcome.fixRequestId,
        which: outcome.which,
      },
      null,
      1,
    ),
  );
  for (const attempt of outcome.attempts)
    console.log(
      `  ${attempt.name}: mean ${attempt.score.toFixed(2)} accepted ${attempt.accepted}`,
      attempt.frames
        .map(
          (frame) => `${frame.pose}_${frame.direction}=${frame.score}${frame.flags === "ok" ? "" : `(${frame.flags})`}`,
        )
        .join(" "),
    );
  // the attempts that could replace the current warden, best first (the winner leads); each gets its atlas rendered
  const eligible = [outcome.winner, ...outcome.attempts.filter((attempt) => attempt !== outcome.winner)]
    .filter((attempt) => attempt.accepted && attempt.score > bar)
    .sort((first, second) => second.score - first.score)
    .slice(0, ATLAS_ATTEMPTS);
  if (eligible.length === 0) {
    console.log(`${sex}: no attempt beat the warden in use (${bar.toFixed(2)}); it stays`);
    continue;
  }
  for (const attempt of eligible) {
    const builds = heroModelFrameBuilds(sex, attempt.code);
    const results = await renderBatchFromCheckout(
      builds.map((build) => ({ code: build.code, name: build.name, pose: build.pose })),
      { vcpus: 4 },
    );
    const assembled = assembleHeroAtlas(sex, builds, results);
    if (!assembled.ok) {
      console.log(`${sex}: ${attempt.name} refused (${assembled.kind}): ${assembled.reason}`);
      continue;
    }
    writeFileSync(join(outputDirectory, `${sex}.ts`), `${attempt.code}\n`);
    writeFileSync(join(outputDirectory, `${sex}.png`), assembled.atlas);
    recordInManifest(sex, outcome, attempt, current);
    console.log(
      `${sex}: kept ${attempt.name} (mean ${attempt.score.toFixed(2)} against ${bar.toFixed(2)} to beat); wrote ${sex}.ts and ${sex}.png`,
    );
    kept++;
    break;
  }
}
console.log(`\nALL DONE: ${kept} of ${sexes.length} warden${sexes.length === 1 ? "" : "s"} replaced`);
