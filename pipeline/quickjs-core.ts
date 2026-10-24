// Runs one model-written build inside QuickJS compiled to WebAssembly and hands back its pixels. This file is the part
// that every place which runs model code shares, and it imports nothing from the host (no node: module, no Bun, no DOM):
// the Node/Bun renderer (render-inprocess-quickjs.ts), the server's worker thread (quickjs-worker-thread.ts) and the
// browser's Web Worker (src/scene/creature-worker.ts) all call `runBuild`.
//
// Per run: a fresh QuickJS runtime and context, with
//   - no host functions at all: the host evaluates scripts and reads the object the last one evaluates to;
//   - no Date (the intrinsic is not created), no console, no timers, no `process`/`require`/`Bun`, no module loader, so
//     `import()` has nothing to load; Math.random is replaced by a seeded generator, so a render is deterministic;
//   - a limit on QuickJS's allocator, a hard cap on the module's WebAssembly memory (the allocator limit does not cover
//     typed-array buffers; see `wasmMemoryLimitBytes`), a stack limit, and an interrupt handler that stops the
//     interpreter at a deadline (an endless loop, a runaway regex);
//   - promise jobs never run, because the host never calls executePendingJobs: a build cannot leave work behind.
// The host checks the pixel buffer's size and the stats string's length before it copies or parses anything.
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import type { QuickJsLimits } from "./quickjs-limits";

export const SPRITE_SIZE = 128;
export const SPRITE_PIXEL_BYTES = SPRITE_SIZE * SPRITE_SIZE * 4;
/** The stats line is a few hundred bytes; anything much longer is a build trying to make the host copy a lot. */
export const MAXIMUM_STATS_CHARACTERS = 4096;

export interface PreparedKit {
  /** SHA-256 of `kit/kit.ts`, the version of the kit these pixels come from. */
  sha256: string;
  /** Every name the kit exports, in source order; build code may call any of them. */
  names: string[];
  /** The kit as statements: no types, no `export`. */
  body: string;
}

/** The kit as one script that defines `__kit` (an object holding every export) in the global scope it runs in. */
export function kitScript(kit: PreparedKit): string {
  return `var __kit = (function () {\n${kit.body}\nreturn { ${kit.names.join(", ")} };\n})();\n`;
}

/**
 * The build script without its leading `export`, the way `render/run_local.ts` does. Build code is plain JavaScript
 * (that is what the generator writes and what the committed sprite scripts are); a type annotation is a syntax error.
 */
export function prepareBuild(code: string): string {
  return code.replace(/^\s*export\s+/m, "").replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
}

/**
 * The script that runs one build against `__kit` and evaluates to `{ stats, pixels }`: `stats` is a JSON string and
 * `pixels` an ArrayBuffer of the 128 px RGBA sprite. Every kit export is a parameter of the build's wrapper function, so
 * build code calls `hero(k, ...)` unqualified, as it does under `run_local.ts`.
 */
export function runScript(kit: PreparedKit, buildBody: string, pose: string): string {
  const parameters = [...kit.names, "POSE"].join(", ");
  const kitArguments = kit.names.map((name) => `__kit.${name}`).join(", ");
  return [
    "(function () {",
    `  const build = (function (${parameters}) {\n${buildBody}\nreturn build;\n})(${kitArguments}, ${JSON.stringify(pose)});`,
    "  const kit = new __kit.Kit();",
    "  build(kit);",
    "  const result = __kit.post(kit.render());",
    "  return {",
    "    stats: JSON.stringify(Object.assign({ fit: kit.fit, snapped: kit.snapped, dropped: kit.dropped }, result.stats)),",
    "    pixels: new Uint8Array(result.rgba).buffer,",
    "  };",
    "})()",
  ].join("\n");
}

/** Replaces Math.random with a seeded generator, so a render never depends on entropy (the kit itself never calls it). */
export const DETERMINISM_PRELUDE = `(function () {
  var state = 0x9e3779b9;
  Math.random = function () {
    state = (state + 0x6d2b79f5) | 0;
    var mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
})();`;

const WASM_PAGE_BYTES = 65536;
const WASM_INITIAL_BYTES = 16 * 1024 * 1024;

/**
 * Instantiates the QuickJS module with a capped linear memory. `wasmLocation` is where the browser fetches the
 * `.wasm` from (its bundler decides that URL); in Node and Bun the package finds its own file.
 */
export function createQuickJsModule(wasmMemoryLimitBytes: number, wasmLocation?: string): Promise<QuickJSWASMModule> {
  // never below the initial size, always whole pages
  const cappedBytes = Math.max(WASM_INITIAL_BYTES, Math.ceil(wasmMemoryLimitBytes / WASM_PAGE_BYTES) * WASM_PAGE_BYTES);
  const memory = new WebAssembly.Memory({
    initial: WASM_INITIAL_BYTES / WASM_PAGE_BYTES,
    maximum: cappedBytes / WASM_PAGE_BYTES,
  });
  return newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmMemory: memory, ...(wasmLocation ? { wasmLocation } : {}) }),
  );
}

