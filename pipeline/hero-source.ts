// Where a warden's frames come from: the model's committed build code (public/sprites/hero/<sex>.ts, written by
// `bun run assets:hero:generate` when the model's warden beat the deterministic one), or, when a sex has none, the
// deterministic builds in hero-animation.ts. `assets:hero` and `check:pixels` both read it from here, so they always agree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HERO_ANIMATIONS, type Sex } from "../src/scene/assets";
import { type FrameBuild, heroFrameBuilds } from "./hero-animation";
import { heroModelFrameBuilds } from "./hero-model";

export const HERO_DIRECTORY = join(import.meta.dir, "..", "public", "sprites", "hero");

const heroCodePath = (sex: Sex, directory = HERO_DIRECTORY) => join(directory, `${sex}.ts`);

/** The model's committed build code for a sex, or null when the deterministic warden is the one in use. */
export function committedHeroCode(sex: Sex, directory = HERO_DIRECTORY): string | null {
  const path = heroCodePath(sex, directory);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** The 100 frame builds of a sex: from the committed model code when there is some, else the deterministic ones. */
export function heroBuildsFor(
  sex: Sex,
  directory = HERO_DIRECTORY,
): { source: "model" | "deterministic"; builds: FrameBuild[] } {
  const code = committedHeroCode(sex, directory);
  return code === null
    ? { source: "deterministic", builds: HERO_ANIMATIONS.flatMap((animation) => heroFrameBuilds(sex, animation)) }
    : { source: "model", builds: heroModelFrameBuilds(sex, code) };
}
