// The local bun renderer: runs one build script against the kit in a subprocess and returns its stats and PNG. The
// build code may come from a model, so the subprocess gets an allowlisted environment: no API keys, tokens or other
// secrets from the caller's shell reach it (the banned-identifier check is a tripwire, not a sandbox). It still runs
// with the caller's file and network access; use a sandboxed renderer when that matters.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  invalidRequestReason,
  lastErrorLine,
  parseStatsLine,
  type RenderRequest,
  type RenderResult,
} from "./render-types";

const RENDER_DIRECTORY = join(import.meta.dir, "render");
// what bun needs to start; nothing else is passed through
const ALLOWED_ENVIRONMENT_VARIABLES = ["PATH", "HOME", "TMPDIR", "LANG"] as const;
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;

export interface LocalRenderOptions {
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

/** Renders the build in a bun subprocess that writes its PNGs to a temporary directory, then reads the PNG back. */
export async function renderLocally(request: RenderRequest, options: LocalRenderOptions = {}): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  const workDirectory = mkdtempSync(join(tmpdir(), "lampwarden-render-"));
  try {
    const sourcePath = join(workDirectory, "build.ts");
    writeFileSync(sourcePath, `${request.code}\n`);
    const subprocess = Bun.spawn(
      ["bun", "--preload", "./shim_plugin.ts", "run_local.ts", sourcePath, request.name, request.pose],
      {
        cwd: RENDER_DIRECTORY,
        env: renderEnvironment(workDirectory),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      subprocess.kill("SIGKILL");
    }, options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS);
    const [standardOutput, standardError, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    clearTimeout(timer);
    if (timedOut) return { ok: false, error: "render timed out" };
    if (exitCode !== 0) return { ok: false, error: lastErrorLine(standardError).slice(0, 300) };
    const stats = parseStatsLine(standardOutput);
    return { ok: true, stats, png: readFileSync(join(workDirectory, `${request.name}.png`)) };
  } catch (error) {
    return { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}
