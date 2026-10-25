// The runner a render sandbox executes for one sprite (batch.ts starts one per item):
//   bun runner.ts <build.ts> <name> [pose]   (KIT_OUT = output directory, default ./out; writes <KIT_OUT>/<name>.png)
// It runs model-written code, so model code reaches it only inside the Vercel Sandbox VM, never on a host.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writePng } from "./png";

// The kit (../kit/kit.ts) is excluded from type-checking: it is the model-facing API, written for its prompts rather
// than for strict TypeScript, and a static import would pull all of it into the checker. It is loaded by path instead,
// and this is the part of its exports the runner relies on (see `Kit` and `post` in kit.ts).
interface RenderedSprite {
  rgba: Uint8Array;
  stats: Record<string, number | string | boolean>;
}
interface KitInstance {
  fit: string;
  snapped: number;
  dropped: number;
  render(): RenderedSprite;
}
interface KitModule {
  Kit: new () => KitInstance;
  post(rendered: RenderedSprite): RenderedSprite;
}

function isKitModule(value: Record<string, unknown>): value is Record<string, unknown> & KitModule {
  return typeof value.Kit === "function" && typeof value.post === "function";
}

const [file, name, poseName] = process.argv.slice(2);
if (!file || !name) throw new Error("usage: bun runner.ts <build.ts> <name> [pose]");

const kitExports: Record<string, unknown> = await import(join(import.meta.dir, "..", "kit", "kit.ts"));
if (!isKitModule(kitExports)) throw new Error("the kit does not export Kit and post");

const source = readFileSync(file, "utf8");
const names = Object.keys(kitExports).filter((exportName) => /^[A-Za-z_]\w*$/.test(exportName));
const body = new Bun.Transpiler({ loader: "ts" })
  .transformSync(source.replace(/^\s*export\s+/m, ""))
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
const started = performance.now();
const build: unknown = new Function(...names, "POSE", `${body}\nreturn build;`)(
  ...names.map((exportName) => kitExports[exportName]),
  poseName || "",
);
if (typeof build !== "function") throw new TypeError("build is not a function");
const kit = new kitExports.Kit();
build(kit);
const rendered = kitExports.post(kit.render());
const milliseconds = Math.round(performance.now() - started);
writePng(join(process.env.KIT_OUT || "./out", `${name}.png`), 128, 128, rendered.rgba);
console.log(
  JSON.stringify({
    name,
    ms: milliseconds,
    fit: kit.fit,
    snapped: kit.snapped,
    dropped: kit.dropped,
    ...rendered.stats,
  }),
);
