// Runs hostile-looking JavaScript build probes (pipeline/direct_worker_eval/probes/*.js) through the direct-worker renderer
// and records, for each probe, what the build reached and whether the host and the next render were unaffected.
//
// usage: bun pipeline/probe-direct-worker.ts [--runtimes bun,node] [--configs fresh,pool,batch,noguard] [--probes a,b]
//          [--node PATH] [--json FILE]
//
// Configs: `fresh` is a new worker per render; `pool` takes a ready worker and replaces it; `batch` renders the probe and
// then a clean sprite in the SAME worker (the way a creature's animation frames would run), so what a probe leaves
// behind in the worker shows in the next frame; `batch-import` is `batch` with dynamic `import()` left open (a plain
// `new Function`), to show what refusing it closes, and `batch-import-long` keeps the worker alive for 40 more frames
// (about a second), long enough for a network request to complete; `noguard` is `fresh` with the external-memory guard off, to show what the
// heap limit alone does not stop.
//
// Every (runtime, config, probe) runs in its own disposable child process, started with an allowlisted environment plus
// one canary variable that stands for a secret. The parent owns a canary file, a marker directory and a canary HTTP
// server on 127.0.0.1, so what a probe reaches is observable: a leaked secret, a file read or written, a request, a
// process left behind. Nothing here touches the network beyond 127.0.0.1, and the only commands a probe runs are
// `id -un` and a `sleep`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { decodePng } from "../tools/logo/png";
import { bundleForNode } from "./bundle-for-node-direct";
import {
  createDirectWorkerRenderer,
  type DirectWorkerOptions,
  renderBatchInDirectWorker,
} from "./render-direct-worker";
import type { RenderResult } from "./render-types";

const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const PROBES_DIRECTORY = join(PIPELINE_DIRECTORY, "direct_worker_eval", "probes");
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const CANARY_ENVIRONMENT_VARIABLE = "LAMPWARDEN_CANARY_SECRET";
const CANARY_SECRET = "canary-not-a-secret";
const PROBE_DEADLINE_MILLISECONDS = 1500;
const CONFIGS = ["fresh", "pool", "batch", "noguard", "batch-import", "batch-import-long"] as const;
type Config = (typeof CONFIGS)[number];
const RUNTIMES = ["bun", "node"] as const;
type RuntimeName = (typeof RUNTIMES)[number];

const reportSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  renderMilliseconds: z.number(),
  rssBeforeMegabytes: z.number(),
  rssAfterMegabytes: z.number(),
  idleCpuMilliseconds: z.number(),
  hostProblems: z.array(z.string()),
  cleanIdentical: z.boolean(),
  cleanError: z.string().optional(),
  environmentKeyCount: z.number(),
});
type Report = z.infer<typeof reportSchema>;

function isConfig(value: string): value is Config {
  return CONFIGS.some((config) => config === value);
}

function isRuntime(value: string): value is RuntimeName {
  return RUNTIMES.some((runtime) => runtime === value);
}

function optionsFor(config: Config): DirectWorkerOptions {
  const base: DirectWorkerOptions = { deadlineMilliseconds: PROBE_DEADLINE_MILLISECONDS };
  if (config === "pool") return { ...base, poolSize: 1 };
  if (config === "noguard") return { ...base, memoryLimitMegabytes: 0 };
  if (config === "batch-import" || config === "batch-import-long") return { ...base, denyDynamicImport: false };
  return base;
}

const megabytes = (bytes: number) => Math.round(bytes / 1048576);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What a probe changed in the host's own intrinsics, if anything (a worker has its own realm, so nothing should). */
function hostProblems(): string[] {
  const problems: string[] = [];
  for (const name of ["sandboxPolluted", "hostPolluted"]) {
    if (Reflect.get(Object.prototype, name) !== undefined) problems.push(`Object.prototype.${name}`);
    if (Reflect.get(Array.prototype, name) !== undefined) problems.push(`Array.prototype.${name}`);
  }
  const natives: Array<[string, unknown]> = [
    ["Array.prototype.push", Array.prototype.push],
    ["Array.prototype.map", Array.prototype.map],
    ["Math.floor", Math.floor],
    ["Math.round", Math.round],
    ["JSON.stringify", JSON.stringify],
    ["Uint8Array.prototype.set", Uint8Array.prototype.set],
  ];
  for (const [name, value] of natives)
    if (typeof value !== "function" || !Function.prototype.toString.call(value).includes("[native code]"))
      problems.push(`${name} replaced`);
  return problems;
}

function differingPixels(first: Uint8Array, second: Uint8Array): number {
  let differing = 0;
  for (let offset = 0; offset < Math.max(first.length, second.length); offset += 4)
    if (
      first[offset] !== second[offset] ||
      first[offset + 1] !== second[offset + 1] ||
      first[offset + 2] !== second[offset + 2] ||
      first[offset + 3] !== second[offset + 3]
    )
      differing++;
  return differing;
}

