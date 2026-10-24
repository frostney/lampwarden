// Regenerates the hero's animation frames, as one atlas a sex (public/sprites/hero/<sex>.png): each frame is 128 px, from
// the five drawn directions (src/scene/assets.ts mirrors the other three), and the atlas lays them out by
// heroAtlasCell. No Mubit call: the builder is deterministic code. The frames are rendered in the Vercel Sandbox, one
// batch (one VM) a sex, side by side; `bun run check:pixels` compares the committed atlases with a fresh render.
// Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth").
// usage: bun --no-env-file pipeline/hero-frames.ts [--out public/sprites/hero] [--vcpus 4]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, HERO_FRAME_SIZE, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { heroFrameBuilds } from "./hero-animation";
import { packHeroAtlas } from "./hero-atlas";
import { renderBatchFromCheckout } from "./render-checkout";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(import.meta.dir, "..", "public", "sprites", "hero") },
    vcpus: { type: "string", default: "4" },
  },
});
const outputDirectory = resolve(values.out);
mkdirSync(outputDirectory, { recursive: true });

const atlases = await Promise.all(
  SEXES.map(async (sex) => {
    const builds = HERO_ANIMATIONS.flatMap((animation) => heroFrameBuilds(sex, animation));
    const results = await renderBatchFromCheckout(
      builds.map((build) => ({ code: build.code, name: build.name, pose: "" })),
      { vcpus: Number(values.vcpus) },
    );
    const rendered = new Map<string, Uint8Array>();
    builds.forEach((build, position) => {
      const result = results[position];
      if (!result?.ok) throw new Error(`${build.name}: ${result?.error ?? "no result"}`);
      const picture = decodePng(Buffer.from(result.png));
      if (picture.width !== HERO_FRAME_SIZE || picture.height !== HERO_FRAME_SIZE)
        throw new Error(`${build.name}: ${picture.width}x${picture.height}, not ${HERO_FRAME_SIZE} px square`);
      rendered.set(`hero/${build.name}`, picture.data);
    });
    return { sex, atlas: packHeroAtlas(sex, rendered), frames: builds.length };
  }),
);
for (const { sex, atlas, frames } of atlases) {
  const file = join(outputDirectory, `${sex}.png`);
  writeFileSync(file, atlas);
  console.log(`wrote ${file} (${frames} frames)`);
}
