// Bundles one pipeline script for Node. The pipeline imports without file extensions, which Bun resolves and Node does
// not, so the in-process harnesses (measure-inprocess.ts, probe-inprocess.ts) run under Node from a bundle. The QuickJS
// packages stay external: their WebAssembly file has to be read from node_modules.
import { join } from "node:path";

const EXTERNAL_PACKAGES = [
  "quickjs-emscripten-core",
  "@jitl/quickjs-wasmfile-release-sync",
  "@vercel/sandbox",
  "@boatdev/sdk",
];

/** Writes the bundle under node_modules/.cache (so bare imports resolve) and returns its path. */
export async function bundleForNode(entrypoint: string, outputName: string): Promise<string> {
  const outputDirectory = join(import.meta.dirname, "..", "node_modules", ".cache", "lampwarden-inprocess");
  const built = await Bun.build({
    entrypoints: [entrypoint],
    target: "node",
    outdir: outputDirectory,
    naming: outputName,
    external: EXTERNAL_PACKAGES,
  });
  if (!built.success) throw new Error(`bundle failed: ${built.logs.map(String).join("; ")}`);
  return join(outputDirectory, outputName);
}