/** The child: one probe through one configuration, then an idle wait, an integrity check and a clean render. */
async function runChild(
  config: Config,
  probe: string,
  workDirectory: string,
  canaryUrl: string,
  canaryFile: string,
): Promise<Report> {
  const code = readFileSync(join(PROBES_DIRECTORY, `${probe}.js`), "utf8")
    .replaceAll("__CANARY_ENV__", CANARY_ENVIRONMENT_VARIABLE)
    .replaceAll("__CANARY_FILE__", canaryFile)
    .replaceAll("__CANARY_URL__", canaryUrl)
    .replaceAll("__MARKER_DIR__", workDirectory);
  const options = optionsFor(config);
  const renderer = createDirectWorkerRenderer(options);
  const clean = readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8");
  const committed = decodePng(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"))).data;
  // load everything a later render needs before the probe runs, so a probe that breaks the host cannot hide behind a lazy import
  await renderer.ready();
  await renderer.render({ code: clean, name: "lamp-lit", pose: "" });
  await renderer.ready();
  const rssBeforeMegabytes = megabytes(process.memoryUsage().rss);
  const start = performance.now();
  let result: RenderResult;
  let laterFrames: RenderResult[] | undefined;
  let environmentKeyCount = -1;
  if (config === "batch" || config === "batch-import" || config === "batch-import-long") {
    // the probe, then three clean frames in the same worker: long enough for work the probe left behind to run
    const frame = { code: clean, name: "lamp-lit", pose: "" };
    const laterCount = config === "batch-import-long" ? 40 : 3;
    const batch = await renderBatchInDirectWorker(
      [{ code, name: "probe", pose: "" }, ...Array.from({ length: laterCount }, () => frame)],
      options,
    );
    result = batch.results[0] ?? { ok: false, error: "no result" };
    laterFrames = batch.results.slice(1);
  } else {
    const detailed = await renderer.renderDetailed({ code, name: "probe", pose: "" });
    result = detailed.result;
    environmentKeyCount = detailed.timings.environmentKeyCount;
  }
  const renderMilliseconds = Math.round(performance.now() - start);
  const rssAfterMegabytes = megabytes(process.memoryUsage().rss);
  const cpuBefore = process.cpuUsage();
  await sleep(1500);
  const cpuAfter = process.cpuUsage(cpuBefore);
  const problems = hostProblems();
  const frames = laterFrames ?? [await renderer.render({ code: clean, name: "lamp-lit", pose: "" })];
  const cleanIdentical = frames.every(
    (frame) => frame.ok && differingPixels(decodePng(Buffer.from(frame.png)).data, committed) === 0,
  );
  const failedFrame = frames.find((frame) => !frame.ok);
  await renderer.close();
  return {
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
    renderMilliseconds,
    rssBeforeMegabytes,
    rssAfterMegabytes,
    idleCpuMilliseconds: Math.round((cpuAfter.user + cpuAfter.system) / 1000),
    hostProblems: problems,
    cleanIdentical,
    environmentKeyCount,
    ...(failedFrame && !failedFrame.ok ? { cleanError: failedFrame.error } : {}),
  };
}

// ---- the parent ----

interface Outcome {
  report: Report | undefined;
  exit: string;
  peakRssMegabytes: number;
  markers: Record<string, string>;
  canaryHits: number;
  leftoverPid: number | undefined;
}

function rssOf(pid: number): number {
  const output = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
  return Number(output.stdout.toString().trim()) || 0;
}

function commandOf(pid: number): string {
  return Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  }).stdout.toString();
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runProbe(
  command: string[],
  probe: string,
  config: Config,
  canaryFile: string,
  canaryUrl: string,
  hits: { count: number },
): Promise<Outcome> {
  const workDirectory = mkdtempSync(join(tmpdir(), `lampwarden-dwprobe-${probe}-`));
  hits.count = 0;
  const environment: Record<string, string> = {
    LAMPWARDEN_PIPELINE_DIRECTORY: PIPELINE_DIRECTORY,
    [CANARY_ENVIRONMENT_VARIABLE]: CANARY_SECRET,
  };
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const subprocess = Bun.spawn(
    [
      ...command,
      "--child",
      "--config",
      config,
      "--probe",
      probe,
      "--workdir",
      workDirectory,
      "--url",
      canaryUrl,
      "--canary-file",
      canaryFile,
    ],
    { env: environment, stdout: "pipe", stderr: "pipe" },
  );
  let peakRss = 0;
  const poll = setInterval(() => {
    peakRss = Math.max(peakRss, rssOf(subprocess.pid));
  }, 100);
  let killed = false;
  const killer = setTimeout(() => {
    killed = true;
    subprocess.kill("SIGKILL");
  }, 90_000);
  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  clearInterval(poll);
  clearTimeout(killer);
  await sleep(1500); // anything a probe left behind has had time to act
  const line = standardOutput
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  const markers: Record<string, string> = {};
  for (const marker of readdirSync(workDirectory)) {
    try {
      markers[marker] = readFileSync(join(workDirectory, marker), "utf8").slice(0, 200);
    } catch {
      markers[marker] = "";
    }
  }
  let leftoverPid: number | undefined;
  const pidFile = join(workDirectory, "at-pid");
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    // the file is written by the probe, so trust it only for a process that is the probe's own `sh -c ... at-ran`
    if (pid > 1 && processAlive(pid) && commandOf(pid).includes(join(workDirectory, "at-ran"))) {
      leftoverPid = pid;
      process.kill(pid, "SIGKILL");
    }
  }
  rmSync(workDirectory, { recursive: true, force: true });
  const crash = standardError.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return {
    report: line ? reportSchema.parse(JSON.parse(line)) : undefined,
    exit: killed ? "killed after 90 s" : exitCode === 0 ? "exit 0" : `exit ${exitCode}: ${crash.slice(0, 100)}`,
    peakRssMegabytes: megabytes(peakRss * 1024),
    markers,
    canaryHits: hits.count,
    leftoverPid,
  };
}

