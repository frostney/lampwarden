// EXPERIMENT (docs/LIVE_GENERATION.md, "Direct execution in the browser (option E)"). Bundles the direct creature worker
// (src/scene/creature-direct-worker.ts) and the prepared kit into one self-contained script, public/creature-direct-worker.js.
// It is a file of its own, and not a chunk of the app, for one reason: a Content-Security-Policy on the worker's own response
// is what limits what a worker can do (next.config.ts), and the app's worker chunks are shared with the QuickJS worker, whose
// WebAssembly needs the network that the direct worker must not have.
// usage: bun pipeline/build-direct-worker.ts      (`bun run dev` and `bun run build` run it first; the output is git-ignored)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTPUT = join(ROOT, "public", "creature-direct-worker.js");

const result = await Bun.build({
  entrypoints: [join(ROOT, "src", "scene", "creature-direct-worker.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  banner: '"use strict";', // so the build cannot walk up to this code with `caller` and `arguments`
});
const [bundle] = result.outputs;
if (!result.success || !bundle) {
  console.error(result.logs.join("\n"));
  process.exit(1);
}
mkdirSync(join(ROOT, "public"), { recursive: true });
writeFileSync(OUTPUT, await bundle.text());
console.log(`wrote public/creature-direct-worker.js (${bundle.size} bytes)`);
