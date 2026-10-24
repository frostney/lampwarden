// Times the direct-worker renderer (a worker thread running the kit and the build as plain JavaScript) and checks every
// PNG against the committed one. Measurement only; docs/LIVE_GENERATION.md, "Direct execution in a worker".
//
// usage: bun pipeline/measure-direct-worker.ts [--runtimes bun,node] [--modes inline,fresh,pool,pool-spaced,local]
//          [--sprites a,b,...] [--renders 10] [--node PATH] [--json FILE]
//        bun pipeline/measure-direct-worker.ts --identity [--runtimes bun,node]     (every committed sprite and hero frame)
//        bun pipeline/measure-direct-worker.ts --animation [--runtimes bun,node]    (the hero's animation set in one worker)
//        bun pipeline/measure-direct-worker.ts --floor [--runtimes bun,node]        (the lowest limits that still render)
//
// Every (runtime, mode, sprite) runs in its own fresh child process, because "cold" means the first render of a process:
// the kit's type stripping, the worker's start and the kit's compile are all in it. The other renders of the child are
// "warm". Under Node the harness first bundles itself with `bun build --target node` (the pipeline imports extensionless,
// which Node cannot resolve).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { DRAWN_DIRECTIONS, HERO_ANIMATIONS, heroAtlasPath, heroFrames, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { bundleForNode } from "./bundle-for-node-direct";
import { heroFrameBuilds } from "./hero-animation";
import { atlasCellPixels, packHeroAtlas } from "./hero-atlas";
import {
  createDirectWorkerRenderer,
  type DirectWorkerOptions,
  prepareBuild,
  prepareKit,
  type RenderTimings,
  renderBatchInDirectWorker,
} from "./render-direct-worker";
import type { Renderer, RenderRequest } from "./render-types";

const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const DEFAULT_SPRITES = ["lamp-lit", "house", "satyr", "temple", "male_walk3_se"];
const MODES = ["inline", "fresh", "pool", "pool-spaced", "local"] as const;
type Mode = (typeof MODES)[number];
const RUNTIMES = ["bun", "node"] as const;
type RuntimeName = (typeof RUNTIMES)[number];
/** The local renderer spawns bun, so it only runs under Bun. */
const BUN_ONLY_MODES: readonly Mode[] = ["local"];
const SPACING_MILLISECONDS = 200;

const timingsSchema = z.object({
  total: z.number(),
  start: z.number(),
  kitLoad: z.number(),
  wait: z.number(),
  worker: z.number(),
  roundTrip: z.number(),
  encode: z.number(),
  heapUsed: z.number(),
  external: z.number(),
});
type Sample = z.infer<typeof timingsSchema>;

const childResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  samples: z.array(timingsSchema),
  /** Building the renderer and, for the pools, waiting until the first workers are ready. One-off, before render 1. */
  setupMilliseconds: z.number(),
  identicalPixels: z.boolean(),
  differingPixels: z.number(),
  rssStartMegabytes: z.number(),
  rssEndMegabytes: z.number(),
});
type ChildResult = z.infer<typeof childResultSchema>;

function isMode(value: string): value is Mode {
  return MODES.some((mode) => mode === value);
}

function isRuntime(value: string): value is RuntimeName {
  return RUNTIMES.some((runtime) => runtime === value);
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const round = (value: number) => Math.round(value * 10) / 10;
const megabytes = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

// ---- jobs: a build script and the pixels it must produce ----

interface Job {
  name: string;
  code: string;
  committed: () => Uint8Array;
}

const atlases = new Map<string, ReturnType<typeof decodePng>>();

function atlasFor(sex: (typeof SEXES)[number]) {
  let atlas = atlases.get(sex);
  if (!atlas) {
    atlas = decodePng(readFileSync(join(PIPELINE_DIRECTORY, "..", "public", heroAtlasPath(sex))));
    atlases.set(sex, atlas);
  }
  return atlas;
}

function heroJobs(sex: (typeof SEXES)[number]): Job[] {
  const cells = new Map(heroFrames(sex).map((frame) => [frame.key, frame]));
  return HERO_ANIMATIONS.flatMap((animation) =>
    heroFrameBuilds(sex, animation).map((frame) => ({
      name: frame.name,
      code: frame.code,
      committed: () => {
        const cell = cells.get(`hero/${frame.name}`);
        if (!cell) throw new Error(`${frame.name} has no cell in the ${sex} atlas`);
        return atlasCellPixels(atlasFor(sex), cell.x, cell.y);
      },
    })),
  );
}

function spriteJobs(): Job[] {
  return readdirSync(SPRITES_DIRECTORY)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => {
      const name = file.slice(0, -3);
      return {
        name,
        code: readFileSync(join(SPRITES_DIRECTORY, file), "utf8"),
        committed: () => decodePng(readFileSync(join(SPRITES_DIRECTORY, `${name}.png`))).data,
      };
    });
}

