// boat.dev renderer (--renderer boat): the same contract as the local renderer, with the build running in a boat sandbox.
//
// Each render creates its own boat sandbox (a full Ubuntu VM with bun preinstalled; `small`, 2 vCPU / 4 GB), copies the
// kit, the local runner (render/run_local.ts + shims) and the build code into it, runs `bun run_local.ts` there, reads
// the PNG back and deletes the sandbox. boat has no API setting for network rules and its `user` account has
// passwordless sudo, so the build never runs as `user`: every candidate gets a fresh Linux account without sudo whose
// outbound traffic (loopback included, so no DNS and no local services) is rejected by iptables owner rules, a clean
// environment (only PATH, HOME, LANG and KIT_OUT), a read-only kit and runner, and a SIGKILL after the render timeout.
// The sandbox is created with `noEnv` (none of the account's secrets, no in-sandbox API key), no snapshots (nothing of
// the candidate is kept), and a short auto-stop as a safety net in case the delete never runs.
//
// Authentication: BOAT_API_KEY from the environment, a key with the `ci` preset (create, use and delete the sandboxes it
// creates), for example `boat api-key create lampwarden-render --preset ci --ttl 30d`. The SDK does not read the boat
// CLI's login. The key never enters the sandbox and is never printed or logged.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command200Response, CommandResponse } from "@boatdev/sdk";
import { BoatApi, Configuration, ResponseError } from "@boatdev/sdk";
import {
  invalidRequestReason,
  lastErrorLine,
  parseStatsLine,
  type RenderedSprite,
  type RenderRequest,
  type RenderResult,
  withDeadline,
} from "./render-types";

const BOAT_API_BASE = "https://boat.dev/api/v1";
const SANDBOX_ROOT_DIRECTORY = "/tmp/lampwarden";
const SANDBOX_PIPELINE_DIRECTORY = `${SANDBOX_ROOT_DIRECTORY}/pipeline`;
const SANDBOX_RENDER_DIRECTORY = `${SANDBOX_PIPELINE_DIRECTORY}/render`;
const SANDBOX_JOBS_DIRECTORY = `${SANDBOX_ROOT_DIRECTORY}/jobs`;
const RUNNER_FILES = ["kit/kit.ts", "render/run_local.ts", "render/shim_canvas.ts", "render/shim_plugin.ts"];
const DEFAULT_RENDER_TIMEOUT_SECONDS = 30;
const SANDBOX_AUTO_STOP_SECONDS = 600;
const READY_POLL_INTERVAL_MILLISECONDS = 150;
const READY_TIMEOUT_MILLISECONDS = 90_000;
const RENDER_DEADLINE_MILLISECONDS = 180_000;
const READY_STATES: ReadonlySet<string> = new Set(["ready", "idle", "running"]);
const FAILED_STATES: ReadonlySet<string> = new Set(["archiving", "archived", "error", "cancelled"]);

export type SandboxSize = "small" | "default";

export interface BoatRender extends RenderedSprite {
  /** How long the render command itself took inside the sandbox, including the account lock-down. */
  renderCommandMilliseconds: number;
}

export interface RenderSandboxOptions {
  size?: SandboxSize;
  autoStopSeconds?: number;
}

export interface RenderSandbox {
  sandboxId: string;
  machineProvider: string;
}

