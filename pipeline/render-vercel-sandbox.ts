// The Vercel Sandbox renderer: the only way to render, and the source of truth for every pixel. Model-written build
// code runs here and nowhere else.
//
// A render boots a Firecracker microVM from a snapshot that holds the pinned Bun, the kit and the runner
// (sandbox-snapshot.ts builds it) with no network (networkPolicy "deny-all", which also blocks DNS) and no persistence,
// writes the builds into it, runs `bun batch.ts` there (render/batch.ts: one `bun runner.ts` process per item, each
// with its own deadline), reads one results file back and stops the VM. A batch renders many items in one VM, and one
// item's failure (a throw, a hang, a crash) is that item's error, never the batch's. A single render is a batch of one.
//
// The snapshot must hold the same kit and runner as the code that asks: its manifest (SNAPSHOT.json) is read back
// before anything is rendered, and a different bundle digest or Bun version is a `SnapshotMismatchError`.
//
// This module reads no file and locates nothing with `import.meta`, so a Vercel function can import it: the caller
// passes the snapshot id and the expected bundle digest (render-checkout.ts reads them for a checkout).
//
// Authentication is the SDK's: on Vercel, the deployment's OIDC token; locally VERCEL_OIDC_TOKEN from the environment
// (`vercel env pull` writes it to .env.local), or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID, or, with neither,
// an OIDC token the SDK refreshes from the Vercel CLI login and the linked project (.vercel/project.json from `vercel
// link`). None of it enters the VM, is printed or logged. Run the pipeline with `bun --no-env-file` so bun does not
// load .env files into the process.
import { type NetworkPolicy, Sandbox } from "@vercel/sandbox";
import type { BatchManifest } from "./render/batch";
import {
  batchResultsSchema,
  interpretOutcome,
  invalidRequestReason,
  type RenderRequest,
  type RenderResult,
  withDeadline,
} from "./render-types";
import {
  SANDBOX_BUN_PATH,
  SANDBOX_PIPELINE_DIRECTORY,
  SNAPSHOT_MANIFEST_PATH,
  snapshotManifestSchema,
  snapshotMismatch,
} from "./runner-bundle";

const SANDBOX_RENDER_DIRECTORY = `${SANDBOX_PIPELINE_DIRECTORY}/render`;
const SANDBOX_JOB_DIRECTORY = "/vercel/sandbox/job";
const DEFAULT_ITEM_DEADLINE_MILLISECONDS = 30_000;
const DEFAULT_VCPUS = 1;
const BOOT_AND_TRANSFER_MARGIN_MILLISECONDS = 60_000;
const NO_NETWORK: NetworkPolicy = "deny-all";

export interface RenderSandboxOptions {
  /** The snapshot to boot: it holds the pinned Bun, the kit and the runner. */
  snapshotId: string;
  /** The digest of the bundle the caller runs from (`runnerBundleSha`); the snapshot's manifest must match it. */
  expectedBundleSha: string;
  /** 1, 2, 4 or 8: a batch renders one item per vCPU at a time. Default 1. */
  vcpus?: number;
  /** Each item's own deadline inside the VM. Default 30 s. */
  itemDeadlineMilliseconds?: number;
}

/** The snapshot does not hold this checkout's kit and runner (or the pinned Bun). The message says how to fix it. */
export class SnapshotMismatchError extends Error {
  override name = "SnapshotMismatchError";
}

// snapshots already checked against a bundle digest by this process: the manifest is read once per snapshot and digest
const verifiedSnapshots = new Set<string>();

/** Throws a `SnapshotMismatchError` when the snapshot's manifest is missing, unreadable, or does not fit the bundle. */
async function verifySnapshot(sandbox: Sandbox, snapshotId: string, expectedBundleSha: string): Promise<void> {
  const key = `${snapshotId}:${expectedBundleSha}`;
  if (verifiedSnapshots.has(key)) return;
  const manifestBytes = await sandbox.readFileToBuffer({ path: SNAPSHOT_MANIFEST_PATH });
  if (manifestBytes === null) throw new SnapshotMismatchError("the sandbox snapshot has no manifest");
  const manifest = snapshotManifestSchema.safeParse(JSON.parse(manifestBytes.toString("utf8")));
  if (!manifest.success) throw new SnapshotMismatchError("the sandbox snapshot has an unreadable manifest");
  const mismatch = snapshotMismatch(manifest.data, expectedBundleSha);
  if (mismatch) throw new SnapshotMismatchError(mismatch);
  verifiedSnapshots.add(key);
}