function readMemoryUsed(runtime: QuickJSRuntime, context: QuickJSContext): number {
  const usage = runtime.computeMemoryUsage();
  try {
    const dumped: unknown = context.dump(usage);
    if (typeof dumped === "object" && dumped !== null && "memory_used_size" in dumped)
      return Number(dumped.memory_used_size);
    return 0;
  } finally {
    usage.dispose();
  }
}

/** `${name}: ${message}` for whatever a runner threw, capped like every other renderer's error. */
export function errorSummary(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
}

/** What a thrown value inside the interpreter says, as the host sees it: `Name: message`, capped. */
function interpreterError(error: unknown): string {
  const cause: unknown = typeof error === "object" && error !== null && "cause" in error ? error.cause : error;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const name = "name" in cause ? String(cause.name) : "Error";
    return `${name}: ${String(cause.message)}`.slice(0, 300);
  }
  return errorSummary(cause);
}

function readString(context: QuickJSContext, parent: QuickJSHandle, property: string): string | undefined {
  const handle = context.getProp(parent, property);
  try {
    if (context.typeof(handle) !== "string") return undefined;
    // a string's own `length` cannot be overridden by the build, so the size is known before anything is copied
    const lengthHandle = context.getProp(handle, "length");
    const length =
      context.typeof(lengthHandle) === "number" ? context.getNumber(lengthHandle) : Number.POSITIVE_INFINITY;
    lengthHandle.dispose();
    return length > MAXIMUM_STATS_CHARACTERS ? undefined : context.getString(handle);
  } finally {
    handle.dispose();
  }
}

function readPixels(context: QuickJSContext, parent: QuickJSHandle, property: string): Uint8Array | undefined {
  const handle = context.getProp(parent, property);
  try {
    const view = context.getArrayBuffer(handle);
    try {
      // copy out of the WebAssembly heap; the size check comes first so a huge buffer is never copied
      return view.value.length === SPRITE_PIXEL_BYTES ? view.value.slice() : undefined;
    } finally {
      view.dispose();
    }
  } catch {
    return undefined;
  } finally {
    handle.dispose();
  }
}

export interface BuildRun {
  /** The result object's `stats` (a JSON string) and `pixels`, each only when it passed its size check. */
  statsJson: string | undefined;
  pixels: Uint8Array | undefined;
  /** QuickJS's own count of bytes in use just before the context was disposed (not a peak). */
  memoryUsedBytes: number;
}

export type BuildOutcome =
  | ({ ok: true } & BuildRun)
  | {
      ok: false;
      error: string /** The interrupt handler fired: the deadline, not an error in the build. */;
      timedOut: boolean;
    };

/** Runs one build in a fresh runtime and context of `quickJs`. Synchronous: it holds its thread until it is done. */
export function runBuild(
  quickJs: QuickJSWASMModule,
  kit: PreparedKit,
  request: { code: string; pose: string },
  limits: QuickJsLimits,
): BuildOutcome {
  const runtime = quickJs.newRuntime();
  // a monotonic deadline; the interrupt handler records that it fired, so only a real timeout is reported as one
  const deadline = performance.now() + limits.timeoutMilliseconds;
  let interrupted = false;
  try {
    runtime.setMemoryLimit(limits.memoryLimitBytes);
    runtime.setMaxStackSize(limits.stackLimitBytes);
    runtime.setInterruptHandler(() => {
      if (performance.now() < deadline) return false;
      interrupted = true;
      return true;
    });
    // Date is left out: a render must not depend on the clock. (Eval stays, because the host's own evalCode needs it.)
    const context = runtime.newContext({
      intrinsics: {
        BaseObjects: true,
        StringNormalize: true,
        RegExp: true,
        JSON: true,
        Proxy: true,
        MapSet: true,
        TypedArrays: true,
        Promise: true,
        Eval: true,
      },
    });
    try {
      context.unwrapResult(context.evalCode(DETERMINISM_PRELUDE, "prelude.js")).dispose();
      context.unwrapResult(context.evalCode(kitScript(kit), "kit.js")).dispose();
      const output = context.unwrapResult(
        context.evalCode(runScript(kit, prepareBuild(request.code), request.pose), "build.js"),
      );
      try {
        const statsJson = readString(context, output, "stats");
        const pixels = readPixels(context, output, "pixels");
        let memoryUsedBytes = 0;
        try {
          memoryUsedBytes = readMemoryUsed(runtime, context);
        } catch {
          memoryUsedBytes = 0; // a statistic must not turn a finished render into a failure
        }
        return { ok: true, statsJson, pixels, memoryUsedBytes };
      } finally {
        output.dispose();
      }
    } finally {
      context.dispose();
    }
  } catch (error) {
    return {
      ok: false,
      error: interrupted ? "render timed out" : `quickjs: ${interpreterError(error)}`,
      timedOut: interrupted,
    };
  } finally {
    runtime.dispose();
  }
}