function jobFor(name: string): Job {
  const job = [...spriteJobs(), ...SEXES.flatMap(heroJobs)].find((candidate) => candidate.name === name);
  if (!job) throw new Error(`unknown sprite ${name}`);
  return job;
}

function differingPixels(first: Uint8Array, second: Uint8Array): number {
  if (first.length !== second.length) return Math.max(first.length, second.length) / 4;
  let differing = 0;
  for (let offset = 0; offset < first.length; offset += 4)
    if (
      first[offset] !== second[offset] ||
      first[offset + 1] !== second[offset + 1] ||
      first[offset + 2] !== second[offset + 2] ||
      first[offset + 3] !== second[offset + 3]
    )
      differing++;
  return differing;
}

// ---- the renderers under test ----

const NO_BREAKDOWN = { start: 0, kitLoad: 0, wait: 0, worker: 0, roundTrip: 0, encode: 0, heapUsed: 0, external: 0 };

function sampleOf(timings: RenderTimings): Sample {
  return {
    total: round(timings.totalMilliseconds),
    start: round(timings.workerStartMilliseconds),
    kitLoad: round(timings.kitLoadMilliseconds),
    wait: round(timings.waitMilliseconds),
    worker: round(timings.workerRenderMilliseconds),
    roundTrip: round(timings.roundTripMilliseconds),
    encode: round(timings.encodeMilliseconds),
    heapUsed: round(timings.workerHeapUsedMegabytes),
    external: round(timings.workerExternalMegabytes),
  };
}

interface Candidate {
  /** One render: the sprite's pixels (RGBA) or an error, with the breakdown when the mode has one. */
  render(request: RenderRequest): Promise<{ pixels: Uint8Array | string; sample: Sample }>;
  setup: number;
  close(): Promise<void>;
  /** Pause before the next render. */
  spacing: number;
}

interface InlineKit {
  Kit: new () => { render(): unknown };
  post(rendered: unknown): { rgba: unknown };
}

function isInlineKit(value: unknown): value is InlineKit {
  return typeof value === "object" && value !== null && Reflect.get(value, "Kit") !== undefined && "post" in value;
}

/** The same kit and build in this process with `new Function` and no isolation at all: the floor the worker is compared with. */
function inlineCandidate(): Candidate {
  const kit = prepareKit();
  const factory = new Function(`${kit.body}\nreturn { ${kit.names.join(", ")} };`);
  return {
    setup: 0,
    spacing: 0,
    close: async () => {},
    render: async (request) => {
      const begun = performance.now();
      const fresh: unknown = factory();
      if (!isInlineKit(fresh)) return { pixels: "kit did not load", sample: { ...NO_BREAKDOWN, total: 0 } };
      const buildFactory = new Function(...kit.names, "POSE", `${prepareBuild(request.code)}\nreturn build;`);
      const build: unknown = buildFactory(...kit.names.map((name) => Reflect.get(fresh, name)), request.pose);
      if (typeof build !== "function") return { pixels: "no build", sample: { ...NO_BREAKDOWN, total: 0 } };
      const sprite = new fresh.Kit();
      build(sprite);
      const pixels = fresh.post(sprite.render()).rgba;
      const total = round(performance.now() - begun);
      return {
        pixels: pixels instanceof Uint8Array ? pixels : "no pixels",
        sample: { ...NO_BREAKDOWN, total, worker: total },
      };
    },
  };
}

async function workerCandidate(options: DirectWorkerOptions, spacing: number): Promise<Candidate> {
  const begun = performance.now();
  const renderer = createDirectWorkerRenderer(options);
  await renderer.ready();
  return {
    setup: round(performance.now() - begun),
    spacing,
    close: () => renderer.close(),
    render: async (request) => {
      const detailed = await renderer.renderDetailed(request);
      if (!detailed.result.ok) return { pixels: detailed.result.error, sample: sampleOf(detailed.timings) };
      return { pixels: decodePng(Buffer.from(detailed.result.png)).data, sample: sampleOf(detailed.timings) };
    },
  };
}

