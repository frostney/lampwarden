// Shotcup renderer (--render shotcup): the same contract as the local renderer, over Shotcup's REST API.
//
// The assembled kit (kit/kit.ts) lives on a Shotcup drive named `lampwarden` (written once per process, by content: a
// write of identical content makes no new version) and every run mounts it read-only at /kit; the run itself only
// carries the short generated /main.ts (see shotcup-main-source.ts). Needs SHOTCUP_API_KEY in the environment (never
// printed or logged).
//
// Run against the live API on a Scale-plan account: endpoints, Bearer auth, the drive create/write (409 when the drive
// exists, `created: false` for an unchanged write) and the run response (`run.status`, `run.stdout`,
// `run.artifacts[].inlineBase64`, `run.metrics.engineMs`) work as written here. A timeoutMs above the plan's 300 s is
// clamped with a warning, and a "runtime is busy" refusal (all workers taken) is retried. Timings and sandbox checks:
// pipeline/README.md and docs/LIVE_GENERATION.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  invalidRequestReason,
  type RenderedSprite,
  type RenderRequest,
  type RenderResult,
  renderStatsSchema,
} from "./render-types";
import { type NamedBuild, shotcupMainSource } from "./shotcup-main-source";

const SHOTCUP_BASE_URL = process.env.SHOTCUP_BASE ?? "https://shotcup.dev";
const DRIVE_NAME = process.env.SHOTCUP_DRIVE ?? "lampwarden";
const KIT_PATH = join(import.meta.dir, "kit", "kit.ts");
const BUSY_RETRIES = 2;
const REQUEST_TIMEOUT_MILLISECONDS = 600_000;
const ARTIFACT_TIMEOUT_MILLISECONDS = 60_000;
/** The Scale plan's ceiling; a larger timeout is clamped with a `timeout-clamped` warning. */
const DEFAULT_RUN_TIMEOUT_MILLISECONDS = 300_000;

const runReplySchema = z.object({
  run: z.object({
    status: z.string().optional(),
    failureKind: z.string().nullish(),
    error: z.unknown().optional(),
    stderr: z.string().nullish(),
    stdout: z.string().nullish(),
    artifacts: z
      .array(z.object({ path: z.string(), inlineBase64: z.string().nullish(), url: z.string().nullish() }))
      .optional(),
    metrics: z.object({ engineMs: z.number().nullish() }).nullish(),
  }),
});

interface ShotcupReply {
  status: number;
  body: unknown;
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function shotcupRequest(method: string, path: string, body?: unknown): Promise<ShotcupReply> {
  const apiKey = process.env.SHOTCUP_API_KEY;
  if (!apiKey) throw new Error("SHOTCUP_API_KEY is not set");
  const response = await fetch(SHOTCUP_BASE_URL + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  const text = await response.text();
  if (!response.headers.get("content-type")?.startsWith("application/json") && !response.ok)
    return { status: response.status, body: { error: `HTTP ${response.status}` } };
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

let driveSeeded: Promise<void> | null = null;

async function seedDriveOnce(): Promise<void> {
  const created = await shotcupRequest("POST", "/api/v1/drives", { name: DRIVE_NAME });
  if (![200, 201, 409].includes(created.status)) throw new Error(`create drive failed: HTTP ${created.status}`); // 409: it exists
  const written = await shotcupRequest("PUT", `/api/v1/drives/${encodeURIComponent(DRIVE_NAME)}/files`, {
    files: [{ path: "/kit.ts", content: readFileSync(KIT_PATH, "utf8") }],
  });
  if (![200, 201].includes(written.status))
    throw new Error(`write drive failed: HTTP ${written.status} ${describe(written.body).slice(0, 200)}`);
}

/** Creates the drive if needed and writes /kit.ts, once per process (a failure is not remembered). */
function seedDrive(): Promise<void> {
  driveSeeded ??= seedDriveOnce().catch((error: unknown) => {
    driveSeeded = null;
    throw error;
  });
  return driveSeeded;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function artifactBytes(artifact: { inlineBase64?: string | null | undefined; url?: string | null | undefined }) {
  if (artifact.inlineBase64) return Buffer.from(artifact.inlineBase64, "base64");
  if (!artifact.url) throw new Error("artifact has neither inline data nor a url");
  const response = await fetch(artifact.url, { signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MILLISECONDS) });
  if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Renders several builds in one Shotcup run and returns the sprite for each name. Throws when the run fails. Batching
 * is for deterministic jobs like the hero frames; live generation sends one candidate per run (see docs/LIVE_GENERATION.md).
 */
export async function renderBatchOnShotcup(
  builds: readonly NamedBuild[],
  pose = "",
  timeoutMilliseconds = DEFAULT_RUN_TIMEOUT_MILLISECONDS,
): Promise<Record<string, RenderedSprite>> {
  await seedDrive();
  const body = {
    code: shotcupMainSource(builds, pose),
    engine: { canvas: true },
    mounts: [{ drive: DRIVE_NAME, path: "/kit", mode: "ro" }],
    timeoutMs: timeoutMilliseconds,
    deterministic: true,
  };
  let run: z.infer<typeof runReplySchema>["run"] | undefined;
  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
    const reply = await shotcupRequest("POST", "/api/v1/runs", body);
    const parsed = reply.status === 200 ? runReplySchema.safeParse(reply.body) : null;
    if (!parsed?.success)
      throw new Error(`run request failed: HTTP ${reply.status} ${describe(reply.body).slice(0, 200)}`);
    run = parsed.data.run;
    // all workers taken: the run queues ~30 s, then fails as daemon-error "the runtime is busy; retry shortly".
    // Not the build code's fault, so retry.
    if (run.failureKind !== "daemon-error" || !String(run.error).includes("busy")) break;
    if (attempt < BUSY_RETRIES) await sleep(2000 + 3000 * attempt);
  }
  if (!run) throw new Error("run request failed");
  if (run.status !== "succeeded") {
    const failureOutput = (run.stderr || (run.error === undefined ? "" : describe(run.error)) || "").slice(-300);
    throw new Error(`shotcup run ${run.status} (${run.failureKind}): ${failureOutput}`);
  }
  const pngByName = new Map<string, Uint8Array>();
  for (const artifact of run.artifacts ?? [])
    if (artifact.path.endsWith(".png"))
      pngByName.set(artifact.path.split("/").pop()?.slice(0, -4) ?? "", await artifactBytes(artifact));
  const statsLine = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  const allStats = z.array(renderStatsSchema).parse(JSON.parse(statsLine));
  const sprites: Record<string, RenderedSprite> = {};
  for (const stats of allStats) {
    const png = pngByName.get(stats.name);
    if (!png) throw new Error(`shotcup run wrote no PNG for ${stats.name}`);
    sprites[stats.name] = { stats: { ...stats, engineMilliseconds: run.metrics?.engineMs ?? undefined }, png };
  }
  return sprites;
}

export async function renderOnShotcup(request: RenderRequest): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  try {
    const sprite = (await renderBatchOnShotcup([request], request.pose))[request.name];
    if (!sprite) return { ok: false, error: "shotcup: no sprite returned" };
    return { ok: true, ...sprite };
  } catch (error) {
    return { ok: false, error: `shotcup: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` };
  }
}
