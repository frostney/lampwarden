// The sandbox renderer's cancellation, against a fake @vercel/sandbox: an abort stops the VM and nothing starts after it.
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { PINNED_BUN_VERSION } from "./runner-bundle";

interface FakeSandbox {
  stops: number;
  signals: Array<AbortSignal | undefined>;
}

const created: FakeSandbox[] = [];

const MANIFEST = Buffer.from(
  JSON.stringify({
    bundleSha: "bundle",
    kitSha: "kit",
    bunVersion: PINNED_BUN_VERSION,
    bunZipSha256: "zip",
    createdAt: "2026-10-24T12:00:00.000Z",
  }),
);

mock.module("@vercel/sandbox", () => ({
  Sandbox: {
    create: async (params: { signal?: AbortSignal }) => {
      const sandbox: FakeSandbox = { stops: 0, signals: [params.signal] };
      created.push(sandbox);
      let stopped: () => void = () => {};
      const vmStopped = new Promise<void>((resolve) => {
        stopped = resolve;
      });
      return {
        stop: async () => {
          sandbox.stops++;
          stopped();
        },
        readFileToBuffer: async (_file: unknown, options?: { signal?: AbortSignal }) => {
          sandbox.signals.push(options?.signal);
          return MANIFEST;
        },
        writeFiles: async (_files: unknown, options?: { signal?: AbortSignal }) => {
          sandbox.signals.push(options?.signal);
        },
        // a batch that never finishes by itself: it ends only when the VM is stopped
        runCommand: async (params: { signal?: AbortSignal }) => {
          sandbox.signals.push(params.signal);
          await vmStopped;
          throw new Error("the sandbox was stopped");
        },
      };
    },
  },
}));

const { renderBatchInSandbox, renderBatchSafely, renderSafely } = await import("./render-vercel-sandbox");

const options = { snapshotId: "snap_fake", expectedBundleSha: "bundle" };
const request = { code: "function build(k) {}", name: "thing", pose: "" };

beforeEach(() => {
  created.length = 0;
});

describe("sandbox renderer cancellation", () => {
  test("a signal that has already fired creates no sandbox", async () => {
    await expect(renderBatchInSandbox([request], options, AbortSignal.abort())).rejects.toThrow("render aborted");
    expect(await renderSafely(request, options, AbortSignal.abort())).toEqual({
      ok: false,
      error: "vercel sandbox: render aborted",
    });
    expect(created).toHaveLength(0);
  });

  test("an abort while the sandbox is running stops it and fails every render of the batch", async () => {
    const controller = new AbortController();
    const pending = renderBatchSafely([request, request], options, controller.signal);
    await Bun.sleep(20);
    expect(created).toHaveLength(1);
    const sandbox = created[0];
    expect(sandbox?.stops).toBe(0);
    controller.abort();
    const results = await pending;
    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(sandbox?.stops).toBeGreaterThanOrEqual(1);
  });

  test("the signal reaches every sandbox call, so an in-flight call sees the abort", async () => {
    const controller = new AbortController();
    const pending = renderBatchSafely([request], { ...options, snapshotId: "snap_unverified" }, controller.signal);
    await Bun.sleep(20);
    controller.abort();
    await pending;
    const signals = created[0]?.signals ?? [];
    expect(signals.length).toBe(4); // create, manifest, write, command
    for (const signal of signals) {
      expect(signal?.aborted).toBe(true);
    }
  });
});