/** `no` (not reached), `YES` (reached) or `-` (the probe does not try). */
type Reach = "no" | "YES" | "-";

interface Verdict {
  /** The threat this probe stands for was contained (for the escape probes: the secret did not leak). */
  pass: boolean;
  secret: Reach;
  network: Reach;
  files: Reach;
  process: Reach;
  hostSurvived: boolean;
  nextRenderIdentical: boolean;
  note: string;
}

const ESCAPE_PROBES = [
  "bun-global",
  "escape-process",
  "env-fs-net",
  "env-constructor-chain",
  "import-builtins",
  "schedule-after",
  "schedule-at",
];

function judge(probe: string, outcome: Outcome): Verdict {
  const { report } = outcome;
  if (!report)
    return {
      pass: false,
      secret: "-",
      network: "-",
      files: "-",
      process: "-",
      hostSurvived: false,
      nextRenderIdentical: false,
      note: `host process did not finish: ${outcome.exit}`,
    };
  const error = report.error ?? "";
  const markerText = Object.entries(outcome.markers)
    .map(([name, text]) => `${name}=${text}`)
    .join(" ");
  const attempts = ESCAPE_PROBES.includes(probe);
  const secretSeen = (error + markerText).includes(CANARY_SECRET);
  const environReadable = outcome.markers["import-proc-environ"] === "canary-visible";
  const filesReached =
    /"fileSeen"|"wrote":true/.test(error) ||
    ["written-by-build", "import-fs-written", "import-fs-read", "after-timer", "after-promise"].some(
      (name) => name in outcome.markers,
    );
  const spawned =
    /"command":"|"spawned":true/.test(error) ||
    "at-ran" in outcome.markers ||
    outcome.leftoverPid !== undefined ||
    "at-pid" in outcome.markers;
  const flag = (reached: boolean): Reach => (attempts ? (reached ? "YES" : "no") : "-");
  const hostIntact = report.hostProblems.length === 0;
  const hostSurvived = true;
  const hostNote = `${hostIntact ? "host intrinsics intact" : `HOST INTRINSICS CHANGED (${report.hostProblems.join(", ")})`}; next render ${report.cleanIdentical ? "identical" : "DIFFERENT"}`;
  const detail = `${error.slice(0, 110)} [${report.renderMilliseconds} ms, rss ${report.rssBeforeMegabytes}->${outcome.peakRssMegabytes} MB peak, worker env keys ${report.environmentKeyCount}]`;
  const base = {
    secret: flag(secretSeen || environReadable),
    network: flag(outcome.canaryHits > 0),
    files: flag(filesReached),
    process: flag(spawned),
    hostSurvived,
    nextRenderIdentical: report.cleanIdentical,
  };
  const withinDeadline = report.renderMilliseconds < PROBE_DEADLINE_MILLISECONDS * 3;
  switch (probe) {
    case "bun-global":
    case "escape-process":
    case "env-fs-net":
    case "env-constructor-chain":
    case "import-builtins":
    case "schedule-after":
    case "schedule-at":
      return { ...base, pass: !secretSeen && !environReadable && hostIntact, note: `${hostNote}; ${detail}` };
    case "loop":
      return {
        ...base,
        pass: !report.ok && withinDeadline && hostIntact && report.cleanIdentical,
        note: `${report.ok ? "NOT STOPPED" : "stopped"}; ${hostNote}; ${detail}`,
      };
    case "regex-loop":
    case "stack-overflow":
      return {
        ...base,
        pass: withinDeadline && hostIntact && report.cleanIdentical,
        note: `${withinDeadline ? (report.ok ? "returned (no hang)" : "stopped") : "NOT STOPPED"}; ${hostNote}; ${detail}`,
      };
    case "memory":
    case "memory-objects":
    case "huge-error":
    case "huge-pixels":
    case "huge-stats": {
      const bounded =
        !report.ok &&
        !/never stopped/.test(error) &&
        outcome.peakRssMegabytes - report.rssBeforeMegabytes < 700 &&
        report.renderMilliseconds < 5000;
      return {
        ...base,
        pass: bounded && hostIntact && report.cleanIdentical,
        note: `${bounded ? "stopped and bounded" : "NOT BOUNDED"}; ${hostNote}; ${detail}`,
      };
    }
    case "throws":
      return {
        ...base,
        pass: !report.ok && /boom from build/.test(error) && hostIntact && report.cleanIdentical,
        note: `error reported; ${hostNote}; ${detail}`,
      };
    case "throws-object":
      return {
        ...base,
        pass: !report.ok && withinDeadline && hostIntact && report.cleanIdentical,
        note: `error reported; ${hostNote}; ${detail}`,
      };
    default:
      // prototype-pollution, kit-state: the render itself may succeed or fail; what matters is the host and the next render
      return { ...base, pass: hostIntact && report.cleanIdentical, note: `${hostNote}; ${detail}` };
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      child: { type: "boolean" },
      config: { type: "string" },
      probe: { type: "string" },
      workdir: { type: "string" },
      url: { type: "string" },
      "canary-file": { type: "string" },
      runtimes: { type: "string", default: "bun,node" },
      configs: { type: "string" },
      probes: { type: "string" },
      node: { type: "string", default: "node" },
      json: { type: "string" },
    },
  });
  if (values.child) {
    const { config, probe, workdir, url } = values;
    const canaryFile = values["canary-file"];
    if (!config || !isConfig(config) || !probe || !workdir || !url || !canaryFile)
      throw new Error("--child needs --config --probe --workdir --url --canary-file");
    console.log(JSON.stringify(await runChild(config, probe, workdir, url, canaryFile)));
    return;
  }
  const runtimes = (values.runtimes ?? "").split(",").filter(isRuntime);
  const configs = values.configs ? values.configs.split(",").filter(isConfig) : [...CONFIGS];
  const allProbes = readdirSync(PROBES_DIRECTORY)
    .filter((file) => file.endsWith(".js"))
    .map((file) => file.slice(0, -3))
    .sort();
  const probes = values.probes ? values.probes.split(",") : allProbes;
  const scratch = mkdtempSync(join(tmpdir(), "lampwarden-dwprobe-canary-"));
  const canaryFile = join(scratch, "canary.txt");
  writeFileSync(canaryFile, "canary-file-contents\n");
  const hits = { count: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      hits.count++;
      return new Response("canary");
    },
  });
  const canaryUrl = `http://127.0.0.1:${server.port}/canary`;
  const results: Record<string, Record<string, Verdict>> = {};
  try {
    const nodeBundle = runtimes.includes("node")
      ? await bundleForNode(join(PIPELINE_DIRECTORY, "probe-direct-worker.ts"), "probe-direct-worker.mjs")
      : "";
    for (const runtime of runtimes) {
      const command =
        runtime === "bun"
          ? [process.execPath, join(PIPELINE_DIRECTORY, "probe-direct-worker.ts")]
          : [values.node ?? "node", nodeBundle];
      for (const config of configs) {
        const key = `${runtime}/${config}`;
        results[key] = {};
        for (const probe of probes) {
          const outcome = await runProbe(command, probe, config, canaryFile, canaryUrl, hits);
          const verdict = judge(probe, outcome);
          const bucket = results[key];
          if (bucket) bucket[probe] = verdict;
          console.error(`${key} ${probe}: ${verdict.pass ? "pass" : "FAIL"}`);
        }
      }
    }
  } finally {
    await server.stop(true);
    rmSync(scratch, { recursive: true, force: true });
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
  for (const [key, byProbe] of Object.entries(results)) {
    console.log(`\n${key}`);
    for (const [probe, verdict] of Object.entries(byProbe))
      console.log(
        `  ${probe.padEnd(22)} ${verdict.pass ? "PASS" : "FAIL"}  secret ${verdict.secret} net ${verdict.network} files ${verdict.files} proc ${verdict.process}  ${verdict.note}`,
      );
  }
}

await main();
