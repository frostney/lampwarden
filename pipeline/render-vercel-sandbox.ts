// Vercel Sandbox renderer: the same contract as the local renderer, with the build running in a locked-down microVM.
//
// Each render creates its own Firecracker microVM, gets the kit, the local runner (render/run_local.ts + shims) and the
// build into it, runs `bun run_local.ts` there, reads the PNG back and stops the VM. The VM has no network
// (networkPolicy "deny-all", which also blocks DNS), no persistence, 1 vCPU, and the render command only gets KIT_OUT in
// its environment. With a snapshot id the VM boots from a snapshot that already holds the pinned Bun, the kit and the
// runner (sandbox-snapshot.ts builds it); without one it uploads the runner files it is given into the stock image.
//
// This module reads no file and locates nothing with `import.meta`, so a Vercel function can import it: the caller
// passes the runner files (render-vercel-cli.ts) or the expected bundle digest (the function's renderer).
//
// Authentication is the SDK's: on Vercel, the deployment's OIDC token; locally VERCEL_OIDC_TOKEN from the environment
// (`vercel env pull` writes it to .env.local) or, without it, an OIDC token the SDK refreshes from the Vercel CLI login
// and the linked project (.vercel/project.json from `vercel link`); SDK 3.9.0 reads no VERCEL_TOKEN from the environment.
// None of it enters the VM, is printed or logged. The pipeline scripts run as `varlock run ... -- bun --no-env-file`
// (package.json): bun loads no .env file, and varlock hands the script only the variables it needs from .env.schema.
import { type NetworkPolicy, Sandbox } from "@vercel/sandbox";
import {
  invalidRequestReason,
  lastErrorLine,
  parseStatsLine,
  type RenderedSprite,
  type RenderRequest,
  type RenderResult,
  withDeadline,
} from "./render-types";
import {
  type RunnerFile,
  SANDBOX_BUN_PATH,
  SANDBOX_PIPELINE_DIRECTORY,
  SNAPSHOT_MANIFEST_PATH,
  snapshotManifestSchema,
  snapshotMismatch,
} from "./runner-bundle";

const SANDBOX_RENDER_DIRECTORY = `${SANDBOX_PIPELINE_DIRECTORY}/render`;
const SANDBOX_JOB_DIRECTORY = "/vercel/sandbox/job";
const DEFAULT_RENDER_TIMEOUT_MILLISECONDS = 30_000;
const SANDBOX_SESSION_TIMEOUT_MILLISECONDS = 120_000;
const RENDER_DEADLINE_MILLISECONDS = 180_000;
const NO_NETWORK: NetworkPolicy = "deny-all";

export interface RenderSandboxOptions {
  /** Boot from this snapshot (it holds the bundle and Bun) instead of uploading `runnerFiles` into the stock image. */
  snapshotId?: string;
  /** Required without a snapshot. */
  runnerFiles?: readonly RunnerFile[];
  /**
   * With a snapshot: the digest of the bundle this deployment expects (`runnerBundleSha`). The snapshot's manifest must
   * match it and name the pinned Bun, or the sandbox is stopped and the render fails.
   */
  expectedBundleSha?: string;
  vcpus?: number;
  sessionTimeoutMilliseconds?: number;
}

export interface SandboxRender extends RenderedSprite {
  /** How long the render command itself took inside the VM. */
  renderCommandMilliseconds: number;
}

// snapshots already checked against a bundle digest by this process: the manifest is read once per snapshot and digest
const verifiedSnapshots = new Set<string>();

/** Throws when the snapshot's manifest is missing, unreadable, or does not fit the deployed bundle. */
async function verifySnapshot(sandbox: Sandbox, snapshotId: string, expectedBundleSha: string): Promise<void> {
  const key = `${snapshotId}:${expectedBundleSha}`;
  if (verifiedSnapshots.has(key)) return;
  const manifestBytes = await sandbox.readFileToBuffer({ path: SNAPSHOT_MANIFEST_PATH });
  if (manifestBytes === null) throw new Error("the sandbox snapshot has no manifest");
  const manifest = snapshotManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const mismatch = snapshotMismatch(manifest, expectedBundleSha);
  if (mismatch) throw new Error(mismatch);
  verifiedSnapshots.add(key);
}