async function localCandidate(): Promise<Candidate> {
  const { renderLocally } = await import("./render-local");
  const render: Renderer = renderLocally;
  return {
    setup: 0,
    spacing: 0,
    close: async () => {},
    render: async (request) => {
      const begun = performance.now();
      const result = await render(request);
      const total = round(performance.now() - begun);
      if (!result.ok) return { pixels: result.error, sample: { ...NO_BREAKDOWN, total } };
      return {
        pixels: decodePng(Buffer.from(result.png)).data,
        sample: { ...NO_BREAKDOWN, total, worker: result.stats.ms ?? 0 },
      };
    },
  };
}

async function candidateFor(mode: Mode): Promise<Candidate> {
  switch (mode) {
    case "inline":
      return inlineCandidate();
    case "fresh":
      return workerCandidate({}, 0);
    case "pool":
      return workerCandidate({ poolSize: 1 }, 0);
    case "pool-spaced":
      return workerCandidate({ poolSize: 1 }, SPACING_MILLISECONDS);
    case "local":
      return localCandidate();
  }
}

// ---- the child: one sprite, `count` renders ----

function failedChild(error: string, samples: Sample[], setup: number, rssStartMegabytes: number): ChildResult {
  return {
    ok: false,
    error,
    samples,
    setupMilliseconds: setup,
    identicalPixels: false,
    differingPixels: -1,
    rssStartMegabytes,
    rssEndMegabytes: megabytes(process.memoryUsage().rss),
  };
}

async function runChild(mode: Mode, sprite: string, count: number): Promise<ChildResult> {
  const job = jobFor(sprite);
  const committed = job.committed();
  const rssStartMegabytes = megabytes(process.memoryUsage().rss);
  const candidate = await candidateFor(mode);
  const samples: Sample[] = [];
  let differing = 0;
  try {
    for (let index = 0; index < count; index++) {
      if (index > 0 && candidate.spacing) await sleep(candidate.spacing);
      const rendered = await candidate.render({ code: job.code, name: sprite, pose: "" });
      samples.push(rendered.sample);
      if (typeof rendered.pixels === "string")
        return failedChild(rendered.pixels, samples, candidate.setup, rssStartMegabytes);
      differing = Math.max(differing, differingPixels(rendered.pixels, committed));
    }
  } finally {
    await candidate.close();
  }
  return {
    ok: true,
    samples,
    setupMilliseconds: candidate.setup,
    identicalPixels: differing === 0,
    differingPixels: differing,
    rssStartMegabytes,
    rssEndMegabytes: megabytes(process.memoryUsage().rss),
  };
}

// ---- identity: every committed sprite and hero frame ----

async function checkIdentity(): Promise<boolean> {
  const jobs = [...spriteJobs(), ...SEXES.flatMap(heroJobs)];
  const renderer = createDirectWorkerRenderer();
  let different = 0;
  const begun = performance.now();
  for (const job of jobs) {
    const result = await renderer.render({ code: job.code, name: job.name, pose: "" });
    if (!result.ok) {
      console.log(`${job.name} ERROR ${result.error}`);
      different++;
      continue;
    }
    const differing = differingPixels(decodePng(Buffer.from(result.png)).data, job.committed());
    if (differing) {
      console.log(`${job.name} DIFFERENT PIXELS (${differing})`);
      different++;
    }
  }
  await renderer.close();
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
      renders: jobs.length,
      withDifferentPixels: different,
      milliseconds: Math.round(performance.now() - begun),
    }),
  );
  return different === 0;
}

// ---- the animation set: the hero's frames in one worker ----

const animationResultSchema = z.object({
  frames: z.number(),
  directions: z.number(),
  strategy: z.string(),
  workerStartMilliseconds: z.number(),
  renderMilliseconds: z.number(),
  setMilliseconds: z.number(),
  atlasMilliseconds: z.number(),
  differingFrames: z.number(),
  failedFrames: z.number(),
});
type AnimationResult = z.infer<typeof animationResultSchema>;

