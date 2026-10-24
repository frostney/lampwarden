// MEASUREMENT ONLY: not in `renderers.ts` (`RENDERER_NAMES`), so `pipeline/run.ts` cannot select it, and not the default
// anywhere. docs/LIVE_GENERATION.md, "Direct execution in a worker", has the measurements and the verdict.
//
// The "direct worker" renderer: the kit and the build run as plain JavaScript in a Node `worker_thread`, with no sandbox
// engine in between. The worker is started with an empty environment, a capped heap and stack and no loader; the host
// terminates it on a deadline and encodes the PNG itself. What that does and does not contain is the subject of the docs
// section: it keeps keys, runaway loops and memory out of the host, and it does NOT stop a build from reading files or
// opening sockets, because a worker shares the process's file system and network.
//
// Three ways to use it, all behind the `Renderer` contract:
// - `createDirectWorkerRenderer()`: a fresh worker per render (start and kit load are in every render);
// - `createDirectWorkerRenderer({ poolSize })`: workers started ahead of time, each used for one render and replaced, so
//   no render sees another's state and the start cost moves off the request path;
// - `renderBatchInDirectWorker()`: many renders (a creature's animation frames) in one worker, each against a fresh kit.
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { PixelImage } from "../tools/logo/image";
import { encodePng } from "../tools/logo/png";
import {
  invalidRequestReason,
  type Renderer,
  type RenderRequest,
  type RenderResult,
  renderStatsSchema,
} from "./render-types";

// Bun runs the source in place. For Node the harnesses bundle themselves and point this variable at pipeline/.
const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const SPRITE_SIZE = 128;
const SPRITE_PIXEL_BYTES = SPRITE_SIZE * SPRITE_SIZE * 4;
const MAXIMUM_STATS_CHARACTERS = 4096;

export interface DirectWorkerLimits {
  /** Old generation of the worker's V8 heap; a build that needs more kills the worker, not the host. */
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  /** Stack of the worker thread (Node's default is 4). */
  stackSizeMb: number;
}

export interface DirectWorkerOptions {
  /** The outer deadline for one render, in milliseconds; the worker is terminated when it passes. Default 10,000. */
  deadlineMilliseconds?: number;
  /** Deadline for a worker to start and load the kit. Default 10,000. */
  startDeadlineMilliseconds?: number;
  limits?: Partial<DirectWorkerLimits>;
  /** Workers kept ready ahead of time; each serves one render and is replaced. Default 0: a fresh worker per render. */
  poolSize?: number;
  /**
   * Terminate the worker when memory outside its V8 heap (typed arrays and other buffers, which `resourceLimits` does not
   * count) passes this many megabytes. Measured with `worker.getHeapStatistics()` on Node; under Bun, which cannot answer
   * while the worker is busy, as the growth of the host's resident memory. Default 256; 0 turns the guard off.
   */
  memoryLimitMegabytes?: number;
  /**
   * Refuse `import()` in the build (and in code it makes with `Function` or `eval`) by compiling it with
   * `vm.compileFunction` and no import callback. Default true; false leaves `import("node:fs")` open, as in a plain
   * `new Function`, to measure what it closes.
   */
  denyDynamicImport?: boolean;
  /** The worker file; the default is `direct-worker-thread.ts` next to this file. */
  workerFile?: string;
}

export const DEFAULT_LIMITS: DirectWorkerLimits = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 1,
};
const DEFAULT_DEADLINE_MILLISECONDS = 10_000;
const DEFAULT_MEMORY_LIMIT_MEGABYTES = 256;
const MEMORY_POLL_MILLISECONDS = 10;

// ---- preparing the code: plain JavaScript, no types, no `export` ----

interface PreparedKit {
  /** The kit as statements: no types, no `export`. */
  body: string;
  /** Every name the kit exports; build code may call any of them unqualified. */
  names: string[];
}

let preparedKit: PreparedKit | undefined;

/** Removes TypeScript types from source text. Bun and Node 24 both do this natively; the output keeps `export`. */
function stripTypes(source: string): string {
  if (process.versions.bun) return new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  return nodeModule.stripTypeScriptTypes(source, { mode: "strip" });
}

