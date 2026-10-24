// The renderer `--render vercel` selects: reads the runner files from this checkout and renders in a Vercel Sandbox.
// VERCEL_SANDBOX_SNAPSHOT_ID boots from a snapshot built by sandbox-snapshot.ts (checked against this checkout's kit);
// without it the files are uploaded into the stock image, which ships its own Bun.
import type { RenderRequest, RenderResult } from "./render-types";
import { renderSafely } from "./render-vercel-sandbox";
import { readRunnerFiles, runnerBundleSha } from "./runner-bundle";

export async function renderInVercelSandbox(request: RenderRequest): Promise<RenderResult> {
  const runnerFiles = readRunnerFiles(import.meta.dir);
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  return renderSafely(
    request,
    snapshotId ? { snapshotId, expectedBundleSha: runnerBundleSha(runnerFiles) } : { runnerFiles },
  );
}
