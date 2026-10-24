// Vercel Sandbox renderer for run.py (--render vercel): same contract as local_render.render_file.
//
//   bun pipeline/vercel_sandbox_render.ts <build.ts> <name> <out_dir> [pose]
//
// Writes <out_dir>/<name>.png and <name>_x4.png and prints the render stats as JSON on the last stdout line.
// On failure it prints the reason to stderr and exits 1.
//
// Each call creates its own Firecracker microVM (vercel/sandbox/universal, which ships bun), copies the kit, the
// local runner (render/run_local.ts + shims) and the build code into it, runs `bun run_local.ts` there, reads the
// PNGs back and stops the VM. The VM has no network (networkPolicy "deny-all", which also blocks DNS), no
// persistence, 1 vCPU, and the render command only gets KIT_OUT in its environment. Set VERCEL_SANDBOX_SNAPSHOT_ID
// to boot from a snapshot that already holds the kit and runner (see createRunnerSnapshot) instead of uploading them.
//
// Authentication is the SDK's: VERCEL_OIDC_TOKEN from the environment (`vercel env pull` writes it to .env.local), or
// VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID, or, with neither, an OIDC token the SDK refreshes from the Vercel
// CLI login and the linked project (.vercel/project.json from `vercel link`). None of it enters the VM, is printed or logged.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type NetworkPolicy, Sandbox, Snapshot } from "@vercel/sandbox";

const PIPELINE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const SANDBOX_PIPELINE_DIRECTORY = "/vercel/sandbox/pipeline";
const SANDBOX_RENDER_DIRECTORY = `${SANDBOX_PIPELINE_DIRECTORY}/render`;
const SANDBOX_JOB_DIRECTORY = "/vercel/sandbox/job";
const RUNNER_FILES = ["kit/kit.ts", "render/run_local.ts", "render/shim_canvas.ts", "render/shim_plugin.ts"];
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const SANDBOX_SESSION_TIMEOUT_MS = 120_000;
const NO_NETWORK: NetworkPolicy = "deny-all";

export type RenderStats = Record<string, unknown>;

export interface SandboxRenderResult {
  stats: RenderStats;
  png: Uint8Array;
  pngX4: Uint8Array;
  renderCommandMs: number;
}

export interface RenderSandboxOptions {
  snapshotId?: string;
  vcpus?: number;
  sessionTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runnerFiles(): Array<{ path: string; content: Uint8Array }> {
  return RUNNER_FILES.map((relativePath) => ({
    path: `${SANDBOX_PIPELINE_DIRECTORY}/${relativePath}`,
    content: readFileSync(join(PIPELINE_DIRECTORY, relativePath)),
  }));
}

/** Boots a locked-down VM with the kit and runner in place, from a snapshot when one is given. */
export async function createRenderSandbox(options: RenderSandboxOptions = {}): Promise<Sandbox> {
  const lockedDown = {
    resources: { vcpus: options.vcpus ?? 1 },
    timeout: options.sessionTimeoutMs ?? SANDBOX_SESSION_TIMEOUT_MS,
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
  buildCode: string,
  spriteName: string,
  pose: string,
  renderTimeoutMs: number = DEFAULT_RENDER_TIMEOUT_MS,
): Promise<SandboxRenderResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(spriteName)) throw new Error(`invalid sprite name: ${spriteName}`);
  const jobDirectory = `${SANDBOX_JOB_DIRECTORY}/${spriteName}`;
  const outputDirectory = `${jobDirectory}/out`;
  await sandbox.writeFiles([{ path: `${jobDirectory}/build.ts`, content: buildCode }]);
  const commandStart = performance.now();
  const command = await sandbox.runCommand({
    cmd: "bun",
    args: ["--preload", "./shim_plugin.ts", "run_local.ts", `${jobDirectory}/build.ts`, spriteName, pose],
    cwd: SANDBOX_RENDER_DIRECTORY,
    env: { KIT_OUT: outputDirectory },
    timeoutMs: renderTimeoutMs,
  });
  const renderCommandMs = Math.round(performance.now() - commandStart);
  const standardOutput = await command.stdout();
  if (command.exitCode !== 0) {
    // bun ends a crash with a "Bun v1.x (Linux x64)" banner; the useful line is the last `error:`/`SomeError:` line before it.
    const errorLines = (await command.stderr())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("Bun v"));
    const errorLine =
      [...errorLines].reverse().find((line) => /^(\w*Error|error)\b/.test(line)) ?? errorLines[errorLines.length - 1];
    const reason = command.exitCode === 137 ? "render killed (timeout or memory)" : errorLine || "error";
    throw new Error(`exit ${command.exitCode}: ${reason.slice(0, 300)}`);
  }
  const lines = standardOutput.trim().split("\n");
  const parsed: unknown = JSON.parse(lines[lines.length - 1] ?? "null");
  if (!isRecord(parsed)) throw new Error("render printed no stats");
  const [png, pngX4] = await Promise.all([
    sandbox.readFileToBuffer({ path: `${outputDirectory}/${spriteName}.png` }),
    sandbox.readFileToBuffer({ path: `${outputDirectory}/${spriteName}_x4.png` }),
  ]);
  if (png === null || pngX4 === null) throw new Error("render wrote no PNG");
  return { stats: parsed, png, pngX4, renderCommandMs };
}

/** One sprite, one VM: create, render, stop. This is what run.py calls per candidate. */
export async function renderWithFreshSandbox(
  buildCode: string,
  spriteName: string,
  pose: string,
  options: RenderSandboxOptions = {},
): Promise<SandboxRenderResult> {
  const sandbox = await createRenderSandbox(options);
  try {
    return await renderInSandbox(sandbox, buildCode, spriteName, pose);
  } finally {
    await sandbox.stop();
  }
}

/** Builds a reusable snapshot holding the kit and runner. Returns its id; the source sandbox stops as part of it. */
export async function createRunnerSnapshot(expirationMs: number): Promise<string> {
  const sandbox = await createRenderSandbox();
  try {
    const snapshot = await sandbox.snapshot({ expiration: expirationMs });
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

async function main(): Promise<void> {
  const [buildPath, spriteName, outputDirectory, pose = ""] = process.argv.slice(2);
  if (!buildPath || !spriteName || !outputDirectory) {
    console.error("usage: bun pipeline/vercel_sandbox_render.ts <build.ts> <name> <out_dir> [pose]");
    process.exit(2);
  }
  try {
    const result = await renderWithFreshSandbox(readFileSync(buildPath, "utf8"), spriteName, pose, {
      snapshotId: process.env.VERCEL_SANDBOX_SNAPSHOT_ID || undefined,
    });
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, `${spriteName}.png`), result.png);
    writeFileSync(join(outputDirectory, `${spriteName}_x4.png`), result.pngX4);
    console.log(JSON.stringify(result.stats));
  } catch (error) {
    console.error(`vercel sandbox: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400));
    process.exit(1);
  }
}

if (import.meta.main) await main();