/** The kit as plain JavaScript, once per process. */
export function prepareKit(): PreparedKit {
  if (preparedKit) return preparedKit;
  const source = readFileSync(join(PIPELINE_DIRECTORY, "kit", "kit.ts"), "utf8");
  const names = [...source.matchAll(/^export (?:const|let|function|class) (\w+)/gm)].map((match) => match[1] ?? "");
  // every value export must have been found, or build code calling it would fail with a ReferenceError
  const valueExports = (source.match(/^export (?!type\b|interface\b)/gm) ?? []).length;
  if (valueExports !== names.length) throw new Error("kit.ts has an export form the direct worker does not handle");
  preparedKit = {
    body: stripTypes(source).replace(/^export\s+/gm, ""),
    names: names.filter((name) => IDENTIFIER.test(name)),
  };
  return preparedKit;
}

/** The build script as plain JavaScript with its leading `export` removed, the way `render/run_local.ts` does. */
export function prepareBuild(code: string): string {
  const withoutExport = code.replace(/^\s*export\s+/m, "");
  return stripTypes(withoutExport).replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
}

// ---- one worker ----

function errorText(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface WorkerReply {
  id: number;
  ok: boolean;
  statsJson?: unknown;
  pixels?: unknown;
  milliseconds?: unknown;
  heapUsedBytes?: unknown;
  externalBytes?: unknown;
  error?: unknown;
}

function isReply(value: unknown): value is WorkerReply {
  return isRecord(value) && typeof value.id === "number" && typeof value.ok === "boolean";
}

interface Pending {
  id: number;
  settle: (reply: WorkerReply | Error) => void;
}

/** A worker that has started and holds the kit. It serves requests one at a time. */
class WorkerSession {
  readonly worker: Worker;
  /** Worker creation to "ready" (thread start, the runtime, the kit's compile), seen from the host. */
  startMilliseconds = 0;
  /** What the worker itself spent compiling the kit. */
  loadMilliseconds = 0;
  /** How many variables the worker's own `process.env` held when it started (the host passes an empty object). */
  environmentKeyCount = -1;
  /** Whether builds are compiled so that `import()` is refused. */
  dynamicImportDenied = false;
  /** Globals the worker deleted before it accepted any build. */
  removedGlobals: string[] = [];
  private pending: Pending | undefined;
  private failure: Error | undefined;
  private nextId = 1;
  private memoryTimer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<number> | undefined;

  private constructor(worker: Worker) {
    this.worker = worker;
  }

  static start(options: DirectWorkerOptions): Promise<WorkerSession> {
    const kit = prepareKit();
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const begun = performance.now();
    const worker = new Worker(options.workerFile ?? join(PIPELINE_DIRECTORY, "direct-worker-thread.ts"), {
      // the worker's `process.env` is this object: empty, so no key from the host's environment is in it
      env: {},
      // no loader, no `--require`, nothing inherited from the host's flags
      execArgv: [],
      argv: [],
      resourceLimits: limits,
      workerData: { kitBody: kit.body, kitNames: kit.names, denyDynamicImport: options.denyDynamicImport !== false },
      // take over the worker's stdout and stderr, so whatever a build prints (if it finds a way) is discarded here
      stdout: true,
      stderr: true,
      stdin: false,
      trackUnmanagedFds: false,
    });
    worker.stdout.on("data", () => {});
    worker.stderr.on("data", () => {});
    const session = new WorkerSession(worker);
    return new Promise((resolve, reject) => {
      const startTimer = setTimeout(() => {
        void session.close();
        reject(new Error("worker did not start"));
      }, options.startDeadlineMilliseconds ?? DEFAULT_DEADLINE_MILLISECONDS);
      worker.on("message", (message: unknown) => {
        if (isRecord(message) && message.ready === true) {
          clearTimeout(startTimer);
          session.startMilliseconds = performance.now() - begun;
          session.loadMilliseconds = typeof message.loadMilliseconds === "number" ? message.loadMilliseconds : 0;
          session.environmentKeyCount =
            typeof message.environmentKeyCount === "number" ? message.environmentKeyCount : -1;
          session.dynamicImportDenied = message.dynamicImportDenied === true;
          session.removedGlobals = Array.isArray(message.removed) ? message.removed.map(String) : [];
          resolve(session);
        } else if (isReply(message)) {
          session.pending?.settle(message);
        }
      });
      worker.on("error", (error: Error) => {
        clearTimeout(startTimer);
        session.fail(error);
        reject(error);
      });
      worker.on("exit", (code: number) => {
        clearTimeout(startTimer);
        const error = new Error(`worker exited with code ${code}`);
        session.fail(error);
        reject(error);
      });
    });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.stopWatching();
    this.pending?.settle(this.failure);
  }

  private stopWatching(): void {
    if (this.memoryTimer) clearInterval(this.memoryTimer);
    this.memoryTimer = undefined;
  }

  /** Sends one build and waits for its reply, the deadline, or the worker's death. */
  render(request: RenderRequest, options: DirectWorkerOptions): Promise<WorkerReply | Error> {
    if (this.failure) return Promise.resolve(this.failure);
    let code: string;
    try {
      code = prepareBuild(request.code);
    } catch (error) {
      return Promise.resolve(new Error(`build does not parse: ${errorText(error)}`));
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      const settle = (reply: WorkerReply | Error) => {
        clearTimeout(deadline);
        this.stopWatching();
        if (this.pending?.id === id) this.pending = undefined;
        resolve(reply);
      };
      const deadline = setTimeout(() => {
        this.failure ??= new Error("render timed out");
        void this.close();
        settle(this.failure);
      }, options.deadlineMilliseconds ?? DEFAULT_DEADLINE_MILLISECONDS);
      this.pending = { id, settle };
      const memoryLimit = options.memoryLimitMegabytes ?? DEFAULT_MEMORY_LIMIT_MEGABYTES;
      if (memoryLimit > 0) {
        const baseline = process.memoryUsage.rss();
        let checking = false;
        this.memoryTimer = setInterval(async () => {
          if (checking) return;
          checking = true;
          const outsideHeapBytes = await this.memoryOutsideHeapBytes(baseline);
          checking = false;
          if (outsideHeapBytes <= memoryLimit * 1048576) return;
          this.failure ??= new Error("render used too much memory");
          void this.close();
          settle(this.failure);
        }, MEMORY_POLL_MILLISECONDS);
      }
      this.worker.postMessage({ id, code, pose: request.pose });
    });
  }

  /** What the worker holds outside its V8 heap, in bytes; 0 when it cannot be read. */
  async memoryOutsideHeapBytes(residentBaselineBytes: number): Promise<number> {
    try {
      // Bun's `getHeapStatistics` does not answer while the worker is busy, so there the host's resident memory is used
      if (process.versions.bun || typeof this.worker.getHeapStatistics !== "function")
        return process.memoryUsage.rss() - residentBaselineBytes;
      const statistics = await this.worker.getHeapStatistics();
      return statistics.external_memory + statistics.malloced_memory;
    } catch {
      return 0; // the worker is already gone
    }
  }

  /** Terminates the worker. Safe to call twice. */
  close(): Promise<number> {
    this.stopWatching();
    this.closing ??= this.worker.terminate();
    return this.closing;
  }
}

