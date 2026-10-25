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
// (`vercel env pull` writes it to .env.local) or, without it, an OIDC token the SDK refreshes from the Vercel CLI login
// and the linked project (.vercel/project.json from `vercel link`); SDK 3.9.0 reads no VERCEL_TOKEN from the environment.
// None of it enters the VM, is printed or logged. The pipeline scripts run as `varlock run ... -- bun --no-env-file`
// (package.json): bun loads no .env file, and varlock hands the script only the variables it needs from .env.schema.

import { type NetworkPolicy, Sandbox } from "@vercel/sandbox";

import { ignore } from "../src/lib/ignore";
import type { BatchManifest } from "./render/batch";
import {
  batchResultsSchema,
  interpretOutcome,
  invalidRequestReason,
  RENDER_ABORTED,
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
const BATCH_GRACE_MILLISECONDS = 30_000; // past the batch's own deadline before it is given up on
const ERROR_KEPT = 400; // characters of a failure kept
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
async function verifySnapshot(
  sandbox: Sandbox,
  snapshotId: string,
  expectedBundleSha: string,
  signal?: AbortSignal,
): Promise<void> {
  const key = `${snapshotId}:${expectedBundleSha}`;
  if (verifiedSnapshots.has(key)) {
    return;
  }
  const manifestBytes = await sandbox.readFileToBuffer({ path: SNAPSHOT_MANIFEST_PATH }, signalOptions(signal));
  if (manifestBytes === null) {
    throw new SnapshotMismatchError("the sandbox snapshot has no manifest");
  }
  let manifestJson: unknown = null;
  try {
    manifestJson = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    // falls through to the unreadable-manifest error below
  }
  const manifest = snapshotManifestSchema.safeParse(manifestJson);
  if (!manifest.success) {
    throw new SnapshotMismatchError("the sandbox snapshot has an unreadable manifest");
  }
  const mismatch = snapshotMismatch(manifest.data, expectedBundleSha);
  if (mismatch) {
    throw new SnapshotMismatchError(mismatch);
  }
  verifiedSnapshots.add(key);
}

/** The SDK's per-call options for a signal, or nothing (the SDK's types take no explicit `undefined`). */
function signalOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

/** The time one batch may take: its items spread over the VM's CPUs, each at its deadline at worst, plus boot. */
function batchDeadlineMilliseconds(itemCount: number, vcpus: number, itemDeadlineMilliseconds: number): number {
  return Math.ceil(itemCount / vcpus) * itemDeadlineMilliseconds + BOOT_AND_TRANSFER_MARGIN_MILLISECONDS;
}

/**
 * Renders every request in one sandbox, in the order given. Resolves with one result per request: an invalid request or
 * a failed build is that item's error. Rejects when the batch as a whole cannot run: the sandbox does not start, the
 * snapshot does not fit (`SnapshotMismatchError`), the batch driver fails or its results are unreadable.
 *
 * `signal` cancels the batch: nothing starts once it has fired, a sandbox that is being created or is running is stopped,
 * and the batch rejects. A creation that the abort interrupts after the platform accepted it has no handle to stop; its
 * own `timeout` (a few minutes) ends it.
 */
export async function renderBatchInSandbox(
  requests: readonly RenderRequest[],
  options: RenderSandboxOptions,
  signal?: AbortSignal,
): Promise<RenderResult[]> {
  const results: RenderResult[] = requests.map(() => ({ ok: false, error: "not rendered" }));
  const runnable: Array<{ index: number; request: RenderRequest }> = [];
  requests.forEach((request, index) => {
    const invalidReason = invalidRequestReason(request);
    if (invalidReason) {
      results[index] = { ok: false, error: invalidReason };
    } else {
      runnable.push({ index, request });
    }
  });
  if (runnable.length === 0) {
    return results;
  }
  if (signal?.aborted) {
    throw new Error(RENDER_ABORTED);
  }

  const vcpus = options.vcpus ?? DEFAULT_VCPUS;
  const itemDeadline = options.itemDeadlineMilliseconds ?? DEFAULT_ITEM_DEADLINE_MILLISECONDS;
  const batchDeadline = batchDeadlineMilliseconds(runnable.length, vcpus, itemDeadline);
  const sandbox = await Sandbox.create({
    resources: { vcpus },
    timeout: batchDeadline + BOOT_AND_TRANSFER_MARGIN_MILLISECONDS,
    persistent: false,
    networkPolicy: NO_NETWORK,
    source: { type: "snapshot", snapshotId: options.snapshotId },
    ...signalOptions(signal),
  });
  // an abort stops the VM at once, whatever the batch is doing in it (a command is killed with it)
  const stopOnAbort = () => {
    sandbox.stop().catch(ignore);
  };
  signal?.addEventListener("abort", stopOnAbort, { once: true });
  try {
    if (signal?.aborted) {
      throw new Error(RENDER_ABORTED);
    }
    await verifySnapshot(sandbox, options.snapshotId, options.expectedBundleSha, signal);
    const manifest: BatchManifest = {
      itemDeadlineMilliseconds: itemDeadline,
      items: runnable.map(({ request }) => ({ name: request.name, pose: request.pose })),
    };
    await sandbox.writeFiles(
      [
        { path: `${SANDBOX_JOB_DIRECTORY}/batch.json`, content: Buffer.from(JSON.stringify(manifest)) },
        ...runnable.map(({ request }, position) => ({
          path: `${SANDBOX_JOB_DIRECTORY}/${position}.ts`,
          content: Buffer.from(request.code),
        })),
      ],
      signalOptions(signal),
    );
    const command = await sandbox.runCommand({
      cmd: SANDBOX_BUN_PATH,
      args: ["batch.ts", SANDBOX_JOB_DIRECTORY],
      cwd: SANDBOX_RENDER_DIRECTORY,
      timeoutMs: batchDeadline,
      ...signalOptions(signal),
    });
    if (command.exitCode !== 0) {
      throw new Error(`the batch driver exited ${command.exitCode}`);
    }
    const resultsFile = await sandbox.readFileToBuffer(
      { path: `${SANDBOX_JOB_DIRECTORY}/results.json` },
      signalOptions(signal),
    );
    if (resultsFile === null) {
      throw new Error("the batch wrote no results");
    }
    const outcomes = batchResultsSchema.parse(JSON.parse(resultsFile.toString("utf8"))).items;
    if (outcomes.length !== runnable.length) {
      throw new Error("the batch returned the wrong number of results");
    }
    runnable.forEach(({ index }, position) => {
      const outcome = outcomes[position];
      if (outcome) {
        results[index] = interpretOutcome(outcome, itemDeadline);
      }
    });
    return results;
  } finally {
    signal?.removeEventListener("abort", stopOnAbort);
    await sandbox.stop().catch(ignore);
  }
}

/**
 * `renderBatchInSandbox` that never rejects: if the batch as a whole fails, every item carries that reason. Its own
 * deadline cancels the batch too, so a timed-out batch does not leave its VM running.
 */
export async function renderBatchSafely(
  requests: readonly RenderRequest[],
  options: RenderSandboxOptions,
  signal?: AbortSignal,
): Promise<RenderResult[]> {
  const itemDeadline = options.itemDeadlineMilliseconds ?? DEFAULT_ITEM_DEADLINE_MILLISECONDS;
  const deadline = batchDeadlineMilliseconds(requests.length, options.vcpus ?? DEFAULT_VCPUS, itemDeadline);
  const deadlineController = new AbortController();
  const batchSignal = signal ? AbortSignal.any([signal, deadlineController.signal]) : deadlineController.signal;
  try {
    return await withDeadline(
      renderBatchInSandbox(requests, options, batchSignal),
      deadline + BATCH_GRACE_MILLISECONDS,
      "timed out",
      deadlineController,
    );
  } catch (error) {
    const reason = `vercel sandbox: ${error instanceof Error ? error.message : String(error)}`.slice(0, ERROR_KEPT);
    return requests.map(() => ({ ok: false, error: reason }));
  }
}

/** One build, one VM (a batch of one): the render the loop and the creature job use. Never rejects. */
export async function renderSafely(
  request: RenderRequest,
  options: RenderSandboxOptions,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const [result] = await renderBatchSafely([request], options, signal);
  return result ?? { ok: false, error: "vercel sandbox: no result" };
}