/** The time one batch may take: its items spread over the VM's CPUs, each at its deadline at worst, plus boot. */
function batchDeadlineMilliseconds(itemCount: number, vcpus: number, itemDeadlineMilliseconds: number): number {
  return Math.ceil(itemCount / vcpus) * itemDeadlineMilliseconds + BOOT_AND_TRANSFER_MARGIN_MILLISECONDS;
}

/**
 * Renders every request in one sandbox, in the order given. Resolves with one result per request: an invalid request or
 * a failed build is that item's error. Rejects when the batch as a whole cannot run: the sandbox does not start, the
 * snapshot does not fit (`SnapshotMismatchError`), the batch driver fails or its results are unreadable.
 */
export async function renderBatchInSandbox(
  requests: readonly RenderRequest[],
  options: RenderSandboxOptions,
): Promise<RenderResult[]> {
  const results: RenderResult[] = requests.map(() => ({ ok: false, error: "not rendered" }));
  const runnable: Array<{ index: number; request: RenderRequest }> = [];
  requests.forEach((request, index) => {
    const invalidReason = invalidRequestReason(request);
    if (invalidReason) results[index] = { ok: false, error: invalidReason };
    else runnable.push({ index, request });
  });
  if (runnable.length === 0) return results;

  const vcpus = options.vcpus ?? DEFAULT_VCPUS;
  const itemDeadline = options.itemDeadlineMilliseconds ?? DEFAULT_ITEM_DEADLINE_MILLISECONDS;
  const batchDeadline = batchDeadlineMilliseconds(runnable.length, vcpus, itemDeadline);
  const sandbox = await Sandbox.create({
    resources: { vcpus },
    timeout: batchDeadline + BOOT_AND_TRANSFER_MARGIN_MILLISECONDS,
    persistent: false,
    networkPolicy: NO_NETWORK,
    source: { type: "snapshot", snapshotId: options.snapshotId },
  });
  try {
    await verifySnapshot(sandbox, options.snapshotId, options.expectedBundleSha);
    const manifest: BatchManifest = {
      itemDeadlineMilliseconds: itemDeadline,
      items: runnable.map(({ request }) => ({ name: request.name, pose: request.pose })),
    };
    await sandbox.writeFiles([
      { path: `${SANDBOX_JOB_DIRECTORY}/batch.json`, content: Buffer.from(JSON.stringify(manifest)) },
      ...runnable.map(({ request }, position) => ({
        path: `${SANDBOX_JOB_DIRECTORY}/${position}.ts`,
        content: Buffer.from(request.code),
      })),
    ]);
    const command = await sandbox.runCommand({
      cmd: SANDBOX_BUN_PATH,
      args: ["batch.ts", SANDBOX_JOB_DIRECTORY],
      cwd: SANDBOX_RENDER_DIRECTORY,
      timeoutMs: batchDeadline,
    });
    if (command.exitCode !== 0) throw new Error(`the batch driver exited ${command.exitCode}`);
    const resultsFile = await sandbox.readFileToBuffer({ path: `${SANDBOX_JOB_DIRECTORY}/results.json` });
    if (resultsFile === null) throw new Error("the batch wrote no results");
    const outcomes = batchResultsSchema.parse(JSON.parse(resultsFile.toString("utf8"))).items;
    if (outcomes.length !== runnable.length) throw new Error("the batch returned the wrong number of results");
    runnable.forEach(({ index }, position) => {
      const outcome = outcomes[position];
      if (outcome) results[index] = interpretOutcome(outcome, itemDeadline);
    });
    return results;
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

/** `renderBatchInSandbox` that never rejects: if the batch as a whole fails, every item carries that reason. */
export async function renderBatchSafely(
  requests: readonly RenderRequest[],
  options: RenderSandboxOptions,
): Promise<RenderResult[]> {
  const itemDeadline = options.itemDeadlineMilliseconds ?? DEFAULT_ITEM_DEADLINE_MILLISECONDS;
  const deadline = batchDeadlineMilliseconds(requests.length, options.vcpus ?? DEFAULT_VCPUS, itemDeadline);
  try {
    return await withDeadline(renderBatchInSandbox(requests, options), deadline + 30_000, "timed out");
  } catch (error) {
    const reason = `vercel sandbox: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400);
    return requests.map(() => ({ ok: false, error: reason }));
  }
}

/** One build, one VM (a batch of one): the render the loop and the creature job use. Never rejects. */
export async function renderSafely(request: RenderRequest, options: RenderSandboxOptions): Promise<RenderResult> {
  const [result] = await renderBatchSafely([request], options);
  return result ?? { ok: false, error: "vercel sandbox: no result" };
}