// ---- turning a reply into a RenderResult ----

export interface RenderTimings {
  /** Starting the worker and loading the kit, wherever it happened (ahead of time, for a pooled worker). */
  workerStartMilliseconds: number;
  /** Of that, what the worker spent compiling the kit. */
  kitLoadMilliseconds: number;
  /** Variables in the worker's `process.env` when it started; 0 when the empty environment took. */
  environmentKeyCount: number;
  /** How long this render waited for a worker to be ready. */
  waitMilliseconds: number;
  /** The worker's own time for the render (a fresh kit, the build, the rasteriser). */
  workerRenderMilliseconds: number;
  /** Posting the build and getting the pixels back, including the worker's render. */
  roundTripMilliseconds: number;
  /** What the worker's V8 heap held after the render, in megabytes. */
  workerHeapUsedMegabytes: number;
  /** Memory outside the heap (typed arrays, buffers) after the render, in megabytes. */
  workerExternalMegabytes: number;
  /** Encoding the PNG on the host. */
  encodeMilliseconds: number;
  /** From the call to the PNG in hand. */
  totalMilliseconds: number;
}

export interface DetailedRender {
  result: RenderResult;
  timings: RenderTimings;
}

const NO_TIMINGS: RenderTimings = {
  workerStartMilliseconds: 0,
  kitLoadMilliseconds: 0,
  environmentKeyCount: -1,
  waitMilliseconds: 0,
  workerRenderMilliseconds: 0,
  roundTripMilliseconds: 0,
  workerHeapUsedMegabytes: 0,
  workerExternalMegabytes: 0,
  encodeMilliseconds: 0,
  totalMilliseconds: 0,
};

