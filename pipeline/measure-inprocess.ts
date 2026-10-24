// Times the in-process renderers (direct, node-vm, QuickJS) against the existing ones (local bun
// subprocess, Vercel Sandbox) on committed sprites, and checks every PNG against the committed one. Measurement only.
//
// usage: bun pipeline/measure-inprocess.ts [--runtimes bun,node] [--modes a,b,...] [--sprites a,b,...] [--renders 11]
//          [--node PATH] [--json FILE]
//        bun pipeline/measure-inprocess.ts --identity [--mode quickjs]  (every committed sprite and hero frame, pixels vs PNG)
//        bun pipeline/measure-inprocess.ts --floor [--sprite temple]     (lowest QuickJS memory limit that still renders)
//
// Every (runtime, mode, sprite) runs in its own fresh child process, because "cold" means the first render of a process:
// runtime or isolate creation, kit load and the first interpretation of the code are all in it. The other renders of the
// child are "warm". Under Node the harness first bundles itself with `bun build --target node` (the pipeline imports
// extensionless, which Node cannot resolve), keeping the QuickJS packages external.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { HERO_ANIMATIONS, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { bundleForNode } from "./bundle-for-node";
import { heroFrameBuilds } from "./hero-animation";
import type { Renderer } from "./render-types";

const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const DEFAULT_SPRITES = ["lamp-lit", "house", "satyr", "temple", "male_walk3"];
const DEFAULT_MODES = ["direct", "node-vm", "quickjs", "quickjs-fresh-module", "local", "vercel"] as const;
type Mode = (typeof DEFAULT_MODES)[number];
const RUNTIMES = ["bun", "node"] as const;
type RuntimeName = (typeof RUNTIMES)[number];
/** Modes that need Bun (the local renderer spawns bun) or credentials (the sandbox) run in the harness itself. */
const BUN_ONLY_MODES: readonly Mode[] = ["local", "vercel"];

const childResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  samples: z.array(z.number()),
  identicalPixels: z.boolean(),
  identicalBytes: z.boolean(),
  differingPixels: z.number(),
  rssStartMegabytes: z.number(),
  rssEndMegabytes: z.number(),
  quickJsMemoryUsedBytes: z.number().optional(),
  /** Vercel Sandbox only: how long `bun run_local.ts` took inside the VM for each render. */
  insideVmSamples: z.array(z.number()).optional(),
});
type ChildResult = z.infer<typeof childResultSchema>;

function isMode(value: string): value is Mode {
  return DEFAULT_MODES.some((mode) => mode === value);
}

function isRuntime(value: string): value is RuntimeName {
  return RUNTIMES.some((runtime) => runtime === value);
}

interface Job {
  code: string;
  committedPath: string;
}

function jobFor(sprite: string): Job {
  const hero = /^(male|female)_([a-z]+)(\d+)$/.exec(sprite);
  if (hero) {
    const sex = SEXES.find((candidate) => candidate === hero[1]);
    const animation = HERO_ANIMATIONS.find((candidate) => candidate === hero[2]);
    const frame = animation && sex ? heroFrameBuilds(sex, animation)[Number(hero[3]) - 1] : undefined;
    if (!frame) throw new Error(`unknown hero frame ${sprite}`);
    return { code: frame.code, committedPath: join(SPRITES_DIRECTORY, "hero", `${sprite}.png`) };
  }
  return {
    code: readFileSync(join(SPRITES_DIRECTORY, `${sprite}.ts`), "utf8"),
    committedPath: join(SPRITES_DIRECTORY, `${sprite}.png`),
  };
}

