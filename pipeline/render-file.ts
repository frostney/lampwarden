// Renders one build script with the chosen renderer: writes <out_dir>/<name>.png and prints the stats as JSON.
// usage: bun --no-env-file pipeline/render-file.ts [--render local|shotcup|vercel|boat] <build.ts> <name> <out_dir> [pose]
// On failure it prints the reason to stderr and exits 1.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RENDERER_NAMES } from "./render-types";
import { renderBuild } from "./renderers";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { render: { type: "string", default: "local" } },
});
const [buildPath, name, outputDirectory, pose = ""] = positionals;
const rendererName = RENDERER_NAMES.find((candidate) => candidate === values.render);
if (!buildPath || !name || !outputDirectory || !rendererName) {
  console.error(
    `usage: bun pipeline/render-file.ts [--render ${RENDERER_NAMES.join("|")}] <build.ts> <name> <out_dir> [pose]`,
  );
  process.exit(2);
}
const result = await renderBuild(rendererName, { code: readFileSync(buildPath, "utf8"), name, pose });
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, `${name}.png`), result.png);
console.log(JSON.stringify(result.stats));
