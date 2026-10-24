// Bundles one pipeline script for Node. The pipeline imports without file extensions, which Bun resolves and Node does
// not, so the direct-worker harnesses (measure-direct-worker.ts, probe-direct-worker.ts) run under Node from a bundle.
// The worker file is not bundled: it imports nothing but Node built-ins, and Node runs it as it is.
import { join } from "node:path";

/** Writes the bundle under node_modules/.cache (so bare imports resolve) and returns its path. */
export async function bundleForNode(entrypoint: string, outputName: string): Promise<string> {
  const outputDirectory = join(import.meta.dirname, "..", "node_modules", ".cache", "lampwarden-direct-worker");
  // one file per harness run, so two runs never overwrite each other's bundle
  const uniqueName = outputName.replace(/\.mjs$/, `.${process.pid}.mjs`);
  const built = await Bun.build({
    entrypoints: [entrypoint],
    target: "node",
    outdir: outputDirectory,
    naming: uniqueName,
  });
  if (!built.success) throw new Error(`bundle failed: ${built.logs.map(String).join("; ")}`);
  return join(outputDirectory, uniqueName);
}