async function rendererFor(mode: Mode): Promise<Renderer> {
  switch (mode) {
    case "direct":
      return (await import("./render-inprocess-direct")).renderDirectly;
    case "node-vm":
      return (await import("./render-inprocess-vm")).createNodeVmRenderer();
    case "quickjs":
      return (await import("./render-inprocess-quickjs")).createQuickJsRenderer();
    case "quickjs-fresh-module":
      return (await import("./render-inprocess-quickjs")).createQuickJsRenderer({ freshModule: true });
    case "local":
      return (await import("./render-local")).renderLocally;
    case "vercel":
      return (await import("./render-vercel-sandbox")).renderInVercelSandbox;
  }
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

const megabytes = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

/** The child: renders one sprite `count` times with one mode, timing each render and checking its pixels. */
async function runChild(mode: Mode, sprite: string, count: number): Promise<ChildResult> {
  const job = jobFor(sprite);
  const committed = readFileSync(job.committedPath);
  const committedPixels = decodePng(committed).data;
  const rssStartMegabytes = megabytes(process.memoryUsage().rss);
  const samples: number[] = [];
  let identicalPixels = true;
  let identicalBytes = true;
  let differing = 0;
  let quickJsMemoryUsedBytes: number | undefined;
  const insideVmSamples: number[] = [];
  const render = await rendererFor(mode);
  for (let index = 0; index < count; index++) {
    const start = performance.now();
    let result: Awaited<ReturnType<Renderer>>;
    if (mode.startsWith("quickjs") && index === 0) {
      const { renderInQuickJsWithDetails } = await import("./render-inprocess-quickjs");
      const details = await renderInQuickJsWithDetails(
        { code: job.code, name: sprite, pose: "" },
        { freshModule: mode === "quickjs-fresh-module" },
      );
      result = details.result;
      quickJsMemoryUsedBytes = details.memoryUsedBytes;
    } else if (mode === "vercel") {
      const { renderWithFreshSandbox } = await import("./render-vercel-sandbox");
      try {
        const rendered = await renderWithFreshSandbox({ code: job.code, name: sprite, pose: "" });
        insideVmSamples.push(rendered.renderCommandMilliseconds);
        result = { ok: true, stats: rendered.stats, png: rendered.png };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      result = await render({ code: job.code, name: sprite, pose: "" });
    }
    samples.push(Math.round((performance.now() - start) * 10) / 10);
    if (!result.ok) return failedChild(result.error, samples, rssStartMegabytes);
    const rendered = decodePng(Buffer.from(result.png)).data;
    const different = differingPixels(rendered, committedPixels);
    if (different) identicalPixels = false;
    differing = Math.max(differing, different);
    if (Buffer.compare(Buffer.from(result.png), committed) !== 0) identicalBytes = false;
  }
  return {
    ok: true,
    samples,
    identicalPixels,
    identicalBytes,
    differingPixels: differing,
    rssStartMegabytes,
    rssEndMegabytes: megabytes(process.memoryUsage().rss),
    ...(quickJsMemoryUsedBytes === undefined ? {} : { quickJsMemoryUsedBytes }),
    ...(insideVmSamples.length ? { insideVmSamples } : {}),
  };
}

function failedChild(error: string, samples: number[], rssStartMegabytes: number): ChildResult {
  return {
    ok: false,
    error,
    samples,
    identicalPixels: false,
    identicalBytes: false,
    differingPixels: -1,
    rssStartMegabytes,
    rssEndMegabytes: megabytes(process.memoryUsage().rss),
  };
}

/** The lowest QuickJS memory limit (in MiB) at which the sprite still renders. */
async function memoryFloor(sprite: string): Promise<{ allocatorMebibytes: number; wasmMebibytes: number }> {
  const { createQuickJsRenderer } = await import("./render-inprocess-quickjs");
  const job = jobFor(sprite);
  const renders = async (options: { memoryLimitBytes?: number; wasmMemoryLimitBytes?: number }) =>
    (await createQuickJsRenderer(options)({ code: job.code, name: sprite, pose: "" })).ok;
  let allocatorMebibytes = -1;
  for (const limit of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    if (await renders({ memoryLimitBytes: limit * 1048576 })) {
      allocatorMebibytes = limit;
      break;
    }
  }
  let wasmMebibytes = -1;
  for (const cap of [16, 17, 18, 20, 24, 32, 48, 64, 128]) {
    if (await renders({ wasmMemoryLimitBytes: cap * 1048576 })) {
      wasmMebibytes = cap;
      break;
    }
  }
  return { allocatorMebibytes, wasmMebibytes };
}

/** Renders every committed sprite and hero frame with one mode and compares each PNG with the committed one. */
async function checkIdentity(mode: Mode): Promise<boolean> {
  const names = readdirSync(SPRITES_DIRECTORY)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -3));
  for (const sex of SEXES)
    for (const animation of HERO_ANIMATIONS)
      for (const frame of heroFrameBuilds(sex, animation)) names.push(frame.name);
  const render = await rendererFor(mode);
  let different = 0;
  let byteDifferent = 0;
  const start = performance.now();
  for (const name of names) {
    const job = jobFor(name);
    const result = await render({ code: job.code, name, pose: "" });
    if (!result.ok) {
      console.log(`${name} ERROR ${result.error}`);
      different++;
      continue;
    }
    const committed = readFileSync(job.committedPath);
    if (differingPixels(decodePng(Buffer.from(result.png)).data, decodePng(committed).data)) {
      console.log(`${name} DIFFERENT PIXELS`);
      different++;
    }
    if (Buffer.compare(Buffer.from(result.png), committed) !== 0) byteDifferent++;
  }
  console.log(
    `${mode}: ${names.length} sprites, ${different} with different pixels, ${byteDifferent} with different PNG bytes, ${Math.round(performance.now() - start)} ms`,
  );
  return different === 0;
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
  const warm = result.samples.slice(1).sort((first, second) => first - second);
  return { cold: result.samples[0] ?? Number.NaN, median: median(warm), p95: percentile(warm, 0.95) };
}

