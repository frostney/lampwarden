// The limits a QuickJS render runs under. A module of its own, with no imports, so the page can read them without loading the
// interpreter (src/scene/creature-render.ts) while the worker, the worker thread and the Node/Bun renderer share them.

export interface QuickJsLimits {
  /** Cap on QuickJS's own allocator: objects, arrays and strings count against it. Typed-array buffers do NOT (measured). */
  memoryLimitBytes: number;
  /**
   * Hard cap on the module's WebAssembly linear memory. The limit above does not cover `ArrayBuffer` backing stores, so
   * without this a build can allocate typed arrays until the heap reaches the wasm maximum (about 2 GiB). With it, the
   * allocation fails inside QuickJS as an ordinary out-of-memory error. The memory is shared by every run in the
   * module and is not returned afterwards (it stays at its high-water mark, at most this cap).
   */
  wasmMemoryLimitBytes: number;
  /** QuickJS's own stack limit; it must stay below the host's call stack (see docs/LIVE_GENERATION.md). */
  stackLimitBytes: number;
  /** Wall-clock deadline for the kit load plus the build, enforced by the interrupt handler. */
  timeoutMilliseconds: number;
}

/**
 * The limits a render runs under, set from the largest real sprite (docs/LIVE_GENERATION.md, "Limits"): across the 58
 * committed sprites and hero frames the smallest allocator limit that still renders is 512 KiB, the smallest stack 8 KiB,
 * the heap stays at its initial 16 MiB, and the slowest sprite (the trireme) takes 3.5 s and a temple 1.9 s on a Mac. The
 * allocator gets 16 times the floor, the stack 4 times, the WebAssembly cap twice the initial heap, and the server's
 * deadline several times the slowest sprite on a slower CPU. The browser lowers the deadline (creature-render.ts).
 *
 * The stack limit has to stay under the host's own native stack, or the host overflows first and the runtime is left half
 * unwound: 64 KiB did that in a WebKit worker (the unbounded-recursion probe ended as a host failure and not as QuickJS's
 * "stack overflow"), 32 KiB does not, in WebKit or Chromium or on the server's worker thread.
 */
export const RENDER_LIMITS: QuickJsLimits = {
  memoryLimitBytes: 8 * 1024 * 1024,
  wasmMemoryLimitBytes: 32 * 1024 * 1024,
  stackLimitBytes: 32 * 1024,
  timeoutMilliseconds: 20_000,
};
