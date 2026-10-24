// The worker side of the direct-worker renderer (render-direct-worker.ts). MEASUREMENT ONLY: not reachable from
// `renderers.ts`; docs/LIVE_GENERATION.md, "Direct execution in a worker", has the measurements and the verdict.
//
// This file imports nothing but `node:worker_threads`, so Node can run it as it is (type stripping, no loader) and a
// bundler needs no resolution for it. The host passes the kit as plain JavaScript in `workerData`, the build code in
// every `render` message, and gets pixels and a stats string back. The worker runs the build as ordinary JavaScript,
// with `new Function`, exactly the way `render/run_local.ts` does.
//
// What it does about hostile code, honestly: before the first build runs it deletes the globals a build has no use for
// (network, timers, `process`, `require`, `console`). That removes the obvious routes only. A build can still get
// `Function` from any function's `constructor`, it can `import("node:fs")`, and a worker shares the process's file
// system, network and native addons. The protection that counts is outside this file: the worker's environment is empty,
// the heap and stack are capped, and the host terminates it on a deadline.
import { getHeapStatistics } from "node:v8";
import { compileFunction } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

const SPRITE_SIZE = 128;
const SPRITE_PIXEL_BYTES = SPRITE_SIZE * SPRITE_SIZE * 4;
/** The stats line is a few hundred bytes; anything much longer is a build trying to make the host copy a lot. */
const MAXIMUM_STATS_CHARACTERS = 4096;

/** Globals a sprite build has no use for. Deleting them removes the obvious routes, not the determined ones. */
const REMOVED_GLOBALS = [
  "process",
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "BroadcastChannel",
  "MessageChannel",
  "MessagePort",
  "MessageEvent",
  "Worker",
  "navigator",
  "performance",
  "console",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "queueMicrotask",
  "Bun",
  "Deno",
];

interface KitExports {
  Kit: new () => { render(): unknown; fit: unknown; snapped: unknown; dropped: unknown };
  post(rendered: unknown): { rgba: unknown; stats: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKitExports(value: unknown): value is KitExports {
  return isRecord(value) && typeof value.Kit === "function" && typeof value.post === "function";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readSetup(): { kitBody: string; kitNames: string[]; denyDynamicImport: boolean } {
  if (!isRecord(workerData) || typeof workerData.kitBody !== "string" || !isStringArray(workerData.kitNames))
    throw new Error("direct worker started without a kit");
  return {
    kitBody: workerData.kitBody,
    kitNames: workerData.kitNames,
    denyDynamicImport: workerData.denyDynamicImport !== false,
  };
}

/**
 * Compiles a function body in this realm. With `denyDynamicImport` it goes through `vm.compileFunction` without an
 * `importModuleDynamically` callback, so an `import()` in the build, or in code the build makes with `Function` or
 * `eval`, is refused (Node reports ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). That closes `import("node:fs")` and its
 * kin, which stay open under `new Function`. It is not a sandbox: the function runs in the worker's own realm.
 */
function compile(parameters: string[], body: string): unknown {
  if (setup.denyDynamicImport && typeof compileFunction === "function") return compileFunction(body, parameters);
  return new Function(...parameters, body);
}

function readRequest(message: unknown): { id: number; code: string; pose: string } | undefined {
  if (!isRecord(message)) return undefined;
  const { id, code, pose } = message;
  if (typeof id !== "number" || typeof code !== "string" || typeof pose !== "string") return undefined;
  return { id, code, pose };
}

if (!parentPort) throw new Error("direct-worker-thread.ts is a worker; it is not meant to be run directly");
const port = parentPort;
const setup = readSetup();
// what the runner needs after the globals below are gone and a build has had its way with the rest
const now = performance.now.bind(performance);
const Bytes = Uint8Array;
const stringify = JSON.stringify;
const loadStart = now();
const kitFactory = new Function(`${setup.kitBody}\nreturn { ${setup.kitNames.join(", ")} };`);

// the worker's own `process.env`, counted before `process` goes: the host started it with an empty object
const environmentKeyCount = Object.keys(process.env).length;
const removed: string[] = [];
for (const name of REMOVED_GLOBALS)
  if (Reflect.deleteProperty(globalThis, name) && !(name in globalThis)) removed.push(name);
port.postMessage({
  ready: true,
  loadMilliseconds: now() - loadStart,
  removed,
  environmentKeyCount,
  dynamicImportDenied: setup.denyDynamicImport && typeof compileFunction === "function",
});

/** Runs one build against a fresh instance of the kit and returns what the host needs to encode the PNG. */
function renderBuild(
  code: string,
  pose: string,
): { statsJson: string; pixels: Uint8Array<ArrayBuffer>; milliseconds: number } {
  const start = now();
  const fresh: unknown = kitFactory();
  if (!isKitExports(fresh)) throw new Error("kit did not load");
  // A fresh kit per render, so a build that edits the kit's tables cannot change the next render in this worker. The
  // kit is also reachable as `__kit` (as in the in-process spike), and the result is read back through it, which is
  // what lets the probes try to swap `post` and hand back something huge.
  Reflect.set(globalThis, "__kit", fresh);
  const buildFactory: unknown = compile([...setup.kitNames, "POSE"], `${code}\nreturn build;`);
  if (typeof buildFactory !== "function") throw new Error("no function build(k) found");
  const build: unknown = buildFactory(...setup.kitNames.map((name) => Reflect.get(fresh, name)), pose);
  if (typeof build !== "function") throw new Error("no function build(k) found");
  const sprite = new fresh.Kit();
  build(sprite);
  const current: unknown = Reflect.get(globalThis, "__kit");
  if (!isKitExports(current)) throw new Error("kit was replaced");
  const rendered = current.post(sprite.render());
  const { rgba, stats } = rendered;
  if (!(rgba instanceof Bytes) || rgba.length !== SPRITE_PIXEL_BYTES)
    throw new Error("render returned no usable pixels");
  const statsJson = stringify({
    fit: sprite.fit,
    snapped: sprite.snapped,
    dropped: sprite.dropped,
    ...(isRecord(stats) ? stats : {}),
  });
  if (typeof statsJson !== "string" || statsJson.length > MAXIMUM_STATS_CHARACTERS)
    throw new Error("render returned no usable stats");
  const pixels = new Bytes(new ArrayBuffer(SPRITE_PIXEL_BYTES));
  pixels.set(rgba);
  return { statsJson, pixels, milliseconds: now() - start };
}

/** A one-line reason that never stringifies a thrown value that is not an Error (its conversions could run forever). */
function describe(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string")
    return `${error.name}: ${error.message}`.slice(0, 300);
  return "build threw a value that is not an Error";
}

port.on("message", (message: unknown) => {
  const request = readRequest(message);
  if (!request) return;
  try {
    const { statsJson, pixels, milliseconds } = renderBuild(request.code, request.pose);
    const memory = getHeapStatistics();
    port.postMessage(
      {
        id: request.id,
        ok: true,
        statsJson,
        pixels,
        milliseconds,
        heapUsedBytes: memory.used_heap_size,
        externalBytes: memory.external_memory,
      },
      [pixels.buffer],
    );
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: describe(error) });
  }
});
