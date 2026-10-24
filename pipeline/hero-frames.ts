// Regenerates the plain 128 px hero animation frames (public/sprites/hero/<sex>_<animation><n>.png). No Mubit call: the
// builder is deterministic code, so running it with the local renderer reproduces the committed frames (`bun run
// check:pixels` compares them).
// usage: bun --no-env-file pipeline/hero-frames.ts [--renderer local|shotcup|vercel|boat] [--out public/sprites/hero]
// With --renderer shotcup one animation is rendered per Shotcup run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, SEXES } from "../src/scene/assets";
import { heroFrameBuilds } from "./hero-animation";
import { RENDERER_NAMES, type RenderedSprite } from "./render-types";
import { renderBuild } from "./renderers";

const { values } = parseArgs({
  options: {
    renderer: { type: "string", default: "local" },
    out: { type: "string", default: join(import.meta.dir, "..", "public", "sprites", "hero") },
  },
});
const rendererName = RENDERER_NAMES.find((candidate) => candidate === values.renderer);
if (!rendererName) throw new Error(`--renderer must be one of ${RENDERER_NAMES.join(", ")}`);
const outputDirectory = resolve(values.out);
mkdirSync(outputDirectory, { recursive: true });

function keep(name: string, sprite: RenderedSprite): void {
  writeFileSync(join(outputDirectory, `${name}.png`), sprite.png);
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
}
