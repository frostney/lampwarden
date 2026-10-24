// QuickJS-in-WebAssembly renderer for Node and Bun, on the calling thread: it loads one shared WebAssembly module per
// limit set, runs the build with `runBuild` from quickjs-core.ts (a fresh runtime and context per render, no host
// functions; see that file for what the build cannot reach) and encodes the PNG. It blocks its thread while it runs, so
// the server never calls it on a request thread: render-quickjs.ts runs it in a worker thread with a termination
// deadline. This one stays for the probes, the measurements and the tests, which want the interpreter's own numbers.
import type { QuickJSWASMModule } from "quickjs-emscripten-core";
import { PREPARED_KIT } from "./prepared-kit";
import { createQuickJsModule, errorSummary, runBuild } from "./quickjs-core";
import { type QuickJsLimits, RENDER_LIMITS } from "./quickjs-limits";
import { finishRender } from "./render-finish";
import { invalidRequestReason, type Renderer, type RenderRequest, type RenderResult } from "./render-types";

export interface QuickJsRenderOptions {
  memoryLimitBytes?: number;
  wasmMemoryLimitBytes?: number;
  stackLimitBytes?: number;
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

export function limitsFrom(options: QuickJsRenderOptions): QuickJsLimits {
  return {
    memoryLimitBytes: options.memoryLimitBytes ?? RENDER_LIMITS.memoryLimitBytes,
    wasmMemoryLimitBytes: options.wasmMemoryLimitBytes ?? RENDER_LIMITS.wasmMemoryLimitBytes,
    stackLimitBytes: options.stackLimitBytes ?? RENDER_LIMITS.stackLimitBytes,
    timeoutMilliseconds: options.timeoutMilliseconds ?? RENDER_LIMITS.timeoutMilliseconds,
  };
}

const sharedModules = new Map<number, Promise<QuickJSWASMModule>>();

function loadModule(limits: QuickJsLimits, freshModule: boolean): Promise<QuickJSWASMModule> {
  if (freshModule) return createQuickJsModule(limits.wasmMemoryLimitBytes);
  let module = sharedModules.get(limits.wasmMemoryLimitBytes);
  if (!module) {
    module = createQuickJsModule(limits.wasmMemoryLimitBytes);
    sharedModules.set(limits.wasmMemoryLimitBytes, module);
    // a module that failed to load is not kept: the next render tries again
    module.catch(() => sharedModules.delete(limits.wasmMemoryLimitBytes));
  }
  return module;
}

/** Renders one build in a fresh QuickJS runtime and context, and reports what the interpreter used. */
export async function renderInQuickJsWithDetails(
  request: RenderRequest,
  options: QuickJsRenderOptions = {},
): Promise<QuickJsRenderDetails> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason)
    return { result: { ok: false, error: invalidReason }, interpreterMilliseconds: 0, memoryUsedBytes: 0 };
  const limits = limitsFrom(options);
  const quickJs = await loadModule(limits, options.freshModule === true);
  const start = performance.now();
  const outcome = runBuild(quickJs, PREPARED_KIT, request, limits);
  const interpreterMilliseconds = Math.round(performance.now() - start);
  if (!outcome.ok) {
    // a build that drove the shared module into a trap or out of memory cannot affect the next render
    if (!options.freshModule) sharedModules.delete(limits.wasmMemoryLimitBytes);
    return { result: { ok: false, error: outcome.error }, interpreterMilliseconds, memoryUsedBytes: 0 };
  }
  return {
    result: finishRender(request.name, performance.now() - start, outcome.statsJson, outcome.pixels),
    interpreterMilliseconds,
    memoryUsedBytes: outcome.memoryUsedBytes,
  };
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
