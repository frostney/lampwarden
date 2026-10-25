// Pixel-identity check for kit changes: renders every committed sprite (public/sprites/*.ts), every hero frame (each
// sex's atlas, public/sprites/hero/<sex>.png, holds them; a frame is drawn from the sex's committed model code,
// public/sprites/hero/<sex>.ts, or from the deterministic builder when it has none) and every frame of the hand-made
// monsters (the atlases public/sprites/<kind>-frames.png, drawn from the monster's committed code on the canvas that
// src/scene/monster-frames.json records, and slid along their cells as it records) in the Vercel Sandbox with the
// snapshot's kit, and compares the decoded RGBA with the committed PNGs and atlas cells. The renders go out in a few batches, one VM each, side by
// side. Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth"); a snapshot
// that does not hold this checkout's kit and runner fails the check with the command that rebuilds it.
// usage: bun pipeline/check-pixels.ts [--out DIR] [--batches N] [--vcpus N]   (one line per sprite; exits 1 if any
// pixel differs or a render fails; --out also keeps the rendered PNGs in DIR)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { heroAtlasPath, heroFrames, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { slidesOf } from "./creature-frames";
import { atlasCellPixels } from "./hero-atlas";
import { heroBuildsFor } from "./hero-source";
import { monsterAtlasFile, monsterCodePath, monsterFrameBuilds, SHEET_KINDS } from "./monster-source";
import { renderBatchFromCheckout } from "./render-checkout";
import type { FrameView } from "./render-types";
import { SnapshotMismatchError } from "./render-vercel-sandbox";

interface Job {
  name: string;
  code: string;
  pose: string;
  facing?: number;
  view?: FrameView;
  /** How far the frame must have been slid along its cell, where that is recorded (a frame of a monster's atlas). */
  shift?: readonly [number, number];
  committed: () => Uint8Array; // the committed pixels
}

const DEFAULT_BATCHES = 4;
const DEFAULT_VCPUS = 4;
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    batches: { type: "string", default: String(DEFAULT_BATCHES) },
    vcpus: { type: "string", default: String(DEFAULT_VCPUS) },
  },
});
const outputDirectory = values.out ? resolve(values.out) : null;
if (outputDirectory) mkdirSync(outputDirectory, { recursive: true });
const spritesDirectory = join(import.meta.dir, "..", "public", "sprites");

const jobs: Job[] = readdirSync(spritesDirectory)
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => {
    const name = file.slice(0, -3);
    return {
      name,
      code: readFileSync(join(spritesDirectory, file), "utf8"),
      pose: "",
      committed: () => decodePng(readFileSync(join(spritesDirectory, `${name}.png`))).data,
    };
  });
for (const sex of SEXES) {
  const atlas = decodePng(readFileSync(join(import.meta.dir, "..", "public", heroAtlasPath(sex))));
  const cells = new Map(heroFrames(sex).map((frame) => [frame.key, frame]));
  for (const build of heroBuildsFor(sex).builds) {
    const cell = cells.get(`hero/${build.name}`);
    if (!cell) throw new Error(`${build.name} has no cell in the ${sex} atlas`);
    jobs.push({
      name: build.name,
      code: build.code,
      pose: build.pose,
      committed: () => atlasCellPixels(atlas, cell.x, cell.y),
    });
  }
}

for (const kind of SHEET_KINDS) {
  const atlas = decodePng(readFileSync(monsterAtlasFile(kind)));
  for (const build of monsterFrameBuilds(kind, readFileSync(monsterCodePath(kind), "utf8")))
    jobs.push({
      name: build.request.name,
      code: build.request.code,
      pose: build.request.pose,
      ...(build.request.facing === undefined ? {} : { facing: build.request.facing }),
      ...(build.request.view === undefined ? {} : { view: build.request.view }),
      shift: build.shift,
      committed: () => atlasCellPixels(atlas, build.x, build.y),
    });
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

// the jobs in interleaved slices, so every VM gets a mix of cheap and expensive sprites
const batchCount = Math.max(1, Math.min(Math.trunc(Number(values.batches)) || DEFAULT_BATCHES, jobs.length));
const vcpus = Math.trunc(Number(values.vcpus)) || DEFAULT_VCPUS;
const slices = Array.from({ length: batchCount }, (_unused, slice) =>
  jobs.filter((_job, position) => position % batchCount === slice),
);

const started = performance.now();
let renderedSlices: Awaited<ReturnType<typeof renderBatchFromCheckout>>[];
try {
  renderedSlices = await Promise.all(
    slices.map((slice) =>
      renderBatchFromCheckout(
        slice.map((job) => ({
          code: job.code,
          name: job.name,
          pose: job.pose,
          ...(job.facing === undefined ? {} : { facing: job.facing }),
          ...(job.view === undefined ? {} : { view: job.view }),
        })),
        { vcpus },
      ),
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof SnapshotMismatchError ? 3 : 2);
}
const elapsedSeconds = (performance.now() - started) / 1000;

let failures = 0;
let totalDiffering = 0;
slices.forEach((slice, sliceIndex) => {
  slice.forEach((job, position) => {
    const result = renderedSlices[sliceIndex]?.[position];
    if (!result?.ok) {
      console.log(`${job.name.padEnd(22)} ERROR ${result?.error ?? "no result"}`);
      failures++;
      return;
    }
    if (outputDirectory) writeFileSync(join(outputDirectory, `${job.name}.png`), result.png);
    const rendered = decodePng(Buffer.from(result.png)).data;
    const differing = differingPixels(rendered, job.committed());
    // the slide a frame is drawn with is what the game undoes: the one recorded must be the one the kit makes
    const slid = slidesOf(result.stats.fit);
    const shifted = job.shift !== undefined && (slid.dx !== job.shift[0] || slid.dy !== job.shift[1]);
    totalDiffering += differing;
    if (differing || shifted) failures++;
    console.log(
      `${job.name.padEnd(22)} ${differing || shifted ? "DIFF" : "ok  "} differing_pixels=${differing}${shifted ? ` slid ${slid.dx},${slid.dy} not ${job.shift?.join(",")}` : ""}`,
    );
  });
});
console.log(
  `sprites ${jobs.length}, with differences ${failures}, differing pixels ${totalDiffering}; ${batchCount} sandbox batches of ${vcpus} vCPUs in ${elapsedSeconds.toFixed(1)} s`,
);
process.exit(failures ? 1 : 0);
