// The `quickjs` renderer: runs a build in QuickJS compiled to WebAssembly, in a worker thread of its own for every render,
// so the interpreter never holds the thread that serves requests. Inside the thread the interrupt handler stops an endless
// loop at `timeoutMilliseconds`; outside, this file terminates the thread at a later deadline in case the interpreter
// cannot be interrupted (a hang in the WebAssembly module itself). The thread has no more than a message to read, no
// host function, and a heap limit of its own; the result is the pixels, which are encoded to PNG here.
//
// The same core (quickjs-core.ts) runs in the browser, where the player's device draws the sprite from the code.
import { Worker } from "node:worker_threads";
import { errorSummary } from "./quickjs-core";
import { type QuickJsLimits, RENDER_LIMITS } from "./quickjs-limits";
import type { WorkerReply, WorkerRequest } from "./quickjs-worker-thread";
import { finishRender } from "./render-finish";
import { invalidRequestReason, type Renderer, type RenderRequest, type RenderResult } from "./render-types";

/** Time allowed on top of the interpreter's deadline for the thread to start, compile the module and answer. */
const OUTER_DEADLINE_MARGIN_MILLISECONDS = 5_000;
/** The thread's JavaScript heap; the WebAssembly memory is capped separately by `wasmMemoryLimitBytes`. */
const THREAD_HEAP_MEGABYTES = 128;

export interface QuickJsWorkerOptions {
  limits?: Partial<QuickJsLimits>;
  /** Terminate the thread this long after the render started, whatever it is doing. */
  outerDeadlineMilliseconds?: number;
}

export interface QuickJsWorkerRender {
  result: RenderResult;
  /** Wall clock from asking for the render to having the answer: thread start, WebAssembly compile, build, PNG. */
  milliseconds: number;
}

function isWorkerReply(value: unknown): value is WorkerReply {
  return typeof value === "object" && value !== null && "outcome" in value && "threadMilliseconds" in value;
}

/** Renders one build in a fresh worker thread, and tells how long that took. Never throws. */
export async function renderInQuickJsWorkerTimed(
  request: RenderRequest,
  options: QuickJsWorkerOptions = {},
): Promise<QuickJsWorkerRender> {
  const start = performance.now();
  const finish = (result: RenderResult): QuickJsWorkerRender => ({ result, milliseconds: performance.now() - start });
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return finish({ ok: false, error: invalidReason });
  const limits: QuickJsLimits = { ...RENDER_LIMITS, ...options.limits };
  const outerDeadline =
    options.outerDeadlineMilliseconds ?? limits.timeoutMilliseconds + OUTER_DEADLINE_MARGIN_MILLISECONDS;

  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL("./quickjs-worker-thread.ts", import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: THREAD_HEAP_MEGABYTES, maxYoungGenerationSizeMb: 16 },
    });
    const thread = worker;
    const reply = await new Promise<WorkerReply | string>((resolve) => {
      timer = setTimeout(() => resolve("render timed out"), outerDeadline);
      thread.once("message", (message: unknown) =>
        resolve(isWorkerReply(message) ? message : "quickjs: the worker answered with something unexpected"),
      );
      // an error that stops the thread (it ran out of heap, say) is reported as a short fixed reason, never its message
      thread.once("error", () => resolve("quickjs: the worker stopped"));
      thread.once("exit", () => resolve("quickjs: the worker stopped"));
      const message: WorkerRequest = { code: request.code, pose: request.pose, limits };
      thread.postMessage(message);
    });
    if (typeof reply === "string") return finish({ ok: false, error: reply });
    if (!reply.outcome.ok) return finish({ ok: false, error: reply.outcome.error });
    return finish(finishRender(request.name, reply.threadMilliseconds, reply.outcome.statsJson, reply.outcome.pixels));
  } catch (error) {
    return finish({ ok: false, error: `quickjs: ${errorSummary(error)}` });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
  }
}

/** The QuickJS worker renderer with the given limits. */
export function createQuickJsWorkerRenderer(options: QuickJsWorkerOptions = {}): Renderer {
  return async (request) => (await renderInQuickJsWorkerTimed(request, options)).result;
}

/** The renderer `renderers.ts` registers as `quickjs`. */
export const renderInQuickJsWorker: Renderer = createQuickJsWorkerRenderer();
