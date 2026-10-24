// Pixel-identity gate for kit changes: renders every committed sprite (public/sprites/*.ts) and every hero frame (each
// sex's atlas, public/sprites/hero/<sex>.png, holds them) with the local bun renderer and the current pipeline/kit/kit.ts,
// and compares the decoded RGBA with the committed PNGs and atlas cells.
// usage: bun pipeline/check-pixels.ts [--out DIR]   (one line per sprite; exits 1 if any pixel differs or a render fails;
// --out also keeps the rendered PNGs in DIR)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, heroAtlasPath, heroFrames, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { heroFrameBuilds } from "./hero-animation";
import { atlasCellPixels } from "./hero-atlas";
import { renderLocally } from "./render-local";

interface Job {
  name: string;
  code: string;
  committed: () => Uint8Array; // the committed pixels
}

const { values } = parseArgs({ options: { out: { type: "string" } } });
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

let failures = 0;
let totalDiffering = 0;
for (const job of jobs) {
  const result = await renderLocally({ code: job.code, name: job.name, pose: "" }, { timeoutMilliseconds: 120_000 });
  if (!result.ok) {
    console.log(`${job.name.padEnd(22)} ERROR ${result.error}`);
    failures++;
    continue;
  }
  if (outputDirectory) writeFileSync(join(outputDirectory, `${job.name}.png`), result.png);
  const rendered = decodePng(Buffer.from(result.png)).data;
  const differing = differingPixels(rendered, job.committed());
  totalDiffering += differing;
  if (differing) failures++;
  console.log(`${job.name.padEnd(22)} ${differing ? "DIFF" : "ok  "} differing_pixels=${differing}`);
}
console.log(`sprites ${jobs.length}, with differences ${failures}, differing pixels ${totalDiffering}`);
process.exit(failures ? 1 : 0);
