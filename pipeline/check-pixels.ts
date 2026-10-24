// Pixel-identity check for kit changes: renders every committed sprite (public/sprites/*.ts) and every hero frame (each
// sex's atlas, public/sprites/hero/<sex>.png, holds them) in the Vercel Sandbox with the snapshot's kit, and compares
// the decoded RGBA with the committed PNGs and atlas cells. The renders go out in a few batches, one VM each, side by
// side. Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth"); a snapshot
// that does not hold this checkout's kit and runner fails the check with the command that rebuilds it.
// usage: bun pipeline/check-pixels.ts [--out DIR] [--batches N] [--vcpus N]   (one line per sprite; exits 1 if any
// pixel differs or a render fails; --out also keeps the rendered PNGs in DIR)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, heroAtlasPath, heroFrames, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { heroFrameBuilds } from "./hero-animation";
import { atlasCellPixels } from "./hero-atlas";
import { renderBatchFromCheckout } from "./render-checkout";
import { SnapshotMismatchError } from "./render-vercel-sandbox";

interface Job {
  name: string;
  code: string;
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
      committed: () => decodePng(readFileSync(join(spritesDirectory, `${name}.png`))).data,
    };
  });
for (const sex of SEXES) {
  const atlas = decodePng(readFileSync(join(import.meta.dir, "..", "public", heroAtlasPath(sex))));
  const cells = new Map(heroFrames(sex).map((frame) => [frame.key, frame]));
  for (const animation of HERO_ANIMATIONS)
    for (const frame of heroFrameBuilds(sex, animation)) {
      const cell = cells.get(`hero/${frame.name}`);
      if (!cell) throw new Error(`${frame.name} has no cell in the ${sex} atlas`);
      jobs.push({ name: frame.name, code: frame.code, committed: () => atlasCellPixels(atlas, cell.x, cell.y) });
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

// the jobs in interleaved slices, so every VM gets a mix of cheap and expensive sprites
const batchCount = Math.max(1, Math.min(Number(values.batches), jobs.length));
const vcpus = Number(values.vcpus);
const slices = Array.from({ length: batchCount }, (_unused, slice) =>
  jobs.filter((_job, position) => position % batchCount === slice),
);

const started = performance.now();
let renderedSlices: Awaited<ReturnType<typeof renderBatchFromCheckout>>[];
try {
  renderedSlices = await Promise.all(
    slices.map((slice) =>
      renderBatchFromCheckout(
        slice.map((job) => ({ code: job.code, name: job.name, pose: "" })),
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
    totalDiffering += differing;
    if (differing) failures++;
    console.log(`${job.name.padEnd(22)} ${differing ? "DIFF" : "ok  "} differing_pixels=${differing}`);
  });
});
console.log(
  `sprites ${jobs.length}, with differences ${failures}, differing pixels ${totalDiffering}; ${batchCount} sandbox batches of ${vcpus} vCPUs in ${elapsedSeconds.toFixed(1)} s`,
);
process.exit(failures ? 1 : 0);
