// In-process renderer on isolated-vm (a V8 isolate per render, in the host process). A measurement spike
// (docs/LIVE_GENERATION.md, "In-process rendering"); `renderers.ts` does not list it.
//
// Per render: a fresh `Isolate` with its own heap and a memory limit, a fresh context, no host callbacks or references
// handed in, and a script `timeout` that terminates the isolate's thread. Only the kit and the build are loaded; the
// host reads `{ stats, pixels }` out of the isolate by copy. Native module: loads under Node 24 and 26 from a prebuilt
// binary (its README asks for `--no-node-snapshot` on Node 20+; the renders here ran without it on 24.19), does not
// load under Bun (it links against V8 symbols that JavaScriptCore does not have), and is in maintenance mode upstream.
// Its README says the memory limit is "more of a guideline" that a determined attacker can exceed by 2-3x. The probes
// found two ways a build gets past this renderer's limits: 10M small objects crashed the host process (SIGSEGV on Node
// 24, abort on Node 26), and a thrown object whose `toString` never returns stops the render from ever settling.
import { createRequire } from "node:module";
import type { ExternalCopy, Isolate } from "isolated-vm";
import {
  DETERMINISM_PRELUDE,
  errorSummary,
  finishRender,
  kitScript,
  prepareBuild,
  prepareKit,
  runScript,
} from "./render-inprocess-shared";
import { invalidRequestReason, type Renderer } from "./render-types";

export const DEFAULT_MEMORY_LIMIT_MEGABYTES = 64;
export const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;

export interface IsolatedVmRenderOptions {
  memoryLimitMegabytes?: number;
  timeoutMilliseconds?: number;
  /** Start every isolate from a V8 heap snapshot that already holds the kit, instead of compiling the kit each time. */
  useSnapshot?: boolean;
}

type IsolatedVm = typeof import("isolated-vm");

let isolatedVm: IsolatedVm | undefined;
let kitSnapshot: ExternalCopy<ArrayBuffer> | undefined;

function loadIsolatedVm(): IsolatedVm {
  isolatedVm ??= createRequire(import.meta.url)("isolated-vm");
  if (!isolatedVm) throw new Error("isolated-vm did not load");
  return isolatedVm;
}

/** A Renderer on isolated-vm with the given limits. Never throws: a failure is a render error. */
export function createIsolatedVmRenderer(options: IsolatedVmRenderOptions = {}): Renderer {
  return async (request) => {
    const invalidReason = invalidRequestReason(request);
    if (invalidReason) return { ok: false, error: invalidReason };
    let isolate: Isolate | undefined;
    try {
      const ivm = loadIsolatedVm();
      const kit = prepareKit();
      const buildBody = prepareBuild(request.code);
      const timeout = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
      const memoryLimit = options.memoryLimitMegabytes ?? DEFAULT_MEMORY_LIMIT_MEGABYTES;
      const start = performance.now();
      if (options.useSnapshot) {
        kitSnapshot ??= ivm.Isolate.createSnapshot([
          { code: `${DETERMINISM_PRELUDE}\n${kitScript(kit)}`, filename: "kit.js" },
        ]);
        isolate = new ivm.Isolate({ memoryLimit, snapshot: kitSnapshot });
      } else {
        isolate = new ivm.Isolate({ memoryLimit });
      }
      const context = await isolate.createContext();
      if (!options.useSnapshot) {
        const kitProgram = await isolate.compileScript(`${DETERMINISM_PRELUDE}\n${kitScript(kit)}`, {
          filename: "kit.js",
        });
        await kitProgram.run(context, { timeout });
      }
      const buildProgram = await isolate.compileScript(runScript(kit, buildBody, request.pose), {
        filename: "build.js",
      });
      // a Reference to the result object; the sizes below are checked after the copy, which the isolate's memory limit bounds
      const output = await buildProgram.run(context, { timeout, reference: true });
      const statsJson: unknown = await output.get("stats", { copy: true });
      const pixelBuffer: unknown = await output.get("pixels", { copy: true });
      const pixels = pixelBuffer instanceof ArrayBuffer ? new Uint8Array(pixelBuffer) : undefined;
      return finishRender(request.name, performance.now() - start, statsJson, pixels);
    } catch (error) {
      return { ok: false, error: `isolated-vm: ${errorSummary(error)}` };
    } finally {
      isolate?.dispose();
    }
  };
}