function format(value: number): string {
  if (Number.isNaN(value)) return "-";
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function childEnvironment(kitCache: string): Record<string, string> {
  const environment: Record<string, string> = {
    LAMPWARDEN_PIPELINE_DIRECTORY: PIPELINE_DIRECTORY,
    LAMPWARDEN_KIT_CACHE_DIRECTORY: kitCache,
  };
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function spawnChild(command: string[], kitCache: string, label: string): Promise<ChildResult> {
  const subprocess = Bun.spawn(command, {
    env: childEnvironment(kitCache),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [standardOutput, standardError] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  const line = standardOutput
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  if (!line) {
    const reason = standardError
      .trim()
      .split("\n")
      .filter(Boolean)
      .findLast((candidate) => /error/i.test(candidate));
    return failedChild(
      `${label}: ${(reason ?? standardError.trim().split("\n").at(-1) ?? "no output").slice(0, 200)}`,
      [],
      0,
    );
  }
  return childResultSchema.parse(JSON.parse(line));
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      child: { type: "boolean" },
      floor: { type: "boolean" },
      identity: { type: "boolean" },
      mode: { type: "string" },
      sprite: { type: "string" },
      renders: { type: "string", default: "11" },
      runtimes: { type: "string", default: "bun,node" },
      modes: { type: "string" },
      sprites: { type: "string" },
      node: { type: "string", default: "node" },
      json: { type: "string" },
    },
  });
  if (values.identity) {
    const mode = values.mode ?? "quickjs";
    if (!isMode(mode)) throw new Error(`unknown mode ${mode}`);
    process.exit((await checkIdentity(mode)) ? 0 : 1);
  }
  if (values.floor) {
    console.log(
      JSON.stringify({
        sprite: values.sprite ?? "temple",
        ...(await memoryFloor(values.sprite ?? "temple")),
      }),
    );
    return;
  }
  if (values.child) {
    if (!values.mode || !isMode(values.mode) || !values.sprite) throw new Error("--child needs --mode and --sprite");
    console.log(JSON.stringify(await runChild(values.mode, values.sprite, Number(values.renders))));
    return;
  }
  const runtimes = (values.runtimes ?? "").split(",").filter(isRuntime);
  const modes = values.modes ? values.modes.split(",").filter(isMode) : [...DEFAULT_MODES];
  const sprites = values.sprites ? values.sprites.split(",") : DEFAULT_SPRITES;
  const kitCacheRoot = mkdtempSync(join(tmpdir(), "lampwarden-kit-cache-"));
  const everything: Record<string, Record<string, ChildResult>> = {};
  try {
    const nodeBundle = runtimes.includes("node")
      ? await bundleForNode(join(PIPELINE_DIRECTORY, "measure-inprocess.ts"), "measure-inprocess.mjs")
      : "";
    for (const runtime of runtimes) {
      const kitCache = join(kitCacheRoot, runtime);
      mkdirSync(kitCache, { recursive: true });
      const command = (mode: Mode, sprite: string, renders: string) =>
        runtime === "bun"
          ? [
              process.execPath,
              join(PIPELINE_DIRECTORY, "measure-inprocess.ts"),
              "--child",
              "--mode",
              mode,
              "--sprite",
              sprite,
              "--renders",
              renders,
            ]
          : [
              values.node ?? "node",
              "--no-node-snapshot",
              nodeBundle,
              "--child",
              "--mode",
              mode,
              "--sprite",
              sprite,
              "--renders",
              renders,
            ];
      // fills the kit cache for this runtime, so "cold" below is a new process with a prepared kit on disk
      await spawnChild(command("direct", "lamp-lit", "1"), kitCache, "warm-up");
      for (const mode of modes) {
        if (runtime === "node" && BUN_ONLY_MODES.includes(mode)) continue;
        everything[`${runtime}/${mode}`] = {};
        for (const sprite of sprites) {
          const renders = mode === "vercel" ? "3" : (values.renders ?? "11");
          const outcome =
            mode === "vercel"
              ? await runChild(mode, sprite, Number(renders))
              : await spawnChild(command(mode, sprite, renders), kitCache, mode);
          const bucket = everything[`${runtime}/${mode}`];
          if (bucket) bucket[sprite] = outcome;
          const summary = outcome.ok ? summarise(outcome) : undefined;
          console.error(
            `${runtime}/${mode}/${sprite}: ${outcome.ok ? `cold ${format(summary?.cold ?? Number.NaN)} median ${format(summary?.median ?? Number.NaN)}` : outcome.error}`,
          );
        }
      }
    }
  } finally {
    rmSync(kitCacheRoot, { recursive: true, force: true });
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify(everything, null, 2)}\n`);
  for (const [key, bySprite] of Object.entries(everything)) {
    console.log(`\n${key}`);
    for (const [sprite, outcome] of Object.entries(bySprite)) {
      if (!outcome.ok) {
        console.log(`  ${sprite.padEnd(12)} FAILED ${outcome.error ?? ""}`);
        continue;
      }
      const summary = summarise(outcome);
      console.log(
        `  ${sprite.padEnd(12)} cold ${format(summary.cold).padStart(7)}  median ${format(summary.median).padStart(7)}  p95 ${format(summary.p95).padStart(7)}  pixels ${outcome.identicalPixels ? "identical" : `DIFFER (${outcome.differingPixels})`}  bytes ${outcome.identicalBytes ? "identical" : "differ"}  rss ${outcome.rssStartMegabytes}->${outcome.rssEndMegabytes} MB${outcome.quickJsMemoryUsedBytes === undefined ? "" : `  quickjs ${megabytes(outcome.quickJsMemoryUsedBytes)} MB`}${outcome.insideVmSamples ? `  inside VM ${outcome.insideVmSamples.join("/")} ms` : ""}`,
      );
    }
  }
}

await main();
