// The local bun renderer: runs one build script against the kit and returns its stats. The build code may come from a
// model, so the subprocess gets an allowlisted environment: no API keys, tokens or other secrets from the caller's shell
// reach it (the banned-identifier check is a tripwire, not a sandbox).
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const RENDER_DIRECTORY = join(import.meta.dir, "render");
// what bun needs to start; nothing else is passed through
const ALLOWED_ENVIRONMENT_VARIABLES = ["PATH", "HOME", "TMPDIR", "LANG"] as const;

/** The stats line `render/run_local.ts` prints for one sprite: the kit's post() stats plus timing and fit. */
export interface RenderStats {
  name: string;
  ms: number;
  fit: string;
  snapped: number;
  dropped: number;
  coverage: number;
  bbox: string;
  outer: number;
  inner: number;
  clamped: number;
  edge: number;
  parts: number;
  flags: string;
}

export type RenderResult = { ok: true; stats: RenderStats } | { ok: false; error: string };

export interface RenderOptions {
  pose?: string;
  keepMagnifiedView?: boolean;
  timeoutMilliseconds?: number;
}

function renderEnvironment(outputDirectory: string): Record<string, string> {
  const environment: Record<string, string> = { KIT_OUT: outputDirectory };
  for (const name of ALLOWED_ENVIRONMENT_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/** Renders `sourcePath` (a build script) to `<outputDirectory>/<name>.png`. */
export function renderFileLocally(
  sourcePath: string,
  name: string,
  outputDirectory: string,
  options: RenderOptions = {},
): RenderResult {
  const completed = Bun.spawnSync(
    ["bun", "--preload", "./shim_plugin.ts", "run_local.ts", sourcePath, name, options.pose ?? ""],
    {
      cwd: RENDER_DIRECTORY,
      env: renderEnvironment(outputDirectory),
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMilliseconds ?? 30_000,
    },
  );
  if (!(options.keepMagnifiedView ?? true)) {
    const magnifiedPath = join(outputDirectory, `${name}_x4.png`);
    if (existsSync(magnifiedPath)) rmSync(magnifiedPath);
  }
  if (completed.exitedDueToTimeout) return { ok: false, error: "render timed out" };
  if (completed.exitCode !== 0) {
    const errorLines = completed.stderr.toString().trim().split("\n");
    return { ok: false, error: (errorLines.at(-1) || "error").slice(0, 300) };
  }
  const lastLine = completed.stdout.toString().trim().split("\n").at(-1) ?? "";
  // run_local.ts prints exactly this shape as its last line; the type is the contract between the two files
  const stats: RenderStats = JSON.parse(lastLine);
  return { ok: true, stats };
}
