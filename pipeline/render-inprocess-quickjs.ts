// In-process renderer on QuickJS compiled to WebAssembly (quickjs-emscripten 0.32, the release-sync variant): the kit and
// the build both run inside a QuickJS interpreter, so the build never touches the host's JavaScript heap, globals,
// modules or system calls. A measurement spike (docs/LIVE_GENERATION.md, "In-process rendering"); `renderers.ts` does not
// list it and the AGENTS.md rule that model-written code runs only in a sandbox still stands.
//
// Per render: a fresh QuickJS runtime and context, with
//   - no host functions at all: the host evaluates one script and reads the object it evaluates to ({ stats, pixels });
//   - no Date (the intrinsic is not created), no console, no timers, no `process`/`require`/`Bun`, and no module loader,
//     so `import()` has nothing to load; Math.random is replaced by a seeded generator so a render is deterministic (the
//     kit itself never calls it);
//   - a limit on QuickJS's allocator, a hard cap on the module's WebAssembly memory (the allocator limit does not cover
//     typed-array buffers; see `wasmMemoryLimitBytes`), a stack limit, and an interrupt handler that stops the
//     interpreter at a deadline (an endless loop, a runaway regex);
//   - promise jobs never run, because the host never calls executePendingJobs: a build cannot leave work behind.
// The host checks the pixel buffer's size and the stats string's length before it copies or parses anything, then
// encodes the PNG itself.
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";
import {
  DETERMINISM_PRELUDE,
  errorSummary,
  finishRender,
  kitScript,
  MAXIMUM_STATS_CHARACTERS,
  prepareBuild,
  prepareKit,
  runScript,
  SPRITE_PIXEL_BYTES,
} from "./render-inprocess-shared";
import { invalidRequestReason, type Renderer, type RenderRequest, type RenderResult } from "./render-types";

export const DEFAULT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
/** Hard cap on the WebAssembly linear memory of a module; see the note on `wasmMemoryLimitBytes`. */
export const DEFAULT_WASM_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const WASM_PAGE_BYTES = 65536;
const WASM_INITIAL_BYTES = 16 * 1024 * 1024;
export const DEFAULT_STACK_LIMIT_BYTES = 128 * 1024;
export const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;

export interface QuickJsRenderOptions {
  /** Cap on QuickJS's own allocator: objects, arrays and strings count against it. Typed-array buffers do NOT (measured). */
  memoryLimitBytes?: number;
  /**
   * Hard cap on the module's WebAssembly linear memory. The limit above does not cover `ArrayBuffer` backing stores, so
   * without this a build can allocate typed arrays until the heap reaches the wasm maximum (about 2 GiB). With it, the
   * allocation fails inside QuickJS as an ordinary out-of-memory error. The memory is shared by every render of the
   * module and is not returned to the system afterwards (it stays at its high-water mark, at most this cap).
   */
  wasmMemoryLimitBytes?: number;
  stackLimitBytes?: number;
  /** Wall-clock deadline for the kit load plus the build, enforced by the interrupt handler. */
  timeoutMilliseconds?: number;
  /** Instantiate the WebAssembly module for every render instead of once per process (slower, no shared wasm heap). */
  freshModule?: boolean;
}

export interface QuickJsRenderDetails {
  result: RenderResult;
  /** Milliseconds spent in the interpreter: kit load plus build plus post step. */
  interpreterMilliseconds: number;
  /** QuickJS's own count of bytes in use just before the context was disposed (not a peak). */
  memoryUsedBytes: number;
}

const sharedModules = new Map<number, Promise<QuickJSWASMModule>>();

function createModule(wasmMemoryLimitBytes: number): Promise<QuickJSWASMModule> {
  const memory = new WebAssembly.Memory({
    initial: WASM_INITIAL_BYTES / WASM_PAGE_BYTES,
    maximum: wasmMemoryLimitBytes / WASM_PAGE_BYTES,
  });
  return newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: memory }));
}

function loadModule(options: QuickJsRenderOptions): Promise<QuickJSWASMModule> {
  const wasmMemoryLimitBytes = options.wasmMemoryLimitBytes ?? DEFAULT_WASM_MEMORY_LIMIT_BYTES;
  if (options.freshModule) return createModule(wasmMemoryLimitBytes);
  let module = sharedModules.get(wasmMemoryLimitBytes);
  if (!module) {
    module = createModule(wasmMemoryLimitBytes);
    sharedModules.set(wasmMemoryLimitBytes, module);
  }
  return module;
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

/** Renders one build in a fresh QuickJS runtime and context, and reports what the interpreter used. */
export async function renderInQuickJsWithDetails(
  request: RenderRequest,
  options: QuickJsRenderOptions = {},
): Promise<QuickJsRenderDetails> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason)
    return { result: { ok: false, error: invalidReason }, interpreterMilliseconds: 0, memoryUsedBytes: 0 };
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  let buildBody: string;
  try {
    buildBody = prepareBuild(request.code);
  } catch (error) {
    return {
      result: { ok: false, error: `build code did not parse: ${errorSummary(error)}` },
      interpreterMilliseconds: 0,
      memoryUsedBytes: 0,
    };
  }
  const kit = prepareKit();
  const quickJs = await loadModule(options);
  const runtime = quickJs.newRuntime();
  let memoryUsedBytes = 0;
  const start = performance.now();
  const deadline = Date.now() + timeoutMilliseconds;
  let result: RenderResult;
  try {
    runtime.setMemoryLimit(options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(options.stackLimitBytes ?? DEFAULT_STACK_LIMIT_BYTES);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
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
      const output = context.unwrapResult(context.evalCode(runScript(kit, buildBody, request.pose), "build.js"));
      try {
        const statsJson = readString(context, output, "stats");
        const pixels = readPixels(context, output, "pixels");
        result = finishRender(request.name, performance.now() - start, statsJson, pixels);
      } finally {
        output.dispose();
      }
      memoryUsedBytes = readMemoryUsed(runtime, context);
    } finally {
      context.dispose();
    }
  } catch (error) {
    result = { ok: false, error: Date.now() >= deadline ? "render timed out" : `quickjs: ${interpreterError(error)}` };
  } finally {
    runtime.dispose();
  }
  return { result, interpreterMilliseconds: Math.round(performance.now() - start), memoryUsedBytes };
}

/** A Renderer on QuickJS with the given limits. Never throws: a failure is a render error. */
export function createQuickJsRenderer(options: QuickJsRenderOptions = {}): Renderer {
  return async (request) => {
    try {
      return (await renderInQuickJsWithDetails(request, options)).result;
    } catch (error) {
      return { ok: false, error: `quickjs: ${errorSummary(error)}` };
    }
  };
}
