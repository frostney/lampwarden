// The runner a render sandbox executes for one sprite (batch.ts starts one per item):
//   bun runner.ts <build.ts> <name> [pose] [facing] [view]   (KIT_OUT = output directory, default ./out; writes <KIT_OUT>/<name>.png)
// `pose` reaches the code as POSE; `facing`, a turn in degrees, reaches the kit as TURN.degrees, which every builder that
// takes `facing` adds to the one the code wrote (so one piece of code draws a figure from each side). `view`, for a frame
// of a set, is `scale,dx,dy,slides`: the scale and the canvas shift the set's still was drawn with, applied to this frame
// instead of fitting it alone, and how many times the kit may slide the frame six pixels to keep it off the canvas edge
// (the kit's own limit is 5); the slides it made are in `fit`, and say how far the frame is from the still's ground anchor.
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
  ox: number;
  oy: number;
  fixedScale: number | null;
  maxSlides: number;
  scaleF: number;
  fit: string;
  snapped: number;
  dropped: number;
  render(): RenderedSprite;
}
interface KitModule {
  Kit: new () => KitInstance;
  post(rendered: RenderedSprite): RenderedSprite;
  TURN: { degrees: number };
}

function isKitModule(value: Record<string, unknown>): value is Record<string, unknown> & KitModule {
  return typeof value.Kit === "function" && typeof value.post === "function" && typeof value.TURN === "object";
}

const [file, name, poseName, facingText, viewText] = process.argv.slice(2);
if (!file || !name) throw new Error("usage: bun runner.ts <build.ts> <name> [pose] [facing] [view]");
const turn = facingText ? Number(facingText) : 0;
if (!Number.isFinite(turn)) throw new Error("facing is not a number");
const view = viewText ? viewText.split(",").map(Number) : null;
if (view && (view.length !== 4 || !view.every(Number.isFinite))) throw new Error("view is not scale,dx,dy,slides");

const kitExports: Record<string, unknown> = await import(join(import.meta.dir, "..", "kit", "kit.ts"));
if (!isKitModule(kitExports)) throw new Error("the kit does not export Kit, post and TURN");
kitExports.TURN.degrees = turn;

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
if (view) {
  const [scale = 1, shiftX = 0, shiftY = 0, slides = 5] = view;
  kit.fixedScale = scale;
  kit.ox += shiftX;
  kit.oy += shiftY;
  kit.maxSlides = slides;
}
const rendered = kitExports.post(kit.render());
const milliseconds = Math.round(performance.now() - started);
writePng(join(process.env.KIT_OUT || "./out", `${name}.png`), 128, 128, rendered.rgba);
console.log(
  JSON.stringify({
    name,
    ms: milliseconds,
    fit: kit.fit,
    scale: kit.scaleF,
    snapped: kit.snapped,
    dropped: kit.dropped,
    ...rendered.stats,
  }),
);
