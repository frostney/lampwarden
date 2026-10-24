// Builds the short /main.ts for a Shotcup run: the kit lives on the `lampwarden` Shotcup drive (mounted at /kit), so a
// run only carries the build() calls. Each build is wrapped as its own function, rendered through Kit/post and written to
// /out/<name>.png (128 px); the stats of every build are printed as one JSON array on the last line.
//
// usage: bun pipeline/shotcup-main-source.ts build1.ts [build2.ts ...] [--pose walk3] > main.ts   (names are the file stems)
//        bun pipeline/shotcup-main-source.ts --hero male walk > main.ts   (every frame of that animation in one run)
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { HERO_ANIMATIONS, SEXES } from "../src/scene/assets";
import { bannedIdentifierIn } from "./build-code";
import { heroFrameBuilds } from "./hero-animation";
import kitExports from "./kit/exports.json";
import { isSafeRenderArgument, type RenderRequest } from "./render-types";

export type NamedBuild = Pick<RenderRequest, "name" | "code">;

/** The source of /main.ts for these builds. Every kit export is destructured so build code can call hero(), ship(), ... */
export function shotcupMainSource(builds: readonly NamedBuild[], pose = ""): string {
  const lines = [
    "import { createCanvas } from 'shotcup:canvas';",
    "import * as K from '/kit/kit.ts';",
    `const { ${kitExports.join(", ")} } = K;`,
    `const POSE = ${JSON.stringify(pose)};`,
    "const res: any[] = [];",
  ];
  builds.forEach((build, index) => {
    // the name lands in generated source, the banned check is the last defence if a caller skipped it
    if (!isSafeRenderArgument(build.name)) throw new Error(`invalid sprite name: ${build.name}`);
    const banned = bannedIdentifierIn(build.code);
    if (banned) throw new Error(`${build.name}: banned identifier ${banned}`);
    const body = build.code.replace(/^\s*export\s+/gm, "");
    lines.push(body.replace(/function build\s*\(/, `function build${index}(`));
    lines.push(
      `{ const k = new Kit(); build${index}(k); const r = post(k.render()); ` +
        `createCanvas(128, 128, { pixels: r.rgba }).save('/out/${build.name}.png'); ` +
        `res.push({ name: ${JSON.stringify(build.name)}, fit: k.fit, snapped: k.snapped, dropped: k.dropped, ...r.stats }); }`,
    );
  });
  lines.push("console.log(JSON.stringify(res));");
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: { hero: { type: "boolean" }, pose: { type: "string" } },
  });
  const [sex, animation] = positionals;
  if (values.hero) {
    const heroSex = SEXES.find((candidate) => candidate === sex);
    const heroAnimation = HERO_ANIMATIONS.find((candidate) => candidate === animation);
    if (!heroSex || !heroAnimation)
      throw new Error(`usage: --hero <${SEXES.join("|")}> <${HERO_ANIMATIONS.join("|")}>`);
    process.stdout.write(shotcupMainSource(heroFrameBuilds(heroSex, heroAnimation)));
  } else {
    const builds = positionals.map((path) => ({
      name: basename(path, extname(path)),
      code: readFileSync(path, "utf8"),
    }));
    process.stdout.write(shotcupMainSource(builds, values.pose ?? ""));
  }
}
