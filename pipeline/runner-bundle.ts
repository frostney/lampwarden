// What a render sandbox must hold: the kit, the runner and its helpers (the "runner bundle"), and the Bun that runs them.
// The snapshot script (sandbox-snapshot.ts) puts both into a Vercel Sandbox snapshot and records a manifest beside
// them; a render refuses a snapshot whose manifest does not match the code it runs from (see render-vercel-sandbox.ts).
// Nothing here locates itself with `import.meta`: callers pass the pipeline directory, so a Next.js function and the
// Bun scripts can both use it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

/** The files of the runner bundle, relative to the pipeline directory. Their order is part of the bundle's digest. */
const RUNNER_FILES = ["kit/kit.ts", "render/runner.ts", "render/batch.ts", "render/png.ts"];

/** Where the bundle lives in a render sandbox. */
export const SANDBOX_PIPELINE_DIRECTORY = "/vercel/sandbox/pipeline";

/** The Bun every render sandbox runs, installed into the snapshot from the release below. */
export const PINNED_BUN_VERSION = "1.4.4";
export const PINNED_BUN_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${PINNED_BUN_VERSION}/bun-linux-x64.zip`;
/** SHA-256 of that zip, from the release's SHASUMS256.txt (and checked against a download made on 24 Oct 2026). */
// biome-ignore lint/security/noSecrets: a published checksum
export const PINNED_BUN_SHA256 = "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c";
/** Where the snapshot installs it. */
export const SANDBOX_BUN_PATH = "/usr/local/bin/bun";

/** What the snapshot script writes next to the bundle, and a render reads back before it trusts the snapshot. */
export const SNAPSHOT_MANIFEST_PATH = `${SANDBOX_PIPELINE_DIRECTORY}/SNAPSHOT.json`;
export const snapshotManifestSchema = z.object({
  bundleSha: z.string(),
  kitSha: z.string(),
  bunVersion: z.string(),
  bunZipSha256: z.string(),
  createdAt: z.string(),
});
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

export interface RunnerFile {
  /** Relative to the pipeline directory (and to `SANDBOX_PIPELINE_DIRECTORY` in a sandbox). */
  path: string;
  content: Uint8Array;
}

// The path is built at runtime on purpose: a Next.js function lists these files in outputFileTracingIncludes instead of
// letting the bundler trace a dynamic path (and with it the whole project).
export function readRunnerFiles(pipelineDirectory: string): RunnerFile[] {
  return RUNNER_FILES.map((path) => ({
    path,
    content: readFileSync(join(/*turbopackIgnore: true*/ pipelineDirectory, path)),
  }));
}

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/** One digest over every file's path and content, in `RUNNER_FILES` order. */
export function runnerBundleSha(files: readonly RunnerFile[]): string {
  const lines = files.map((file) => `${file.path} ${sha256(file.content)}\n`).join("");
  return sha256(Buffer.from(lines));
}

/** The digest of the kit alone (`kit/kit.ts`), the figure docs/LIVE_GENERATION.md quotes. */
export function kitSha(files: readonly RunnerFile[]): string {
  const kit = files.find((file) => file.path === "kit/kit.ts");
  if (!kit) {
    throw new Error("the runner bundle has no kit/kit.ts");
  }
  return sha256(kit.content);
}

const SHORT_SHA = 12;
const REBUILD_HINT = "run `bun run sandbox:snapshot` and set VERCEL_SANDBOX_SNAPSHOT_ID to the id it prints";

/** Why a snapshot's manifest does not fit the bundle that is running, or null when it does. */
export function snapshotMismatch(manifest: SnapshotManifest, expectedBundleSha: string): string | null {
  if (manifest.bundleSha !== expectedBundleSha) {
    return `the sandbox snapshot holds a different kit or runner than this checkout (bundle ${manifest.bundleSha.slice(0, SHORT_SHA)}, expected ${expectedBundleSha.slice(0, SHORT_SHA)}); ${REBUILD_HINT}`;
  }
  if (manifest.bunVersion !== PINNED_BUN_VERSION) {
    return `the sandbox snapshot has bun ${manifest.bunVersion}, not ${PINNED_BUN_VERSION}; ${REBUILD_HINT}`;
  }
  return null;
}
