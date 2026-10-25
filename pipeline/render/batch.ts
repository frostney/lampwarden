// The batch driver a render sandbox runs: renders many build scripts in one VM and reports each one's outcome.
//
//   bun batch.ts <job directory>
//
// The host (render-vercel-sandbox.ts) writes `<job>/batch.json` and one `<job>/<index>.ts` build script per item, runs
// this file, and reads `<job>/results.json` back. Each item is rendered by its own `bun runner.ts` process, so one
// build cannot change the kit another one sees, and each process gets its own deadline: a build that hangs, crashes or
// prints nothing is that item's failure and never the batch's. Items run side by side, one per available CPU.
//
// This file is dependency-free (the sandbox has the kit and the runner, nothing else) and passes nothing from the
// VM's environment to a build except KIT_OUT. It reports raw outcomes (exit code, the tail of each output, the PNG);
// the host validates and interprets them.
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

export interface BatchManifest {
  /** Each build process is killed after this long. */
  itemDeadlineMilliseconds: number;
  /** Item `index` is built by `<job>/<index>.ts`. */
  items: Array<{ name: string; pose: string }>;
}

export interface BatchItemOutcome {
  exitCode: number | null;
  timedOut: boolean;
  /** The last part of the runner's standard output (the stats line is its last JSON line). */
  standardOutput: string;
  standardError: string;
  /** The rendered PNG as base64, or null when the runner wrote none. */
  png: string | null;
  /** Wall-clock time of the build process, start to exit. */
  milliseconds: number;
}

export interface BatchResults {
  items: BatchItemOutcome[];
}

const OUTPUT_TAIL_CHARACTERS = 4000;
const RUNNER_DIRECTORY = import.meta.dir;

/** Reads a stream to its end but keeps only the last part, so a build that prints without end cannot exhaust memory. */
async function readTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let kept = "";
  for await (const chunk of stream) {
    kept += decoder.decode(chunk, { stream: true });
    if (kept.length > OUTPUT_TAIL_CHARACTERS * 2) kept = kept.slice(-OUTPUT_TAIL_CHARACTERS);
  }
  return kept.slice(-OUTPUT_TAIL_CHARACTERS);
}

async function renderItem(jobDirectory: string, manifest: BatchManifest, index: number): Promise<BatchItemOutcome> {
  const item = manifest.items[index];
  if (!item) throw new Error(`no item ${index}`);
  const outputDirectory = join(jobDirectory, "out", String(index));
  const started = performance.now();
  const subprocess = Bun.spawn(
    [process.execPath, "runner.ts", join(jobDirectory, `${index}.ts`), item.name, item.pose],
    { cwd: RUNNER_DIRECTORY, env: { KIT_OUT: outputDirectory }, stdout: "pipe", stderr: "pipe" },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    subprocess.kill("SIGKILL");
  }, manifest.itemDeadlineMilliseconds);
  const [standardOutput, standardError, exitCode] = await Promise.all([
    readTail(subprocess.stdout),
    readTail(subprocess.stderr),
    subprocess.exited,
  ]);
  clearTimeout(timer);
  const milliseconds = Math.round(performance.now() - started);
  let png: string | null = null;
  if (!timedOut && exitCode === 0) {
    try {
      png = readFileSync(join(outputDirectory, `${item.name}.png`)).toString("base64");
    } catch {
      png = null;
    }
  }
  return {
    exitCode,
    timedOut,
    standardOutput,
    standardError,
    png,
    milliseconds,
  };
}

async function renderBatch(jobDirectory: string): Promise<void> {
  const manifest: BatchManifest = JSON.parse(readFileSync(join(jobDirectory, "batch.json"), "utf8"));
  const outcomes: BatchItemOutcome[] = new Array(manifest.items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < manifest.items.length; index = next++) {
      try {
        outcomes[index] = await renderItem(jobDirectory, manifest, index);
      } catch (error) {
        outcomes[index] = {
          exitCode: null,
          timedOut: false,
          standardOutput: "",
          standardError: `error: ${error instanceof Error ? error.message : String(error)}`,
          png: null,
          milliseconds: 0,
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), manifest.items.length) }, worker));
  const results: BatchResults = { items: outcomes };
  writeFileSync(join(jobDirectory, "results.json"), JSON.stringify(results));
}

if (import.meta.main) {
  const jobDirectory = process.argv[2];
  if (!jobDirectory) throw new Error("usage: bun batch.ts <job directory>");
  await renderBatch(jobDirectory);
}