interface FinishedRender {
  result: RenderResult;
  /** The raw 128 px RGBA pixels, when the render succeeded. */
  pixels?: Uint8Array;
  encodeMilliseconds: number;
  workerRenderMilliseconds: number;
  heapUsedMegabytes: number;
  externalMegabytes: number;
}

const toMegabytes = (value: unknown) => (typeof value === "number" ? value / 1048576 : 0);

/** Checks the sizes first, so a build cannot make the host parse or copy something large, then encodes the PNG. */
function finishRender(request: RenderRequest, reply: WorkerReply | Error): FinishedRender {
  const failed = (error: string): FinishedRender => ({
    result: { ok: false, error: `direct-worker: ${error}`.slice(0, 400) },
    encodeMilliseconds: 0,
    workerRenderMilliseconds: 0,
    heapUsedMegabytes: 0,
    externalMegabytes: 0,
  });
  if (reply instanceof Error) return failed(reply.message);
  if (!reply.ok) return failed(typeof reply.error === "string" ? reply.error : "render failed");
  const { statsJson, pixels, milliseconds } = reply;
  if (typeof statsJson !== "string" || statsJson.length > MAXIMUM_STATS_CHARACTERS)
    return failed("render returned no usable stats");
  if (!(pixels instanceof Uint8Array) || pixels.length !== SPRITE_PIXEL_BYTES)
    return failed("render returned no usable pixels");
  const workerRenderMilliseconds = typeof milliseconds === "number" ? milliseconds : 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(statsJson);
  } catch {
    return failed("render returned malformed stats");
  }
  const stats = renderStatsSchema.safeParse({
    ...(isRecord(parsed) ? parsed : {}),
    name: request.name,
    ms: Math.round(workerRenderMilliseconds),
  });
  if (!stats.success) return failed("render returned malformed stats");
  const encodeStart = performance.now();
  const image = new PixelImage(SPRITE_SIZE, SPRITE_SIZE);
  image.data.set(pixels);
  const png = encodePng(image);
  return {
    result: { ok: true, stats: stats.data, png },
    pixels,
    encodeMilliseconds: performance.now() - encodeStart,
    workerRenderMilliseconds,
    heapUsedMegabytes: toMegabytes(reply.heapUsedBytes),
    externalMegabytes: toMegabytes(reply.externalBytes),
  };
}

// ---- the renderer: a fresh worker per render, or a pool ----

export interface DirectWorkerRenderer {
  render: Renderer;
  /** The same render with a breakdown of where the time went. */
  renderDetailed(request: RenderRequest): Promise<DetailedRender>;
  /** Resolves when every pooled worker has started (a no-op without a pool). */
  ready(): Promise<void>;
  /** Terminates every worker, pooled or still shutting down. */
  close(): Promise<void>;
}

