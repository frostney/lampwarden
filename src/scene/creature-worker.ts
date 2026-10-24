// The Web Worker that draws a creature from its build code (src/scene/creature-render.ts starts one per creature and
// terminates it). It runs the code in QuickJS compiled to WebAssembly with no host functions, so the code can name nothing
// of this worker: not `self`, `fetch`, `postMessage`, `importScripts` or the page. The kit (the same prepared kit the
// server judged the sprite with) and the WebAssembly module load here, lazily, only when a creature is announced.
//
// One request per worker: the code and the limits in, the 128 x 128 RGBA pixels (or a failure) out. The page checks the
// code's hash before it sends the code and the pixels' hash after (src/game/creature-build.ts).
import { PREPARED_KIT } from "../../pipeline/prepared-kit";
import { createQuickJsModule, runBuild } from "../../pipeline/quickjs-core";
import type { QuickJsLimits } from "../../pipeline/quickjs-limits";

// Where the bundler puts the WebAssembly file (a hashed, immutable static asset).
const WASM_LOCATION = new URL(
  "../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
  import.meta.url,
).href;

export interface DrawRequest {
  code: string;
  limits: QuickJsLimits;
}

export type DrawReply =
  | { ok: true; pixels: ArrayBuffer; loadMilliseconds: number; runMilliseconds: number }
  | { ok: false; reason: string };

const isDrawRequest = (value: unknown): value is DrawRequest =>
  typeof value === "object" && value !== null && "code" in value && "limits" in value;

// `self` is typed as the window here; only the one-argument postMessage is used
const reply: { postMessage(message: DrawReply): void } = self;

async function draw(request: DrawRequest): Promise<DrawReply> {
  try {
    const loadStart = performance.now();
    const quickJs = await createQuickJsModule(request.limits.wasmMemoryLimitBytes, WASM_LOCATION);
    const runStart = performance.now();
    const outcome = runBuild(quickJs, PREPARED_KIT, { code: request.code, pose: "" }, request.limits);
    if (!outcome.ok) return { ok: false, reason: outcome.error };
    if (!outcome.pixels) return { ok: false, reason: "no usable pixels" };
    return {
      ok: true,
      pixels: new Uint8Array(outcome.pixels).buffer,
      loadMilliseconds: runStart - loadStart,
      runMilliseconds: performance.now() - runStart,
    };
  } catch {
    return { ok: false, reason: "the worker failed" };
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isDrawRequest(event.data)) return reply.postMessage({ ok: false, reason: "bad request" });
  void draw(event.data).then((answer) => reply.postMessage(answer));
});