function isFinishedCommand(response: Command200Response): response is CommandResponse {
  return response.type === "command.finished";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Describes an SDK error without echoing request headers: the status and the start of the JSON body. */
export async function describeBoatError(error: unknown): Promise<string> {
  if (error instanceof ResponseError) {
    const body = await error.response.text().catch(() => "");
    return `HTTP ${error.response.status} ${body.slice(0, 200)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createBoatClient(apiKey: string | undefined = process.env.BOAT_API_KEY): BoatApi {
  if (!apiKey) throw new Error("BOAT_API_KEY is not set (create one with `boat api-key create <name> --preset ci`)");
  return new BoatApi(new Configuration({ basePath: BOAT_API_BASE, accessToken: apiKey }));
}

async function waitUntilSandboxReady(boat: BoatApi, sandboxId: string): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MILLISECONDS;
  for (;;) {
    const { sandbox } = await boat.get({ sandboxId });
    if (READY_STATES.has(sandbox.state)) return sandbox.machineProvider ?? "unknown";
    if (FAILED_STATES.has(sandbox.state)) throw new Error(`sandbox ${sandboxId} is ${sandbox.state}`);
    if (Date.now() > deadline) throw new Error(`sandbox ${sandboxId} not ready after ${READY_TIMEOUT_MILLISECONDS} ms`);
    await sleep(READY_POLL_INTERVAL_MILLISECONDS);
  }
}

async function writeSandboxFiles(boat: BoatApi, sandboxId: string, files: Array<{ path: string; content: string }>) {
  await Promise.all(files.map((file) => boat.writeFile({ sandboxId, path: file.path, content: file.content })));
}

function runnerFiles(): Array<{ path: string; content: string }> {
  return RUNNER_FILES.map((relativePath) => ({
    path: `${SANDBOX_PIPELINE_DIRECTORY}/${relativePath}`,
    content: readFileSync(join(import.meta.dir, relativePath), "utf8"),
  }));
}

/** Creates a sandbox with none of the account's secrets, waits until it is ready and copies the kit and runner in. */
export async function createRenderSandbox(boat: BoatApi, options: RenderSandboxOptions = {}): Promise<RenderSandbox> {
  const created = await boat.create({
    type: options.size ?? "small",
    ttlSeconds: options.autoStopSeconds ?? SANDBOX_AUTO_STOP_SECONDS,
    noEnv: true,
    snapshots: false,
  });
  const sandboxId = created.sandbox.id;
  try {
    const machineProvider = await waitUntilSandboxReady(boat, sandboxId);
    await writeSandboxFiles(boat, sandboxId, runnerFiles());
    return { sandboxId, machineProvider };
  } catch (error) {
    await deleteRenderSandbox(boat, sandboxId);
    throw error;
  }
}

/** Deletes the sandbox and its data. A failed delete is reported, not thrown: the auto-stop still ends the sandbox. */
export async function deleteRenderSandbox(boat: BoatApi, sandboxId: string): Promise<void> {
  try {
    await boat.deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId });
  } catch (error) {
    console.error(`boat: could not delete sandbox ${sandboxId}: ${await describeBoatError(error)}`);
  }
}

/**
 * The shell command that renders one candidate: a new account without sudo, its outbound traffic rejected (IPv4 and
 * IPv6, loopback included), no cron or `at` jobs, a job directory only it can read, a clean environment and a SIGKILL
 * at the timeout. Afterwards the account is expired, every process and stray temporary file of it is removed and the
 * job directory goes back to `user`, so the file API can read the PNGs and no later candidate account can.
 * `spriteName` and `pose` are interpolated, so callers must pass only `isSafeRenderArgument` values.
 */
export function candidateCommand(
  jobDirectory: string,
  builderAccount: string,
  spriteName: string,
  pose: string,
  renderTimeoutSeconds: number,
): string {
  const outputDirectory = `${jobDirectory}/out`;
  // boat runs the command in a login shell whose `exit` also runs ~/.bash_logout (it prints a clear-screen sequence),
  // so the script exits from a subshell.
  return [
    "(",
    "set -u",
    `sudo useradd --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group ${builderAccount} || exit 90`,
    `for table in iptables ip6tables; do sudo "$table" -I OUTPUT 1 -m owner --uid-owner ${builderAccount} -j REJECT || exit 90; done`,
    // without this a build can install a crontab or an `at` job that outlives it (measured: a cron job kept running)
    `echo ${builderAccount} | sudo tee -a /etc/cron.deny /etc/at.deny >/dev/null || exit 90`,
    `sudo install -d -o ${builderAccount} -g ${builderAccount} -m 700 ${outputDirectory} || exit 90`,
    `sudo chown -R ${builderAccount}:${builderAccount} ${jobDirectory} && sudo chmod 700 ${jobDirectory} || exit 90`,
    `cd ${SANDBOX_RENDER_DIRECTORY}`,
    `sudo -u ${builderAccount} -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 KIT_OUT=${outputDirectory} timeout -s KILL ${renderTimeoutSeconds} bun --preload ./shim_plugin.ts run_local.ts ${jobDirectory}/build.ts ${spriteName} '${pose}'`,
    "render_status=$?",
    `sudo usermod --expiredate 1 ${builderAccount}`,
    `sudo pkill -KILL -u ${builderAccount}`,
    `sudo find /tmp /var/tmp /dev/shm -xdev -user ${builderAccount} -not -path '${jobDirectory}*' -delete 2>/dev/null`,
    `sudo chown -R user:user ${jobDirectory}`,
    "exit $render_status",
    ")",
  ].join("\n");
}

async function readSandboxFile(boat: BoatApi, sandboxId: string, path: string): Promise<Uint8Array> {
  const file = await boat.readFile({ sandboxId, path, encoding: "base64" });
  return new Uint8Array(Buffer.from(file.content, "base64"));
}

function failureReason(command: CommandResponse): string {
  if (command.exitCode === 137 || command.timedOut || command.oomKilled) return "render killed (timeout or memory)";
  if (command.exitCode === 90) return "could not lock down the build account";
  return lastErrorLine(command.stderr);
}

/** Renders one build script in a running render sandbox, as its own locked-down account in its own job directory. */
export async function renderInSandbox(
  boat: BoatApi,
  sandboxId: string,
  request: RenderRequest,
  renderTimeoutSeconds: number = DEFAULT_RENDER_TIMEOUT_SECONDS,
): Promise<BoatRender> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) throw new Error(invalidReason);
  const jobName = randomBytes(6).toString("hex");
  const jobDirectory = `${SANDBOX_JOBS_DIRECTORY}/${jobName}`;
  const outputDirectory = `${jobDirectory}/out`;
  await writeSandboxFiles(boat, sandboxId, [{ path: `${jobDirectory}/build.ts`, content: request.code }]);
  const commandStart = performance.now();
  const response = await boat.command({
    sandboxId,
    command: candidateCommand(jobDirectory, `lwb${jobName}`, request.name, request.pose, renderTimeoutSeconds),
    timeoutSeconds: renderTimeoutSeconds + 30,
  });
  const renderCommandMilliseconds = Math.round(performance.now() - commandStart);
  if (!isFinishedCommand(response)) throw new Error("render command did not finish");
  if (response.exitCode !== 0) throw new Error(`exit ${response.exitCode}: ${failureReason(response).slice(0, 300)}`);
  const stats = parseStatsLine(response.stdout);
  const png = await readSandboxFile(boat, sandboxId, `${outputDirectory}/${request.name}.png`);
  return { stats, png, renderCommandMilliseconds };
}

/** One sprite, one sandbox: create, render, delete. */
export async function renderWithFreshSandbox(
  request: RenderRequest,
  options: RenderSandboxOptions = {},
  boat: BoatApi = createBoatClient(),
): Promise<BoatRender> {
  const { sandboxId } = await createRenderSandbox(boat, options);
  try {
    return await renderInSandbox(boat, sandboxId, request);
  } finally {
    await deleteRenderSandbox(boat, sandboxId);
  }
}

/** The renderer the pipeline selects with `--renderer boat`. Never throws: a failure is a render error to score. */
export async function renderInBoatSandbox(request: RenderRequest): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  try {
    const rendered = await withDeadline(renderWithFreshSandbox(request), RENDER_DEADLINE_MILLISECONDS, "timed out");
    return { ok: true, stats: rendered.stats, png: rendered.png };
  } catch (error) {
    return { ok: false, error: `boat: ${await describeBoatError(error)}`.slice(0, 400) };
  }
}
