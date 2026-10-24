import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "../tools/logo/png";
import { renderDirectly } from "./render-inprocess-direct";
import { createQuickJsRenderer } from "./render-inprocess-quickjs";
import { isCommittedSpriteScript, plainJavaScript } from "./render-inprocess-shared";
import { renderInNodeVm } from "./render-inprocess-vm";

const SPRITES_DIRECTORY = join(import.meta.dirname, "..", "public", "sprites");
const lampCode = readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8");
const lampScript = plainJavaScript(lampCode); // the committed script has TypeScript annotations; QuickJS runs plain JavaScript
const committedLamp = readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"));
const hostileCode = "function build(k) { throw new Error('not a committed script'); }";

describe("QuickJS renderer", () => {
  const render = createQuickJsRenderer();

  test("renders a committed sprite pixel for pixel", async () => {
    const result = await render({ code: lampScript, name: "lamp-lit", pose: "" });
    if (!result.ok) throw new Error(result.error);
    expect(decodePng(Buffer.from(result.png)).data).toEqual(decodePng(committedLamp).data);
    expect(result.stats.flags).toBe("ok");
  });

  test("a build that throws is a render error", async () => {
    const result = await render({ code: hostileCode, name: "boom", pose: "" });
    expect(result).toEqual({ ok: false, error: "quickjs: Error: not a committed script" });
  });

  test("an endless loop ends at the deadline and the next render is unaffected", async () => {
    const stopped = await createQuickJsRenderer({ timeoutMilliseconds: 300 })({
      code: "function build(k) { while (true) {} }",
      name: "loop",
      pose: "",
    });
    expect(stopped).toEqual({ ok: false, error: "render timed out" });
    const after = await render({ code: lampScript, name: "lamp-lit", pose: "" });
    expect(after.ok).toBe(true);
  });

  test("the build cannot reach the host", async () => {
    const code = `function build(k) {
      var global = (0, function () { return this; })();
      var host = global.constructor.constructor('return typeof pro' + 'cess')();
      throw new Error('host ' + host + ' ' + typeof Date + ' ' + typeof console);
    }`;
    expect(await render({ code, name: "probe", pose: "" })).toEqual({
      ok: false,
      error: "quickjs: Error: host undefined undefined undefined",
    });
  });

  test("a typed-array bomb hits the WebAssembly memory cap instead of the host", async () => {
    const code = "function build(k) { var keep = []; for (;;) keep.push(new Float64Array(1 << 22).fill(1)); }";
    const result = await render({ code, name: "bomb", pose: "" });
    expect(result).toEqual({ ok: false, error: "quickjs: InternalError: out of memory" });
  });

  test("a build that changes the kit does not change the next render", async () => {
    const polluting = `function build(k) { Kit.prototype.solid = function () { return 0; }; S.sphere = S.box; lampstand(k, {}); }`;
    await render({ code: polluting, name: "pollute", pose: "" });
    const result = await render({ code: lampScript, name: "lamp-lit", pose: "" });
    if (!result.ok) throw new Error(result.error);
    expect(decodePng(Buffer.from(result.png)).data).toEqual(decodePng(committedLamp).data);
  });

  test("refuses names that are not file-name safe", async () => {
    expect(await render({ code: lampScript, name: "../x", pose: "" })).toEqual({
      ok: false,
      error: "invalid sprite name: ../x",
    });
  });
});

describe("measurement-only renderers", () => {
  test("direct and node-vm run committed scripts", async () => {
    for (const result of [
      await renderDirectly({ code: lampCode, name: "lamp-lit", pose: "" }),
      await renderInNodeVm({ code: lampCode, name: "lamp-lit", pose: "" }),
    ]) {
      if (!result.ok) throw new Error(result.error);
      expect(decodePng(Buffer.from(result.png)).data).toEqual(decodePng(committedLamp).data);
    }
  });

  test("they refuse any script that is not committed in this repository", async () => {
    expect(isCommittedSpriteScript(lampCode)).toBe(true);
    expect(isCommittedSpriteScript(hostileCode)).toBe(false);
    expect(isCommittedSpriteScript(`${lampCode}\n`)).toBe(false);
    for (const result of [
      await renderDirectly({ code: hostileCode, name: "probe", pose: "" }),
      await renderInNodeVm({ code: hostileCode, name: "probe", pose: "" }),
    ])
      expect(result.ok).toBe(false);
  });
});