export function createDirectWorkerRenderer(options: DirectWorkerOptions = {}): DirectWorkerRenderer {
  const poolSize = options.poolSize ?? 0;
  const warm: Promise<WorkerSession>[] = [];
  const shuttingDown = new Set<Promise<number>>();
  let closed = false;

  const spawn = (): Promise<WorkerSession> => {
    const starting = WorkerSession.start(options);
    starting.catch(() => {}); // a pooled worker that failed to start is reported to whoever takes it
    return starting;
  };
  const topUp = () => {
    while (!closed && warm.length < poolSize) warm.push(spawn());
  };
  const retire = (session: WorkerSession) => {
    const closing = session.close();
    shuttingDown.add(closing);
    closing.finally(() => shuttingDown.delete(closing)).catch(() => {});
  };
  topUp();

  const renderDetailed = async (request: RenderRequest): Promise<DetailedRender> => {
    const invalidReason = invalidRequestReason(request);
    if (invalidReason) return { result: { ok: false, error: invalidReason }, timings: NO_TIMINGS };
    const begun = performance.now();
    let session: WorkerSession;
    try {
      const taken = warm.shift();
      session = await (taken ?? spawn());
      topUp(); // replace the worker just taken, after this render's own worker is in hand
    } catch (error) {
      topUp();
      return { result: { ok: false, error: `direct-worker: ${errorText(error)}` }, timings: NO_TIMINGS };
    }
    const waited = performance.now();
    const sent = performance.now();
    const reply = await session.render(request, options);
    const roundTripMilliseconds = performance.now() - sent;
    retire(session);
    const finished = finishRender(request, reply);
    return {
      result: finished.result,
      timings: {
        workerStartMilliseconds: session.startMilliseconds,
        kitLoadMilliseconds: session.loadMilliseconds,
        environmentKeyCount: session.environmentKeyCount,
        waitMilliseconds: waited - begun,
        workerRenderMilliseconds: finished.workerRenderMilliseconds,
        roundTripMilliseconds,
        workerHeapUsedMegabytes: finished.heapUsedMegabytes,
        workerExternalMegabytes: finished.externalMegabytes,
        encodeMilliseconds: finished.encodeMilliseconds,
        totalMilliseconds: performance.now() - begun,
      },
    };
  };

  return {
    render: async (request) => (await renderDetailed(request)).result,
    renderDetailed,
    ready: async () => {
      await Promise.allSettled(warm);
    },
    close: async () => {
      closed = true;
      const sessions = await Promise.allSettled(warm.splice(0));
      for (const settled of sessions) if (settled.status === "fulfilled") retire(settled.value);
      await Promise.allSettled([...shuttingDown]);
    },
  };
}

/** A fresh worker per render, default limits: the shape every other renderer has. Not registered in `renderers.ts`. */
export const renderInDirectWorker: Renderer = (request) => createDirectWorkerRenderer().render(request);

// ---- many renders in one worker ----

export interface BatchRender {
  results: RenderResult[];
  /** The raw RGBA pixels of each successful render (what a server packing an atlas needs, without a PNG decode). */
  pixels: Array<Uint8Array | undefined>;
  workerStartMilliseconds: number;
  renderMilliseconds: number;
  totalMilliseconds: number;
}

/**
 * Renders the requests one after another in a single worker, each against a fresh instance of the kit. A creature's
 * animation set is the use: the frames come from one model-written script, so they share a worker. A render that times
 * out or kills the worker fails and so does every request after it.
 */
export async function renderBatchInDirectWorker(
  requests: RenderRequest[],
  options: DirectWorkerOptions = {},
): Promise<BatchRender> {
  const begun = performance.now();
  let session: WorkerSession;
  try {
    session = await WorkerSession.start(options);
  } catch (error) {
    const failure: RenderResult = { ok: false, error: `direct-worker: ${errorText(error)}` };
    return {
      results: requests.map(() => failure),
      pixels: requests.map(() => undefined),
      workerStartMilliseconds: 0,
      renderMilliseconds: 0,
      totalMilliseconds: performance.now() - begun,
    };
  }
  const started = performance.now();
  const results: RenderResult[] = [];
  const pixels: Array<Uint8Array | undefined> = [];
  try {
    for (const request of requests) {
      const invalidReason = invalidRequestReason(request);
      if (invalidReason) {
        results.push({ ok: false, error: invalidReason });
        pixels.push(undefined);
        continue;
      }
      const finished = finishRender(request, await session.render(request, options));
      results.push(finished.result);
      pixels.push(finished.pixels);
    }
  } finally {
    await session.close();
  }
  return {
    results,
    pixels,
    workerStartMilliseconds: session.startMilliseconds,
    renderMilliseconds: performance.now() - started,
    totalMilliseconds: performance.now() - begun,
  };
}
