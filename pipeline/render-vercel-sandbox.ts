// Vercel Sandbox renderer (--renderer vercel): the same contract as the local renderer, with the build running in a
// locked-down microVM.
//
// Each render creates its own Firecracker microVM (vercel/sandbox/universal, which ships bun), copies the kit, the
// local runner (render/run_local.ts + shims) and the build code into it, runs `bun run_local.ts` there, reads the PNG
// back and stops the VM. The VM has no network (networkPolicy "deny-all", which also blocks DNS), no persistence,
// 1 vCPU, and the render command only gets KIT_OUT in its environment. Set VERCEL_SANDBOX_SNAPSHOT_ID to boot from a
// snapshot that already holds the kit and runner (see createRunnerSnapshot) instead of uploading them.
//
// Authentication is the SDK's: VERCEL_OIDC_TOKEN from the environment (`vercel env pull` writes it to .env.local), or
// VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID, or, with neither, an OIDC token the SDK refreshes from the Vercel
// CLI login and the linked project (.vercel/project.json from `vercel link`). None of it enters the VM, is printed or
// logged. Run the pipeline with `bun --no-env-file` so bun does not load .env files into the process.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type NetworkPolicy, Sandbox, Snapshot } from "@vercel/sandbox";
import {
  invalidRequestReason,
  lastErrorLine,
  parseStatsLine,
  type RenderedSprite,
  type RenderRequest,
  type RenderResult,
  withDeadline,
} from "./render-types";

const SANDBOX_PIPELINE_DIRECTORY = "/vercel/sandbox/pipeline";
const SANDBOX_RENDER_DIRECTORY = `${SANDBOX_PIPELINE_DIRECTORY}/render`;
const SANDBOX_JOB_DIRECTORY = "/vercel/sandbox/job";
const RUNNER_FILES = ["kit/kit.ts", "render/run_local.ts", "render/shim_canvas.ts", "render/shim_plugin.ts"];
const DEFAULT_RENDER_TIMEOUT_MILLISECONDS = 30_000;
const SANDBOX_SESSION_TIMEOUT_MILLISECONDS = 120_000;
const RENDER_DEADLINE_MILLISECONDS = 180_000;
const NO_NETWORK: NetworkPolicy = "deny-all";

export interface RenderSandboxOptions {
  snapshotId?: string;
  vcpus?: number;
  sessionTimeoutMilliseconds?: number;
}

export interface SandboxRender extends RenderedSprite {
  /** How long the render command itself took inside the VM. */
  renderCommandMilliseconds: number;
}

function runnerFiles(): Array<{ path: string; content: Uint8Array }> {
  return RUNNER_FILES.map((relativePath) => ({
    path: `${SANDBOX_PIPELINE_DIRECTORY}/${relativePath}`,
    content: readFileSync(join(import.meta.dir, relativePath)),
  }));
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
    return Sandbox.create({ ...lockedDown, source: { type: "snapshot", snapshotId: options.snapshotId } });
  }
  const sandbox = await Sandbox.create(lockedDown);
  try {
    await sandbox.writeFiles(runnerFiles());
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
  return sandbox;
}

/** Renders one build script in an already running sandbox. Each sprite name gets its own job directory. */
export async function renderInSandbox(
  sandbox: Sandbox,
  request: RenderRequest,
  renderTimeoutMilliseconds: number = DEFAULT_RENDER_TIMEOUT_MILLISECONDS,
): Promise<SandboxRender> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) throw new Error(invalidReason);
  const jobDirectory = `${SANDBOX_JOB_DIRECTORY}/${request.name}`;
  const outputDirectory = `${jobDirectory}/out`;
  await sandbox.writeFiles([{ path: `${jobDirectory}/build.ts`, content: request.code }]);
  const commandStart = performance.now();
  const command = await sandbox.runCommand({
    cmd: "bun",
    args: ["--preload", "./shim_plugin.ts", "run_local.ts", `${jobDirectory}/build.ts`, request.name, request.pose],
    cwd: SANDBOX_RENDER_DIRECTORY,
    env: { KIT_OUT: outputDirectory },
    timeoutMs: renderTimeoutMilliseconds,
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
    return await renderInSandbox(sandbox, request);
  } finally {
    await sandbox.stop();
  }
}

/** Builds a reusable snapshot holding the kit and runner. Returns its id; the source sandbox stops as part of it. */
export async function createRunnerSnapshot(expirationMilliseconds: number): Promise<string> {
  const sandbox = await createRenderSandbox();
  try {
    const snapshot = await sandbox.snapshot({ expiration: expirationMilliseconds });
    return snapshot.snapshotId;
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const snapshot = await Snapshot.get({ snapshotId });
  await snapshot.delete();
}

/** The renderer the pipeline selects with `--renderer vercel`. Never throws: a failure is a render error to score. */
export async function renderInVercelSandbox(request: RenderRequest): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  try {
    const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
    const rendered = await withDeadline(
      renderWithFreshSandbox(request, snapshotId ? { snapshotId } : {}),
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
