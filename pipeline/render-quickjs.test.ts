import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "../tools/logo/png";
import { plainJavaScript } from "./render-inprocess-shared";
import { createQuickJsWorkerRenderer, renderInQuickJsWorker } from "./render-quickjs";
import { renderBuild } from "./renderers";

const SPRITES_DIRECTORY = join(import.meta.dirname, "..", "public", "sprites");
const lampCode = plainJavaScript(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8"));
const committedLamp = decodePng(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"))).data;

describe("the quickjs renderer (a worker thread per render)", () => {
  test("renders a committed sprite pixel for pixel, and is the registered `quickjs` renderer", async () => {
    const result = await renderBuild("quickjs", { code: lampCode, name: "lamp-lit", pose: "" });
    if (!result.ok) throw new Error(result.error);
    expect(decodePng(Buffer.from(result.png)).data).toEqual(committedLamp);
    expect(result.stats.flags).toBe("ok");
    expect(result.stats.name).toBe("lamp-lit");
  });

  test("a build that throws is a render error", async () => {
    const result = await renderInQuickJsWorker({
      code: "function build(k) { throw new Error('boom'); }",
      name: "boom",
      pose: "",
    });
    expect(result).toEqual({ ok: false, error: "quickjs: Error: boom" });
  });

  test("build code with type annotations is a syntax error: builds are plain JavaScript", async () => {
    const result = await renderInQuickJsWorker({ code: "function build(k: Kit) {}", name: "typed", pose: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toStartWith("quickjs: SyntaxError");
  });

  test("an endless loop ends at the interpreter's deadline and the next render is unaffected", async () => {
    const stopped = await createQuickJsWorkerRenderer({ limits: { timeoutMilliseconds: 300 } })({
      code: "function build(k) { while (true) {} }",
      name: "loop",
      pose: "",
    });
    expect(stopped).toEqual({ ok: false, error: "render timed out" });
    const after = await renderInQuickJsWorker({ code: lampCode, name: "lamp-lit", pose: "" });
    expect(after.ok).toBe(true);
  });

  test("the outer deadline terminates a worker that the interpreter's deadline has not stopped", async () => {
    const started = performance.now();
    const stopped = await createQuickJsWorkerRenderer({
      limits: { timeoutMilliseconds: 60_000 },
      outerDeadlineMilliseconds: 400,
    })({ code: "function build(k) { while (true) {} }", name: "loop", pose: "" });
    expect(stopped).toEqual({ ok: false, error: "render timed out" });
    expect(performance.now() - started).toBeLessThan(5_000);
    const after = await renderInQuickJsWorker({ code: lampCode, name: "lamp-lit", pose: "" });
    expect(after.ok).toBe(true);
  });

  test("the build cannot reach the host", async () => {
    const code = `function build(k) {
      var global = (0, function () { return this; })();
      var host = global.constructor.constructor('return typeof pro' + 'cess')();
      throw new Error('host ' + host + ' ' + typeof Date + ' ' + typeof console + ' ' + typeof postMessage);
    }`;
    expect(await renderInQuickJsWorker({ code, name: "probe", pose: "" })).toEqual({
      ok: false,
      error: "quickjs: Error: host undefined undefined undefined undefined",
    });
  });

  test("a typed-array bomb hits the WebAssembly memory cap instead of the host", async () => {
    const code = "function build(k) { var keep = []; for (;;) keep.push(new Float64Array(1 << 22).fill(1)); }";
    expect(await renderInQuickJsWorker({ code, name: "bomb", pose: "" })).toEqual({
      ok: false,
      error: "quickjs: InternalError: out of memory",
    });
  });

  test("renders in parallel, each in a worker of its own", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => renderInQuickJsWorker({ code: lampCode, name: "lamp-lit", pose: "" })),
    );
    for (const result of results) {
      if (!result.ok) throw new Error(result.error);
      expect(decodePng(Buffer.from(result.png)).data).toEqual(committedLamp);
    }
  });

  test("refuses names that are not file-name safe", async () => {
    expect(await renderInQuickJsWorker({ code: lampCode, name: "../x", pose: "" })).toEqual({
      ok: false,
      error: "invalid sprite name: ../x",
    });
  });
});
