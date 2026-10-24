// Bundles one pipeline script for Node. The pipeline imports without file extensions, which Bun resolves and Node does
// not, so the direct-worker harnesses (measure-direct-worker.ts, probe-direct-worker.ts) run under Node from a bundle.
// The worker file is not bundled: it imports nothing but `node:worker_threads`, and Node runs it as it is.
import { join } from "node:path";

/** Writes the bundle under node_modules/.cache (so bare imports resolve) and returns its path. */
export async function bundleForNode(entrypoint: string, outputName: string): Promise<string> {
  const outputDirectory = join(import.meta.dirname, "..", "node_modules", ".cache", "lampwarden-direct-worker");
  const built = await Bun.build({
    entrypoints: [entrypoint],
    target: "node",
    outdir: outputDirectory,
    naming: outputName,
  });
  if (!built.success) throw new Error(`bundle failed: ${built.logs.map(String).join("; ")}`);
  return join(outputDirectory, outputName);
}