/** Renders the male hero's animation set, `directions` of the five drawn directions, and compares each frame with the atlas. */
async function runAnimation(strategy: string, directions: number): Promise<AnimationResult> {
  const sex = "male";
  const wanted = DRAWN_DIRECTIONS.slice(0, directions);
  const jobs = heroJobs(sex).filter((job) => wanted.some((direction) => job.name.endsWith(`_${direction}`)));
  const requests = jobs.map((job) => ({ code: job.code, name: job.name, pose: "" }));
  const begun = performance.now();
  let results: Array<{ ok: boolean; pixels: Uint8Array | undefined }>;
  let workerStartMilliseconds = 0;
  if (strategy === "one-worker") {
    const batch = await renderBatchInDirectWorker(requests);
    results = batch.results.map((result, index) => ({ ok: result.ok, pixels: batch.pixels[index] }));
    workerStartMilliseconds = batch.workerStartMilliseconds;
  } else if (strategy === "worker-per-direction") {
    const batches = await Promise.all(
      wanted.map((direction) =>
        renderBatchInDirectWorker(requests.filter((request) => request.name.endsWith(`_${direction}`))),
      ),
    );
    results = batches.flatMap((batch) =>
      batch.results.map((result, index) => ({ ok: result.ok, pixels: batch.pixels[index] })),
    );
    workerStartMilliseconds = Math.max(...batches.map((batch) => batch.workerStartMilliseconds));
    // the order is per direction now; rebuild the job order the comparison below needs
    const ordered = wanted.flatMap((direction) => jobs.filter((job) => job.name.endsWith(`_${direction}`)));
    jobs.splice(0, jobs.length, ...ordered);
  } else {
    const renderer = createDirectWorkerRenderer();
    results = [];
    for (const request of requests) {
      const detailed = await renderer.renderDetailed(request);
      results.push({
        ok: detailed.result.ok,
        pixels: detailed.result.ok ? decodePng(Buffer.from(detailed.result.png)).data : undefined,
      });
    }
    await renderer.close();
  }
  const setMilliseconds = performance.now() - begun;
  let differingFrames = 0;
  let failedFrames = 0;
  results.forEach((result, index) => {
    const job = jobs[index];
    if (!result.ok || !result.pixels || !job) {
      failedFrames++;
      return;
    }
    if (differingPixels(result.pixels, job.committed())) differingFrames++;
  });
  // what option C would do next: pack the raw frames into the hero's atlas layout and encode it (full set only)
  let atlasMilliseconds = 0;
  if (directions === DRAWN_DIRECTIONS.length && failedFrames === 0) {
    const frames = new Map<string, Uint8Array>();
    jobs.forEach((job, index) => {
      const pixels = results[index]?.pixels;
      if (pixels) frames.set(`hero/${job.name}`, pixels);
    });
    const packStart = performance.now();
    packHeroAtlas(sex, frames);
    atlasMilliseconds = performance.now() - packStart;
  }
  return {
    frames: jobs.length,
    directions,
    strategy,
    workerStartMilliseconds: round(workerStartMilliseconds),
    renderMilliseconds: round(setMilliseconds - workerStartMilliseconds),
    setMilliseconds: round(setMilliseconds),
    atlasMilliseconds: round(atlasMilliseconds),
    differingFrames,
    failedFrames,
  };
}

// ---- the limits: how low can they go and still render ----

const FLOOR_SPRITES = ["temple", "house", "male_melee3_se", "hydra"];
const FLOOR_CANDIDATES: Record<string, number[]> = {
  maxOldGenerationSizeMb: [4, 8, 12, 16, 24, 32, 48, 64, 128, 192],
  maxYoungGenerationSizeMb: [1, 2, 4, 8, 16, 32],
  stackSizeMb: [0.1, 0.25, 0.5, 1, 2, 4],
};

/** One limit at one value: do the heaviest sprites still render, pixel for pixel? Run in its own process, since a limit that is too low can abort it. */
async function renderWithLimit(kind: string, value: number): Promise<boolean> {
  const jobs = FLOOR_SPRITES.map(jobFor);
  const renderer = createDirectWorkerRenderer({ deadlineMilliseconds: 20_000, limits: { [kind]: value } });
  try {
    for (const job of jobs) {
      const result = await renderer.render({ code: job.code, name: job.name, pose: "" });
      if (!result.ok) return false;
      if (differingPixels(decodePng(Buffer.from(result.png)).data, job.committed())) return false;
    }
    return true;
  } finally {
    await renderer.close();
  }
}

