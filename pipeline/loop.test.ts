import { describe, expect, test } from "bun:test";
import { CLEAN_STATS, fakeModel, fakeRenderer, fenced, GOOD_CODE, spritePng, verdictJson } from "./fakes";
import { type LoopCore, type LoopStage, runLoop } from "./loop";
import type { CallRecord } from "./mubit";
import { runnerBundleSha, snapshotMismatch } from "./runner-bundle";

const brief = { id: "brine-hound", category: "creature", text: "a sleek sea-hound" };

function core(replies: Array<string | null>) {
  const model = fakeModel(replies);
  const renderer = fakeRenderer();
  const calls: CallRecord[] = [];
  const saved: string[] = [];
  const stages: LoopStage[] = [];
  const loop: LoopCore = {
    model: model.client,
    render: renderer.render,
    pose: "",
    generatorPrompt: "GENERATOR PROMPT",
    verifierPrompt: "VERIFIER PROMPT",
    store: {
      logCall: (row) => {
        calls.push(row);
      },
      saveAttemptCode: (name) => {
        saved.push(`${name}.ts`);
      },
      saveAttemptPng: (name) => {
        saved.push(`${name}.png`);
      },
    },
    print: () => {},
    onStage: (stage) => {
      stages.push(stage);
    },
  };
  return { loop, calls, saved, stages, renderer };
}

describe("runLoop with an injected store", () => {
  test("hands every record to the store, reports its stages, and returns the winner without touching a file", async () => {
    const { loop, calls, saved, stages } = core([fenced(GOOD_CODE), verdictJson(8)]);
    const outcome = await runLoop(loop, brief);
    expect(stages).toEqual(["drawing", "rendering", "judging"]);
    expect(calls.map((call) => call.task)).toEqual(["gen", "verify"]);
    expect(saved).toEqual(["brine-hound.ts", "brine-hound.png"]);
    expect(outcome?.winner).toMatchObject({ which: "first", code: GOOD_CODE, stats: CLEAN_STATS });
    expect(outcome?.winner.png).toEqual(spritePng());
    expect(outcome?.row).toMatchObject({ final: "first", passed: true, score: 8, rendered_with: "vercel-sandbox" });
  });

  test("a failing first attempt gets one fix, reported as the fixing stage", async () => {
    const { loop, stages } = core([fenced(GOOD_CODE), verdictJson(3), fenced(GOOD_CODE), verdictJson(8)]);
    const outcome = await runLoop(loop, brief);
    expect(stages).toEqual(["drawing", "rendering", "judging", "fixing", "rendering", "judging"]);
    expect(outcome?.winner.which).toBe("fixed");
  });

  test("a failed generator call returns null", async () => {
    const { loop } = core([null, null]);
    expect(await runLoop(loop, brief)).toBeNull();
  });

  test("a stage callback that throws ends the loop", async () => {
    const { loop, renderer } = core([fenced(GOOD_CODE), verdictJson(8)]);
    loop.onStage = (stage) => {
      if (stage === "rendering") throw new Error("job ended");
    };
    await expect(runLoop(loop, brief)).rejects.toThrow("job ended");
    expect(renderer.requests).toEqual([]);
  });
});

describe("the sandbox snapshot's manifest", () => {
  const manifest = {
    bundleSha: "aaa",
    kitSha: "bbb",
    bunVersion: "1.4.4",
    bunZipSha256: "ccc",
    createdAt: "2026-10-24T12:00:00.000Z",
  };

  test("fits when the bundle digest matches and the Bun is the pinned one", () => {
    expect(snapshotMismatch(manifest, "aaa")).toBeNull();
  });
  test("is refused when the deployed kit differs from the snapshot's", () => {
    expect(snapshotMismatch(manifest, "zzz")).toContain("different kit");
  });
  test("is refused when the snapshot's Bun is not the pinned one", () => {
    expect(snapshotMismatch({ ...manifest, bunVersion: "1.4.3" }, "aaa")).toContain("1.4.3");
  });
  test("a bundle's digest changes with any file's content or path", () => {
    const kit = { path: "kit/kit.ts", content: new Uint8Array([1, 2, 3]) };
    const runner = { path: "render/runner.ts", content: new Uint8Array([4]) };
    const digest = runnerBundleSha([kit, runner]);
    expect(runnerBundleSha([kit, runner])).toBe(digest);
    expect(runnerBundleSha([{ ...kit, content: new Uint8Array([1, 2, 4]) }, runner])).not.toBe(digest);
    expect(runnerBundleSha([{ ...kit, path: "kit/other.ts" }, runner])).not.toBe(digest);
  });
});
