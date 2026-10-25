// Pixel-identity check for kit changes: renders every committed sprite (public/sprites/*.ts) and every hero frame (each
// sex's atlas, public/sprites/hero/<sex>.png, holds them; a frame is drawn from the sex's committed model code,
// public/sprites/hero/<sex>.ts, or from the deterministic builder when it has none) in the Vercel Sandbox with the snapshot's kit, and compares
// the decoded RGBA with the committed PNGs and atlas cells. The renders go out in a few batches, one VM each, side by
// side. Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth"); a snapshot
// that does not hold this checkout's kit and runner fails the check with the command that rebuilds it.
// usage: bun pipeline/check-pixels.ts [--out DIR] [--batches N] [--vcpus N]   (one line per sprite; exits 1 if any
// pixel differs or a render fails; --out also keeps the rendered PNGs in DIR)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { ALPHA_BYTE, BYTES_PER_PIXEL } from "../src/lib/pixels";
import { MILLISECONDS_PER_SECOND } from "../src/lib/units";
import { heroAtlasPath, heroFrames, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { atlasCellPixels } from "./hero-atlas";
import { heroBuildsFor } from "./hero-source";
import { renderBatchFromCheckout } from "./render-checkout";
import { SnapshotMismatchError } from "./render-vercel-sandbox";

interface Job {
  name: string;
  code: string;
  pose: string;
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
if (outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
}
const spritesDirectory = join(import.meta.dir, "..", "public", "sprites");

const jobs: Job[] = readdirSync(spritesDirectory)
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => {
    const name = file.slice(0, -".ts".length);
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
    if (!cell) {
      throw new Error(`${build.name} has no cell in the ${sex} atlas`);
    }
    jobs.push({
      name: build.name,
      code: build.code,
      pose: build.pose,
      committed: () => atlasCellPixels(atlas, cell.x, cell.y),
    });
  }
}

// how the run ends: 1 when a sprite differs (below), 2 when the renders fail, 3 when the snapshot is not this checkout's
const EXIT = { failed: 2, staleSnapshot: 3 };
const NAME_COLUMN = 22; // the width of the report's sprite names

function differingPixels(first: Uint8Array, second: Uint8Array): number {
  if (first.length !== second.length) {
    return Math.max(first.length, second.length) / BYTES_PER_PIXEL;
  }
  let differing = 0;
  for (let offset = 0; offset < first.length; offset += BYTES_PER_PIXEL) {
    const channels = [0, 1, 2, ALPHA_BYTE].map((channel) => offset + channel);
    if (channels.some((index) => first[index] !== second[index])) {
      differing++;
    }
  }
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
        slice.map((job) => ({ code: job.code, name: job.name, pose: job.pose })),
        { vcpus },
      ),
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof SnapshotMismatchError ? EXIT.staleSnapshot : EXIT.failed);
}
const elapsedSeconds = (performance.now() - started) / MILLISECONDS_PER_SECOND;

let failures = 0;
let totalDiffering = 0;
slices.forEach((slice, sliceIndex) => {
  slice.forEach((job, position) => {
    const result = renderedSlices[sliceIndex]?.[position];
    if (!result?.ok) {
      console.log(`${job.name.padEnd(NAME_COLUMN)} ERROR ${result?.error ?? "no result"}`);
      failures++;
      return;
    }
    if (outputDirectory) {
      writeFileSync(join(outputDirectory, `${job.name}.png`), result.png);
    }
    const rendered = decodePng(Buffer.from(result.png)).data;
    const differing = differingPixels(rendered, job.committed());
    totalDiffering += differing;
    if (differing) {
      failures++;
    }
    console.log(`${job.name.padEnd(NAME_COLUMN)} ${differing ? "DIFF" : "ok  "} differing_pixels=${differing}`);
  });
});
console.log(
  `sprites ${jobs.length}, with differences ${failures}, differing pixels ${totalDiffering}; ${batchCount} sandbox batches of ${vcpus} vCPUs in ${elapsedSeconds.toFixed(1)} s`,
);
process.exit(failures > 0 ? 1 : 0);
