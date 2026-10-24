// The thread that runs one build in QuickJS for render-quickjs.ts: it takes one message ({ code, pose, limits }), loads a
// WebAssembly module of its own, runs `runBuild` and posts the outcome back. The host terminates it at a deadline and
// when it is done, so nothing outlives one render, and a module that a build drove out of memory is never reused.
import { parentPort } from "node:worker_threads";
import { PREPARED_KIT } from "./prepared-kit";
import { type BuildOutcome, createQuickJsModule, errorSummary, runBuild } from "./quickjs-core";
import type { QuickJsLimits } from "./quickjs-limits";

export interface WorkerRequest {
  code: string;
  pose: string;
  limits: QuickJsLimits;
}

export interface WorkerReply {
  outcome: BuildOutcome;
  /** Milliseconds from the message arriving to the build's end, WebAssembly instantiation included. */
  threadMilliseconds: number;
}

async function handle(request: WorkerRequest): Promise<WorkerReply> {
  const start = performance.now();
  try {
    const quickJs = await createQuickJsModule(request.limits.wasmMemoryLimitBytes);
    const outcome = runBuild(quickJs, PREPARED_KIT, request, request.limits);
    return { outcome, threadMilliseconds: performance.now() - start };
  } catch (error) {
    return {
      outcome: { ok: false, error: `quickjs: ${errorSummary(error)}`, timedOut: false },
      threadMilliseconds: performance.now() - start,
    };
  }
}

parentPort?.once("message", (request: WorkerRequest) => {
  void handle(request).then((reply) => parentPort?.postMessage(reply));
});