/** Boots a locked-down VM with the kit and runner in place, from a snapshot when one is given. */
export async function createRenderSandbox(options: RenderSandboxOptions = {}): Promise<Sandbox> {
  const lockedDown = {
    resources: { vcpus: options.vcpus ?? 1 },
    timeout: options.sessionTimeoutMilliseconds ?? SANDBOX_SESSION_TIMEOUT_MILLISECONDS,
    persistent: false,
    networkPolicy: NO_NETWORK,
  };
  if (options.snapshotId) {
    const { snapshotId, expectedBundleSha } = options;
    const sandbox = await Sandbox.create({ ...lockedDown, source: { type: "snapshot", snapshotId } });
    if (expectedBundleSha) {
      try {
        await verifySnapshot(sandbox, snapshotId, expectedBundleSha);
      } catch (error) {
        await sandbox.stop();
        throw error;
      }
    }
    return sandbox;
  }
  if (!options.runnerFiles) throw new Error("a render without a snapshot needs the runner files");
  const sandbox = await Sandbox.create(lockedDown);
  try {
    await sandbox.writeFiles(
      options.runnerFiles.map((file) => ({
        path: `${SANDBOX_PIPELINE_DIRECTORY}/${file.path}`,
        content: Buffer.from(file.content),
      })),
    );
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
  return sandbox;
}

export interface RenderInSandboxOptions {
  renderTimeoutMilliseconds?: number;
  /** The Bun to run: the snapshot's pinned one, or the stock image's `bun` on PATH. */
  bunCommand?: string;
}

/** Renders one build script in an already running sandbox. Each sprite name gets its own job directory. */
export async function renderInSandbox(
  sandbox: Sandbox,
  request: RenderRequest,
  options: RenderInSandboxOptions = {},
): Promise<SandboxRender> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) throw new Error(invalidReason);
  const jobDirectory = `${SANDBOX_JOB_DIRECTORY}/${request.name}`;
  const outputDirectory = `${jobDirectory}/out`;
  await sandbox.writeFiles([{ path: `${jobDirectory}/build.ts`, content: Buffer.from(request.code) }]);
  const commandStart = performance.now();
  const command = await sandbox.runCommand({
    cmd: options.bunCommand ?? "bun",
    args: ["--preload", "./shim_plugin.ts", "run_local.ts", `${jobDirectory}/build.ts`, request.name, request.pose],
    cwd: SANDBOX_RENDER_DIRECTORY,
    env: { KIT_OUT: outputDirectory },
    timeoutMs: options.renderTimeoutMilliseconds ?? DEFAULT_RENDER_TIMEOUT_MILLISECONDS,
  });
  const renderCommandMilliseconds = Math.round(performance.now() - commandStart);
  const standardOutput = await command.stdout();
  if (command.exitCode !== 0) {
    const reason =
      command.exitCode === 137 ? "render killed (timeout or memory)" : lastErrorLine(await command.stderr());
    throw new Error(`exit ${command.exitCode}: ${reason.slice(0, 300)}`);
  }
  const stats = parseStatsLine(standardOutput);
  const png = await sandbox.readFileToBuffer({ path: `${outputDirectory}/${request.name}.png` });
  if (png === null) throw new Error("render wrote no PNG");
  return { stats, png, renderCommandMilliseconds };
}

/** One sprite, one VM: create, render, stop. */
export async function renderWithFreshSandbox(
  request: RenderRequest,
  options: RenderSandboxOptions = {},
): Promise<SandboxRender> {
  const sandbox = await createRenderSandbox(options);
  try {
    return await renderInSandbox(sandbox, request, options.snapshotId ? { bunCommand: SANDBOX_BUN_PATH } : {});
  } finally {
    await sandbox.stop();
  }
}

/** A renderer that never throws: a failure is a render error for the loop to score. */
export async function renderSafely(request: RenderRequest, options: RenderSandboxOptions): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  try {
    const rendered = await withDeadline(
      renderWithFreshSandbox(request, options),
      RENDER_DEADLINE_MILLISECONDS,
      "timed out",
    );
    return { ok: true, stats: rendered.stats, png: rendered.png };
  } catch (error) {
    return {
      ok: false,
      error: `vercel sandbox: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400),
    };
  }
}
