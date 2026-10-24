// Regenerates the hero's animation frames, as one atlas a sex (public/sprites/hero/<sex>.png): each frame is 128 px, from
// the five drawn directions (src/scene/assets.ts mirrors the other three), and the atlas lays them out by
// heroAtlasCell. No Mubit call: the builder is deterministic code, so running it with the local renderer reproduces the
// committed atlases (`bun run check:pixels` compares them).
// usage: bun --no-env-file pipeline/hero-frames.ts [--render local|shotcup|vercel|boat] [--out public/sprites/hero]
// With --render shotcup one animation is rendered per Shotcup run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, HERO_FRAME_SIZE, SEXES } from "../src/scene/assets";
import { decodePng } from "../tools/logo/png";
import { heroFrameBuilds } from "./hero-animation";
import { packHeroAtlas } from "./hero-atlas";
import { RENDERER_NAMES, type RenderedSprite } from "./render-types";
import { renderBuild } from "./renderers";

const { values } = parseArgs({
  options: {
    render: { type: "string", default: "local" },
    out: { type: "string", default: join(import.meta.dir, "..", "public", "sprites", "hero") },
  },
});
const rendererName = RENDERER_NAMES.find((candidate) => candidate === values.render);
if (!rendererName) throw new Error(`--render must be one of ${RENDERER_NAMES.join(", ")}`);
const outputDirectory = resolve(values.out);
mkdirSync(outputDirectory, { recursive: true });

const rendered = new Map<string, Uint8Array>();
function keep(name: string, sprite: RenderedSprite): void {
  const picture = decodePng(Buffer.from(sprite.png));
  if (picture.width !== HERO_FRAME_SIZE || picture.height !== HERO_FRAME_SIZE)
    throw new Error(`${name}: ${picture.width}x${picture.height}, not ${HERO_FRAME_SIZE} px square`);
  rendered.set(`hero/${name}`, picture.data);
  console.log(name, sprite.stats.flags);
}

for (const sex of SEXES) {
  for (const animation of HERO_ANIMATIONS) {
    const builds = heroFrameBuilds(sex, animation);
    if (rendererName === "shotcup") {
      const { renderBatchOnShotcup } = await import("./render-shotcup");
      for (const [name, sprite] of Object.entries(await renderBatchOnShotcup(builds))) keep(name, sprite);
      continue;
    }
    for (const build of builds) {
      const result = await renderBuild(rendererName, { code: build.code, name: build.name, pose: "" });
      if (!result.ok) throw new Error(`${build.name}: ${result.error}`);
      keep(build.name, result);
    }
  }
  const file = join(outputDirectory, `${sex}.png`);
  writeFileSync(file, packHeroAtlas(sex, rendered));
  console.log(`wrote ${file}`);
}
