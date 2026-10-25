// The batch driver is what a sandbox VM runs (render/batch.ts), so these tests run it on the host with the repository's own
// fixed build scripts, never a model's: one item is good, one throws, one hangs past its deadline, and the batch still
// reports all three.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodePng } from "../tools/logo/png";
import { batchResultsSchema, interpretOutcome, type RenderResult } from "./render-types";
import { renderBatchInSandbox } from "./render-vercel-sandbox";

const ITEM_DEADLINE_MILLISECONDS = 4000;
const workDirectory = mkdtempSync(join(tmpdir(), "lampwarden-batch-test-"));
afterAll(() => rmSync(workDirectory, { recursive: true, force: true }));

const lampBuild = readFileSync(join(import.meta.dir, "kit", "examples", "ex_lamp_lit.ts"), "utf8");
const committedLamp = decodePng(readFileSync(join(import.meta.dir, "..", "public", "sprites", "lamp-lit.png"))).data;

async function runBatch(builds: Array<{ name: string; pose: string; code: string }>): Promise<RenderResult[]> {
  for (const [index, build] of builds.entries()) {
    writeFileSync(join(workDirectory, `${index}.ts`), build.code);
  }
  writeFileSync(
    join(workDirectory, "batch.json"),
    JSON.stringify({
      itemDeadlineMilliseconds: ITEM_DEADLINE_MILLISECONDS,
      items: builds.map(({ name, pose }) => ({ name, pose })),
    }),
  );
  const driver = Bun.spawn([process.execPath, "batch.ts", workDirectory], {
    cwd: join(import.meta.dir, "render"),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await driver.exited).toBe(0);
  const results = batchResultsSchema.parse(JSON.parse(readFileSync(join(workDirectory, "results.json"), "utf8")));
  return results.items.map((outcome) => interpretOutcome(outcome, ITEM_DEADLINE_MILLISECONDS));
}

describe("the batch driver", () => {
  test("reports every item: a good render, a throw and a hang each get their own result", async () => {
    const [good, thrown, hung, goodAgain] = await runBatch([
      { name: "lamp", pose: "", code: lampBuild },
      { name: "thrower", pose: "", code: "function build(k) { throw new Error('boom'); }" },
      { name: "hanger", pose: "", code: "function build(k) { while (true) {} }" },
      { name: "lamp-again", pose: "", code: lampBuild },
    ]);
    expect(good?.ok).toBe(true);
    expect(goodAgain?.ok).toBe(true);
    if (good?.ok) {
      expect(decodePng(Buffer.from(good.png)).data).toEqual(committedLamp);
    }
    expect(thrown).toMatchObject({ ok: false });
    expect(thrown && !thrown.ok ? thrown.error : "").toContain("boom");
    expect(hung).toEqual({ ok: false, error: `render timed out after ${ITEM_DEADLINE_MILLISECONDS} ms` });
  }, 30_000);

  test("hands the pose to the build as POSE", async () => {
    const [still, walking] = await runBatch([
      { name: "still", pose: "", code: lampBuild },
      { name: "walking", pose: "walk2", code: "function build(k) { throw new Error('pose=' + POSE); }" },
    ]);
    expect(still?.ok).toBe(true);
    expect(walking && !walking.ok ? walking.error : "").toContain("pose=walk2");
  }, 30_000);

  test("a build gets no environment but KIT_OUT", async () => {
    process.env.LAMPWARDEN_BATCH_TEST_SECRET = "do-not-leak";
    const [leaky] = await runBatch([
      {
        name: "leaky",
        pose: "",
        code: "function build(k) { throw new Error('secret=' + process.env.LAMPWARDEN_BATCH_TEST_SECRET); }",
      },
    ]);
    delete process.env.LAMPWARDEN_BATCH_TEST_SECRET;
    expect(leaky && !leaky.ok ? leaky.error : "").toContain("secret=undefined");
  }, 30_000);
});

describe("the sandbox renderer's input checks", () => {
  test("a request with an unsafe name or pose is refused before any sandbox starts", async () => {
    const options = { snapshotId: "snap_none", expectedBundleSha: "none" };
    const results = await renderBatchInSandbox(
      [
        { code: "x", name: "../escape", pose: "" },
        { code: "x", name: "fine", pose: "walk 1; rm -rf" },
      ],
      options,
    );
    expect(results).toEqual([
      { ok: false, error: "invalid sprite name: ../escape" },
      { ok: false, error: "invalid pose: walk 1; rm -rf" },
    ]);
  });
});