// ---- the parent ----

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? Number.NaN;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function summarise(result: ChildResult) {
  const warm = result.samples.slice(1);
  const column = (pick: (sample: Sample) => number) => warm.map(pick).sort((first, second) => first - second);
  const totals = column((sample) => sample.total);
  return {
    cold: result.samples[0]?.total ?? Number.NaN,
    median: median(totals),
    p95: percentile(totals, 0.95),
    start: median(column((sample) => sample.start)),
    kitLoad: median(column((sample) => sample.kitLoad)),
    wait: median(column((sample) => sample.wait)),
    worker: median(column((sample) => sample.worker)),
    encode: median(column((sample) => sample.encode)),
    heapUsed: median(column((sample) => sample.heapUsed)),
    external: median(column((sample) => sample.external)),
  };
}

function format(value: number): string {
  if (Number.isNaN(value)) return "-";
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function childEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { LAMPWARDEN_PIPELINE_DIRECTORY: PIPELINE_DIRECTORY };
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function spawnChild(command: string[], label: string): Promise<{ line: string | undefined; failure: string }> {
  const subprocess = Bun.spawn(command, { env: childEnvironment(), stdout: "pipe", stderr: "pipe" });
  const [standardOutput, standardError] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  const line = standardOutput
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  const reason = standardError
    .trim()
    .split("\n")
    .filter(Boolean)
    .findLast((candidate) => /error/i.test(candidate));
  return {
    line,
    failure: `${label}: ${(reason ?? standardError.trim().split("\n").at(-1) ?? "no output").slice(0, 200)}`,
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      child: { type: "boolean" },
      identity: { type: "boolean" },
      animation: { type: "boolean" },
      "animation-child": { type: "boolean" },
      floor: { type: "boolean" },
      "identity-child": { type: "boolean" },
      "floor-child": { type: "boolean" },
      kind: { type: "string" },
      value: { type: "string" },
      mode: { type: "string" },
      sprite: { type: "string" },
      strategy: { type: "string" },
      directions: { type: "string", default: "5" },
      renders: { type: "string", default: "10" },
      runtimes: { type: "string", default: "bun,node" },
      modes: { type: "string" },
      sprites: { type: "string" },
      node: { type: "string", default: "node" },
      json: { type: "string" },
    },
  });
  if (values.child) {
    if (!values.mode || !isMode(values.mode) || !values.sprite) throw new Error("--child needs --mode and --sprite");
    console.log(JSON.stringify(await runChild(values.mode, values.sprite, Number(values.renders))));
    return;
  }
  if (values["animation-child"]) {
    console.log(JSON.stringify(await runAnimation(values.strategy ?? "one-worker", Number(values.directions))));
    return;
  }
  if (values["floor-child"]) {
    console.log(JSON.stringify({ pass: await renderWithLimit(values.kind ?? "", Number(values.value)) }));
    return;
  }
  if (values["identity-child"]) {
    process.exitCode = (await checkIdentity()) ? 0 : 1;
    return;
  }
  const runtimes = (values.runtimes ?? "").split(",").filter(isRuntime);
  const nodeBundle = runtimes.includes("node")
    ? await bundleForNode(join(PIPELINE_DIRECTORY, "measure-direct-worker.ts"), "measure-direct-worker.mjs")
    : "";
  const commandFor = (runtime: RuntimeName, ...args: string[]) =>
    runtime === "bun"
      ? [process.execPath, join(PIPELINE_DIRECTORY, "measure-direct-worker.ts"), ...args]
      : [values.node ?? "node", nodeBundle, ...args];
  {
    if (values.floor) {
      for (const runtime of runtimes) {
        for (const [kind, candidates] of Object.entries(FLOOR_CANDIDATES)) {
          const verdicts: string[] = [];
          for (const value of candidates) {
            const outcome = await spawnChild(
              commandFor(runtime, "--floor-child", "--kind", kind, "--value", String(value)),
              `${runtime} ${kind} ${value}`,
            );
            verdicts.push(
              `${value}: ${outcome.line ? (outcome.line.includes("true") ? "renders" : "fails") : "process aborted"}`,
            );
          }
          console.log(`${runtime} ${kind}  ${verdicts.join("  ")}`);
        }
      }
      return;
    }
    if (values.identity) {
      for (const runtime of runtimes) {
        const outcome = await spawnChild(commandFor(runtime, "--identity-child"), `${runtime} identity`);
        console.log(`${runtime}: ${outcome.line ?? outcome.failure}`);
      }
      return;
    }
    if (values.animation) {
      const results: Record<string, AnimationResult[]> = {};
      for (const runtime of runtimes) {
        for (const [strategy, directions] of [
          ["one-worker", 1],
          ["one-worker", 5],
          ["worker-per-direction", 5],
          ["fresh-worker-per-frame", 5],
        ] as const) {
          const key = `${runtime}/${strategy}/${directions}`;
          results[key] = [];
          for (let repetition = 0; repetition < 5; repetition++) {
            const outcome = await spawnChild(
              commandFor(runtime, "--animation-child", "--strategy", strategy, "--directions", String(directions)),
              key,
            );
            if (!outcome.line) {
              console.error(outcome.failure);
              break;
            }
            results[key].push(animationResultSchema.parse(JSON.parse(outcome.line)));
          }
        }
      }
      if (values.json) writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
      for (const [key, runs] of Object.entries(results)) {
        const sets = runs.map((run) => run.setMilliseconds);
        const first = runs[0];
        console.log(
          `${key.padEnd(40)} frames ${first?.frames ?? "-"}  cold ${format(sets[0] ?? Number.NaN)}  warm median ${format(median(sets.slice(1).sort((first, second) => first - second)))} ms  start ${format(first?.workerStartMilliseconds ?? Number.NaN)}  atlas ${format(runs.at(-1)?.atlasMilliseconds ?? Number.NaN)} ms  differing ${runs.reduce((total, run) => total + run.differingFrames, 0)} failed ${runs.reduce((total, run) => total + run.failedFrames, 0)}`,
        );
      }
      return;
    }
    const modes = values.modes ? values.modes.split(",").filter(isMode) : [...MODES];
    const sprites = values.sprites ? values.sprites.split(",") : DEFAULT_SPRITES;
    const everything: Record<string, Record<string, ChildResult>> = {};
    for (const runtime of runtimes) {
      for (const mode of modes) {
        if (runtime === "node" && BUN_ONLY_MODES.includes(mode)) continue;
        const bucket: Record<string, ChildResult> = {};
        everything[`${runtime}/${mode}`] = bucket;
        for (const sprite of sprites) {
          const outcome = await spawnChild(
            commandFor(runtime, "--child", "--mode", mode, "--sprite", sprite, "--renders", values.renders ?? "10"),
            `${runtime}/${mode}/${sprite}`,
          );
          bucket[sprite] = outcome.line
            ? childResultSchema.parse(JSON.parse(outcome.line))
            : failedChild(outcome.failure, [], 0, 0);
          const summary = bucket[sprite].ok ? summarise(bucket[sprite]) : undefined;
          console.error(
            `${runtime}/${mode}/${sprite}: ${summary ? `cold ${format(summary.cold)} median ${format(summary.median)}` : bucket[sprite].error}`,
          );
        }
      }
    }
    if (values.json) writeFileSync(values.json, `${JSON.stringify(everything, null, 2)}\n`);
    for (const [key, bySprite] of Object.entries(everything)) {
      console.log(`\n${key}`);
      for (const [sprite, outcome] of Object.entries(bySprite)) {
        if (!outcome.ok) {
          console.log(`  ${sprite.padEnd(14)} FAILED ${outcome.error ?? ""}`);
          continue;
        }
        const summary = summarise(outcome);
        console.log(
          `  ${sprite.padEnd(14)} cold ${format(summary.cold).padStart(6)}  median ${format(summary.median).padStart(6)}  p95 ${format(summary.p95).padStart(6)}  (start ${format(summary.start)} of which kit ${format(summary.kitLoad)}; wait ${format(summary.wait)}; worker ${format(summary.worker)}; encode ${format(summary.encode)})  setup ${format(outcome.setupMilliseconds)}  heap ${format(summary.heapUsed)} MB ext ${format(summary.external)} MB  pixels ${outcome.identicalPixels ? "identical" : `DIFFER (${outcome.differingPixels})`}  rss ${outcome.rssStartMegabytes}->${outcome.rssEndMegabytes} MB`,
        );
      }
    }
  }
}

await main();
