// MEASUREMENT ONLY. `node:vm` is not a security boundary; never give this renderer model output.
//
// The kit and the build run in a fresh `node:vm` context per render. A context has its own globals (no `process`, no
// `require`), a script `timeout` stops a synchronous endless loop, and a fresh context means one render cannot change
// the next one's builtins. But objects of the host realm leak in through the constructors: inside the context,
// `this.constructor.constructor('return process')()` is the host's `process`, from which a build can read the
// environment, spawn processes and reach the network and the file system. Node's documentation says the same
// ("The node:vm module is not a security mechanism. Do not use it to run untrusted code."). The probes in
// pipeline/inprocess_eval/probes show what gets through; `pipeline/probe-inprocess.ts` runs them only in a disposable
// child process. `renderers.ts` does not list this renderer.

import { types } from "node:util";
import { createContext, Script } from "node:vm";
import {
  DETERMINISM_PRELUDE,
  errorSummary,
  finishRender,
  isCommittedSpriteScript,
  kitScript,
  prepareBuild,
  prepareKit,
  runScript,
} from "./render-inprocess-shared";
import { invalidRequestReason, type Renderer, type RenderRequest, type RenderResult } from "./render-types";

export const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;

export interface NodeVmRenderOptions {
  timeoutMilliseconds?: number;
  /**
   * Run build code that is not a committed sprite script. Only the probe harness sets this, and only inside a child
   * process it can kill; without it this renderer refuses everything but committed scripts.
   */
  allowHostileProbeCode?: boolean;
}

let kitProgram: Script | undefined;
let preludeProgram: Script | undefined;

/** Renders one build in a fresh node:vm context. */
export async function renderInNodeVm(request: RenderRequest, options: NodeVmRenderOptions = {}): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  if (!options.allowHostileProbeCode && !isCommittedSpriteScript(request.code))
    return { ok: false, error: "node-vm renderer only runs scripts committed in this repository" };
  try {
    const kit = prepareKit();
    kitProgram ??= new Script(kitScript(kit), { filename: "kit.js" });
    preludeProgram ??= new Script(DETERMINISM_PRELUDE, { filename: "prelude.js" });
    const buildProgram = new Script(runScript(kit, prepareBuild(request.code), request.pose), { filename: "build.js" });
    const timeout = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    const start = performance.now();
    const context = createContext({});
    preludeProgram.runInContext(context, { timeout });
    kitProgram.runInContext(context, { timeout });
    const output: unknown = buildProgram.runInContext(context, { timeout });
    if (typeof output !== "object" || output === null || !("stats" in output) || !("pixels" in output))
      return { ok: false, error: "render returned no usable output" };
    const pixels = types.isArrayBuffer(output.pixels) ? new Uint8Array(output.pixels) : undefined;
    return finishRender(request.name, performance.now() - start, output.stats, pixels);
  } catch (error) {
    return { ok: false, error: `node-vm: ${errorSummary(error)}` };
  }
}

/** A Renderer on node:vm. */
export function createNodeVmRenderer(options: NodeVmRenderOptions = {}): Renderer {
  return (request) => renderInNodeVm(request, options);
}
