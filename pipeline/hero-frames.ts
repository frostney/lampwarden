// Regenerates the hero's animation frames, as one atlas a sex (public/sprites/hero/<sex>.png): each frame is 128 px, from
// the five drawn directions (src/scene/assets.ts mirrors the other three), and the atlas lays them out by
// heroAtlasCell. No Mubit call: a sex with committed model code (public/sprites/hero/<sex>.ts, written by
// `bun run assets:hero:generate`) is drawn from that code, one frame per pose and direction, and a sex without it from the
// deterministic builder code (hero-animation.ts). The frames are rendered in the Vercel Sandbox, one batch (one VM) a sex,
// side by side; `bun run check:pixels` compares the committed atlases with a fresh render. A frame that fails to render,
// a pose that draws nothing, or walk or attack frames that do not move fail the run and write nothing.
// Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth").
// usage: bun --no-env-file pipeline/hero-frames.ts [--out public/sprites/hero] [--vcpus 4]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SEXES } from "../src/scene/assets";
import { assembleHeroAtlas } from "./hero-model";
import { HERO_DIRECTORY, heroBuildsFor } from "./hero-source";
import { renderBatchFromCheckout } from "./render-checkout";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: HERO_DIRECTORY },
    vcpus: { type: "string", default: "4" },
  },
});
const outputDirectory = resolve(values.out);
mkdirSync(outputDirectory, { recursive: true });

const atlases = await Promise.all(
  SEXES.map(async (sex) => {
    const { source, builds } = heroBuildsFor(sex);
    const results = await renderBatchFromCheckout(
      builds.map((build) => ({ code: build.code, name: build.name, pose: build.pose })),
      { vcpus: Number(values.vcpus) },
    );
    const assembled = assembleHeroAtlas(sex, builds, results);
    if (!assembled.ok) throw new Error(`${sex} (${source}): ${assembled.reason}`);
    return { sex, atlas: assembled.atlas, frames: builds.length, source };
  }),
);
for (const { sex, atlas, frames, source } of atlases) {
  const file = join(outputDirectory, `${sex}.png`);
  writeFileSync(file, atlas);
  console.log(`wrote ${file} (${frames} frames, from ${source} code)`);
}
