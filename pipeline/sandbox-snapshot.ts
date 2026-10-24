// Builds the Vercel Sandbox snapshot the live creature generator renders in: the pinned Bun, the kit and the runner.
//
// usage: bun run sandbox:snapshot   (varlock run ... -- bun --no-env-file pipeline/sandbox-snapshot.ts)
//
// Auth is the SDK's (`vercel link` once, or VERCEL_OIDC_TOKEN from `vercel env pull`); nothing from the environment
// enters the VM. The VM may reach the network only while it fetches Bun, and only
// github.com and its release hosts: it downloads the release zip, checks its SHA-256 against the pin in
// runner-bundle.ts (the digest in the release's SHASUMS256.txt), installs it over the image's Bun at
// /usr/local/bin/bun, and then the network policy goes to "deny-all" before anything else is copied in. The kit and
// runner are then written next to a SNAPSHOT.json that records the bundle digest, the kit's digest and the Bun
// version; a render reads that manifest back and refuses a snapshot that does not match the deployed code. A smoke
// render of a committed example must reproduce its committed PNG byte for byte before the snapshot is taken.
//
// It prints the snapshot id: set it as VERCEL_SANDBOX_SNAPSHOT_ID on the deployment. Rebuild it (and set the new id)
// whenever pipeline/kit/kit.ts or pipeline/render/ changes, or when the pinned Bun moves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { batchResultsSchema, interpretOutcome } from "./render-types";
import {
  kitSha,
  PINNED_BUN_SHA256,
  PINNED_BUN_URL,
  PINNED_BUN_VERSION,
  readRunnerFiles,
  runnerBundleSha,
  SANDBOX_BUN_PATH,
  SANDBOX_PIPELINE_DIRECTORY,
  SNAPSHOT_MANIFEST_PATH,
  type SnapshotManifest,
} from "./runner-bundle";

const PIPELINE_DIRECTORY = import.meta.dir;
const SMOKE_BUILD = join(PIPELINE_DIRECTORY, "kit", "examples", "ex_lamp_lit.ts");
const SMOKE_EXPECTED_PNG = join(PIPELINE_DIRECTORY, "..", "public", "sprites", "lamp-lit.png");
const SMOKE_DIRECTORY = "/vercel/sandbox/job/smoke";
const BUN_DOWNLOAD_HOSTS = ["github.com", "*.githubusercontent.com"];

const sandbox = await Sandbox.create({
  persistent: false,
  resources: { vcpus: 1 },
  timeout: 10 * 60_000,
  networkPolicy: { allow: BUN_DOWNLOAD_HOSTS },
});

async function run(description: string, command: string, sudo = false): Promise<string> {
  const result = await sandbox.runCommand({ cmd: "bash", args: ["-c", command], sudo });
  if (result.exitCode !== 0) {
    throw new Error(`${description} failed (exit ${result.exitCode}): ${(await result.stderr()).trim().slice(-400)}`);
  }
  return (await result.stdout()).trim();
}

try {
  const files = readRunnerFiles(PIPELINE_DIRECTORY);
  const bundleSha = runnerBundleSha(files);
  console.log(`kit sha256 ${kitSha(files)}\nbundle sha256 ${bundleSha}`);
  console.log(`stock image bun: ${await run("stock bun", "bun --version")}`);

  // fetch the pinned Bun, check it against the pinned digest, install it
  await run(
    "download bun",
    `set -euo pipefail; cd /tmp; curl -fsSL -o bun.zip '${PINNED_BUN_URL}'; echo '${PINNED_BUN_SHA256}  bun.zip' | sha256sum -c -; unzip -o -q bun.zip`,
  );
  await run(
    "install bun",
    `install -m 0755 /tmp/bun-linux-x64/bun ${SANDBOX_BUN_PATH}; rm -rf /tmp/bun.zip /tmp/bun-linux-x64`,
    true,
  );
  await sandbox.update({ networkPolicy: "deny-all" });
  const bunVersion = await run("bun --version", `${SANDBOX_BUN_PATH} --version`);
  const pathVersion = await run("bun --version on PATH", "bun --version");
  if (bunVersion !== PINNED_BUN_VERSION || pathVersion !== PINNED_BUN_VERSION) {
    throw new Error(`expected bun ${PINNED_BUN_VERSION}, the sandbox has ${bunVersion} (PATH: ${pathVersion})`);
  }
  console.log(`bun ${bunVersion} installed at ${SANDBOX_BUN_PATH}; network policy deny-all from here on`);

  // the runner bundle and the manifest that pins it
  const manifest: SnapshotManifest = {
    bundleSha,
    kitSha: kitSha(files),
    bunVersion,
    bunZipSha256: PINNED_BUN_SHA256,
    createdAt: new Date().toISOString(),
  };
  await sandbox.writeFiles([
    ...files.map((file) => ({
      path: `${SANDBOX_PIPELINE_DIRECTORY}/${file.path}`,
      content: Buffer.from(file.content),
    })),
    { path: SNAPSHOT_MANIFEST_PATH, content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { path: `${SMOKE_DIRECTORY}/0.ts`, content: readFileSync(SMOKE_BUILD) },
    {
      path: `${SMOKE_DIRECTORY}/batch.json`,
      content: Buffer.from(
        JSON.stringify({ itemDeadlineMilliseconds: 30_000, items: [{ name: "lamp-lit", pose: "" }] }),
      ),
    },
  ]);

  // smoke test, through the batch driver every render uses: the committed example must come out byte for byte as the
  // committed sprite
  await run(
    "smoke render",
    `cd ${SANDBOX_PIPELINE_DIRECTORY}/render && ${SANDBOX_BUN_PATH} batch.ts ${SMOKE_DIRECTORY}`,
  );
  const smokeResults = await sandbox.readFileToBuffer({ path: `${SMOKE_DIRECTORY}/results.json` });
  const smokeOutcome = smokeResults
    ? batchResultsSchema.parse(JSON.parse(smokeResults.toString("utf8"))).items[0]
    : undefined;
  const smoke = smokeOutcome ? interpretOutcome(smokeOutcome, 30_000) : undefined;
  if (!smoke?.ok) throw new Error(`the smoke render failed: ${smoke?.error ?? "no results"}`);
  if (!Buffer.from(smoke.png).equals(readFileSync(SMOKE_EXPECTED_PNG))) {
    throw new Error("the smoke render of ex_lamp_lit.ts does not reproduce public/sprites/lamp-lit.png");
  }
  console.log("smoke render: lamp-lit.png reproduced byte for byte");
  await run("clean up", "rm -rf /vercel/sandbox/job");

  const snapshot = await sandbox.snapshot({ expiration: 0 });
  console.log(`\nVERCEL_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  await sandbox.stop().catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
