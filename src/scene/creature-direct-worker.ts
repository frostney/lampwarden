// EXPERIMENT (docs/LIVE_GENERATION.md, "Direct execution in the browser (option E)"). A Web Worker that draws a creature by
// running its build code as plain JavaScript, with no interpreter in between: the kit is turned into a function and the
// build into another, the way pipeline/render/run_local.ts does it. This is NOT sandboxed the way the QuickJS worker
// (creature-worker.ts) is: the code runs in the worker's own realm, on the browser's own engine.
//
// What contains it is what a worker is and what is taken away before the code runs:
//   - a worker has no DOM, no page, no cookies of its own and no access to the page's storage; the page makes a fresh one per
//     draw and terminates it at a deadline, so a loop or a hang ends there and nothing is kept;
//   - before anything else runs, every name in the worker's global scope that is not a language built-in is shadowed with
//     `undefined` (on the scope and on the prototypes it inherits from): `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`,
//     `indexedDB`, `caches`, `postMessage`, `Worker`, `navigator`, timers, `Date`, `performance` and the rest. The scope
//     object is the same one a constructor chain (`(function(){}).constructor("return this")()`) reaches, so that route finds
//     the stripped scope too. The reply goes through a reference to `postMessage` taken before the strip;
//   - `Math.random` is seeded and there is no `Date`, so a draw is deterministic (as in the QuickJS worker).
// What it does NOT contain, and which the page has to: `import()` is syntax, not a global, and cannot be shadowed, so the
// worker's response must carry a Content-Security-Policy that denies it (next.config.ts); the memory a build allocates is
// bounded only by the engine's own limits.
import { DETERMINISM_PRELUDE, kitScript, prepareBuild } from "../../pipeline/build-script";
import { PREPARED_KIT } from "../../pipeline/prepared-kit";
import type { DrawReply } from "./creature-worker";

export interface DirectDrawRequest {
  code: string;
}

const SPRITE_PIXEL_BYTES = 128 * 128 * 4;

// Everything the reply and the run need, taken before the scope is stripped. The code run later cannot reach these bindings.
const rawPost = self.postMessage.bind(self);
const listen = self.addEventListener.bind(self);
const scope: object = self;
const now = performance.now.bind(performance);
const makeFunction = Function;
const FreshBytes = Uint8Array;
const isBuffer = ArrayBuffer.isView;
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const objectPrototype = Object.prototype;
const eventTargetPrototype = EventTarget.prototype;

// The ECMAScript global names. Everything else on the scope is the host's (the web platform's) and is shadowed.
const LANGUAGE_GLOBALS = new Set([
  "Infinity",
  "NaN",
  "undefined",
  "globalThis",
  "Object",
  "Function",
  "Array",
  "Number",
  "Boolean",
  "String",
  "Symbol",
  "BigInt",
  "Math",
  "JSON",
  "Reflect",
  "Proxy",
  "Promise",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
  "eval",
  "parseFloat",
  "parseInt",
  "isFinite",
  "isNaN",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape",
]);

/** The scope and the prototypes only it has: `addEventListener` and `Object.prototype` stay, as the language needs them. */
const isHostHolder = (object: object): boolean => object !== objectPrototype && object !== eventTargetPrototype;

/**
 * Shadows every host name with `undefined`, on the scope and (where it is configurable) deleted from the prototypes it
 * inherits from, so neither `self.fetch` nor `Object.getPrototypeOf(self).fetch` finds it. A name the engine will not let
 * go of is left; the escape probes list what the build can still see (e2e/check-creature-direct.mjs).
 */
function stripScope(): void {
  const names = new Set<string>();
  const holders: object[] = [];
  for (let holder: object | null = scope; holder !== null && isHostHolder(holder); holder = getPrototype(holder)) {
    holders.push(holder);
    for (const key of ownKeys(holder)) if (typeof key === "string" && key !== "constructor") names.add(key);
  }
  for (const name of names) {
    if (LANGUAGE_GLOBALS.has(name)) continue;
    for (const holder of holders) if (holder !== scope) deleteProperty(holder, name);
    try {
      defineProperty(scope, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {
      // not redefinable on this engine
    }
  }
}

interface KitExports {
  Kit: new () => { render(): unknown };
  post(rendered: unknown): unknown;
  [name: string]: unknown;
}

function isKitExports(value: unknown): value is KitExports {
  return typeof value === "object" && value !== null && "Kit" in value && "post" in value;
}

const hasLength = (value: unknown): value is { length: number; [index: number]: number } =>
  typeof value === "object" && value !== null && "length" in value && typeof value.length === "number";

/** `Name: message` of a thrown Error, or a fixed phrase: nothing the build can make run is called on a thrown value. */
function describe(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error && "message" in error) {
    const { name, message } = error;
    if (typeof name === "string" && typeof message === "string") return `${name}: ${message}`.slice(0, 300);
  }
  return "the build threw something that is not an error";
}

function draw(request: DirectDrawRequest): { reply: DrawReply; transfer: Transferable[] } {
  const loadStart = now();
  try {
    const kit: unknown = new makeFunction(`${kitScript(PREPARED_KIT)}\nreturn __kit;`)();
    if (!isKitExports(kit)) return { reply: { ok: false, reason: "the kit did not load" }, transfer: [] };
    new makeFunction(DETERMINISM_PRELUDE)();
    const runStart = now();
    // every kit export is a parameter of the build's wrapper, so build code calls `hero(k, ...)` unqualified
    const names = PREPARED_KIT.names;
    const factory = new makeFunction(...names, "POSE", `${prepareBuild(request.code)}\nreturn build;`);
    const build: unknown = factory(...names.map((name) => kit[name]), "");
    if (typeof build !== "function")
      return { reply: { ok: false, reason: "no function build(k) found" }, transfer: [] };
    const sprite = new kit.Kit();
    build(sprite);
    const rendered = kit.post(sprite.render());
    const rgba = typeof rendered === "object" && rendered !== null && "rgba" in rendered ? rendered.rgba : undefined;
    // the size is checked before anything is copied, and what is sent is a fresh array of exactly one sprite
    if (!isBuffer(rgba) || !hasLength(rgba) || rgba.length !== SPRITE_PIXEL_BYTES)
      return { reply: { ok: false, reason: "no usable pixels" }, transfer: [] };
    const pixels = new FreshBytes(SPRITE_PIXEL_BYTES);
    for (let index = 0; index < SPRITE_PIXEL_BYTES; index++) pixels[index] = rgba[index] ?? 0;
    return {
      reply: {
        ok: true,
        pixels: pixels.buffer,
        loadMilliseconds: runStart - loadStart,
        runMilliseconds: now() - runStart,
      },
      transfer: [pixels.buffer],
    };
  } catch (error) {
    return { reply: { ok: false, reason: describe(error) }, transfer: [] };
  }
}

const isDirectDrawRequest = (value: unknown): value is DirectDrawRequest =>
  typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";

stripScope();

listen("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isDirectDrawRequest(data)) return rawPost({ ok: false, reason: "bad request" } satisfies DrawReply);
  const { reply, transfer } = draw(data);
  rawPost(reply, { transfer });
});
