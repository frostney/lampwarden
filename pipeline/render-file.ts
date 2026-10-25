// Renders one build script in the Vercel Sandbox: writes <out_dir>/<name>.png and prints the stats as JSON.
// usage: bun --no-env-file pipeline/render-file.ts <build.ts> <name> <out_dir> [pose]
// Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth").
// On failure it prints the reason to stderr and exits 1.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderFromCheckout } from "./render-checkout";

const [buildPath, name, outputDirectory, pose = ""] = Bun.argv.slice(2);
if (!buildPath || !name || !outputDirectory) {
  console.error("usage: bun pipeline/render-file.ts <build.ts> <name> <out_dir> [pose]");
  process.exit(2);
}
const result = await renderFromCheckout({ code: readFileSync(buildPath, "utf8"), name, pose });
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, `${name}.png`), result.png);
console.log(JSON.stringify(result.stats));
