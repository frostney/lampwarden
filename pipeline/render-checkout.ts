// The Vercel Sandbox renderer for the command-line tools: the runner files are read from this checkout, the snapshot
// comes from VERCEL_SANDBOX_SNAPSHOT_ID (printed by `bun run sandbox:snapshot`), and the snapshot must hold this
// checkout's kit and runner. Needs Vercel auth: docs/tooling.md, "Rendering needs Vercel auth".
import type { RenderRequest, RenderResult } from "./render-types";
import { type RenderSandboxOptions, renderBatchInSandbox, renderSafely } from "./render-vercel-sandbox";
import { readRunnerFiles, runnerBundleSha } from "./runner-bundle";

let checkoutBundleSha: string | undefined;

/** The sandbox options for this checkout; throws a message that says what to set when the snapshot id is missing. */
export function checkoutSandboxOptions(overrides: Partial<RenderSandboxOptions> = {}): RenderSandboxOptions {
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  if (!snapshotId) {
    throw new Error(
      "VERCEL_SANDBOX_SNAPSHOT_ID is not set: run `bun run sandbox:snapshot` (after `vercel link`) and export the id it prints",
    );
  }
  checkoutBundleSha ??= runnerBundleSha(readRunnerFiles(import.meta.dir));
  return { snapshotId, expectedBundleSha: checkoutBundleSha, ...overrides };
}

/** Renders the requests in one sandbox and rejects if the batch cannot run (including a stale snapshot). */
export function renderBatchFromCheckout(
  requests: readonly RenderRequest[],
  overrides: Partial<RenderSandboxOptions> = {},
): Promise<RenderResult[]> {
  return renderBatchInSandbox(requests, checkoutSandboxOptions(overrides));
}

/** The loop's renderer for the command line: one build in its own sandbox. A failure is the render's error, not a throw. */
export function renderFromCheckout(request: RenderRequest): Promise<RenderResult> {
  return renderSafely(request, checkoutSandboxOptions());
}
