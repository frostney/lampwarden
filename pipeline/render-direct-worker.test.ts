import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "../tools/logo/png";
import { createDirectWorkerRenderer, renderBatchInDirectWorker } from "./render-direct-worker";

const SPRITES_DIRECTORY = join(import.meta.dir, "..", "public", "sprites");
const lampCode = readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8");
const lampPixels = decodePng(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"))).data;

// These run under Bun, which ignores a worker's `resourceLimits`; the heap and stack caps are measured under Node by
// `measure-direct-worker.ts --floor` and `probe-direct-worker.ts` (docs/LIVE_GENERATION.md).
const renderer = createDirectWorkerRenderer({ deadlineMilliseconds: 1500 });
afterAll(() => renderer.close());

describe("direct worker renderer", () => {
  test("renders a committed sprite to the committed pixels", async () => {
    const result = await renderer.render({ code: lampCode, name: "lamp-lit", pose: "" });
    if (!result.ok) throw new Error(result.error);
    expect(decodePng(Buffer.from(result.png)).data).toEqual(lampPixels);
    expect(result.stats.name).toBe("lamp-lit");
  });

  test("starts the worker with an empty environment, whatever the host holds", async () => {
    process.env.LAMPWARDEN_TEST_CANARY = "canary-not-a-secret";
    try {
      const detailed = await renderer.renderDetailed({ code: lampCode, name: "lamp-lit", pose: "" });
      expect(detailed.timings.environmentKeyCount).toBe(0);
    } finally {
      delete process.env.LAMPWARDEN_TEST_CANARY;
    }
  });

  test("a build cannot see process, fetch or WebSocket", async () => {
    const code = "function build(k) { throw new Error([typeof process, typeof fetch, typeof WebSocket].join()); }";
    const result = await renderer.render({ code, name: "probe", pose: "" });
    expect(result).toEqual({ ok: false, error: "direct-worker: Error: undefined,undefined,undefined" });
  });

  test("an endless loop is terminated at the deadline and the next render is untouched", async () => {
    const hung = await renderer.render({ code: "function build(k) { while (true) {} }", name: "probe", pose: "" });
    expect(hung).toEqual({ ok: false, error: "direct-worker: render timed out" });
    const next = await renderer.render({ code: lampCode, name: "lamp-lit", pose: "" });
    expect(next.ok).toBe(true);
  });

  test("a thrown value that is not an Error is not stringified", async () => {
    const code = "function build(k) { throw { toString() { for (;;) {} } }; }";
    const result = await renderer.render({ code, name: "probe", pose: "" });
    expect(result).toEqual({ ok: false, error: "direct-worker: build threw a value that is not an Error" });
  });

  test("a build that swaps the kit's post step for a huge result is refused", async () => {
    const code = "function build(k) { __kit.post = () => ({ rgba: new Uint8Array(1 << 27), stats: {} }); }";
    const result = await renderer.render({ code, name: "probe", pose: "" });
    expect(result).toEqual({ ok: false, error: "direct-worker: Error: render returned no usable pixels" });
  });

  test("refuses names and poses the other renderers refuse", async () => {
    expect(await renderer.render({ code: lampCode, name: "../escape", pose: "" })).toEqual({
      ok: false,
      error: "invalid sprite name: ../escape",
    });
  });

  test("a pooled worker serves one render and is replaced", async () => {
    const pooled = createDirectWorkerRenderer({ poolSize: 1 });
    try {
      await pooled.ready();
      for (let count = 0; count < 2; count++) {
        const result = await pooled.render({ code: lampCode, name: "lamp-lit", pose: "" });
        expect(result.ok).toBe(true);
      }
    } finally {
      await pooled.close();
    }
  });

  test("renders several builds in one worker, each against a fresh kit", async () => {
    const polluting =
      "function build(k) { PALETTE.bronze[0] = '#ff00ff'; lampstand(k, { height: 34, mat: 'bronze', lit: true, base: 'tripod', head: 'lantern' }); }";
    const batch = await renderBatchInDirectWorker([
      { code: polluting, name: "probe", pose: "" },
      { code: lampCode, name: "lamp-lit", pose: "" },
    ]);
    const polluted = batch.results[0];
    const clean = batch.results[1];
    expect(polluted?.ok).toBe(true);
    if (!clean?.ok) throw new Error("second render failed");
    expect(decodePng(Buffer.from(clean.png)).data).toEqual(lampPixels);
    expect(batch.pixels[1]).toEqual(new Uint8Array(lampPixels));
  });
});
