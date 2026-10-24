// Runs hostile-looking JavaScript build probes (pipeline/inprocess_eval/probes/*.js) through the in-process renderers and
// reports, for each probe, what happened and whether the host process and the next render were unaffected.
//
// usage: bun pipeline/probe-inprocess.ts [--runtimes bun,node] [--modes node-vm,quickjs] [--probes a,b]
//          [--node PATH] [--json FILE]
//        bun pipeline/probe-inprocess.ts --control      (does a reused QuickJS context carry a polluting build over?)
//
// Every (runtime, mode, probe) runs in its own disposable child process, started with an allowlisted environment plus one
// canary variable that stands for a secret. The parent owns a canary file, a marker directory and a canary HTTP server on
// 127.0.0.1, so what a probe reaches is observable: a leaked secret, a file read or written, a request, a process left
// behind. Probes run only under a renderer that is supposed to contain them, in a child the parent can kill. Nothing here
// touches the network beyond 127.0.0.1, and the only command a probe runs is `id -un` and a `sleep`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { decodePng } from "../tools/logo/png";
import { bundleForNode } from "./bundle-for-node";
import { plainJavaScript } from "./render-inprocess-shared";
import type { Renderer } from "./render-types";

const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const PROBES_DIRECTORY = join(PIPELINE_DIRECTORY, "inprocess_eval", "probes");
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const CANARY_ENVIRONMENT_VARIABLE = "LAMPWARDEN_CANARY_SECRET";
const CANARY_SECRET = "canary-not-a-secret";
const PROBE_TIMEOUT_MILLISECONDS = 1500;
const MODES = ["node-vm", "quickjs"] as const;
type Mode = (typeof MODES)[number];
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
});
type Report = z.infer<typeof reportSchema>;

function isMode(value: string): value is Mode {
  return MODES.some((mode) => mode === value);
}

function isRuntime(value: string): value is RuntimeName {
  return RUNTIMES.some((runtime) => runtime === value);
}

function rendererFor(mode: Mode): Promise<Renderer> {
  switch (mode) {
    case "node-vm":
      return import("./render-inprocess-vm").then((module) =>
        module.createNodeVmRenderer({ timeoutMilliseconds: PROBE_TIMEOUT_MILLISECONDS, allowHostileProbeCode: true }),
      );
    case "quickjs":
      return import("./render-inprocess-quickjs").then((module) =>
        module.createQuickJsRenderer({ timeoutMilliseconds: PROBE_TIMEOUT_MILLISECONDS }),
      );
  }
}

const megabytes = (bytes: number) => Math.round(bytes / 1048576);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What a probe changed in the host's own intrinsics, if anything. */
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

/** The child: one probe through one renderer, then an idle wait, an integrity check and a clean render. */
async function runChild(
  mode: Mode,
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
  const render = await rendererFor(mode);
  // load everything a later render needs before the probe runs, so a probe that breaks the host cannot hide behind a lazy import
  const clean = plainJavaScript(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8"));
  const committed = decodePng(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"))).data;
  await render({ code: clean, name: "lamp-lit", pose: "" });
  const rssBeforeMegabytes = megabytes(process.memoryUsage().rss);
  const start = performance.now();
  const result = await render({ code, name: "probe", pose: "" });
  const renderMilliseconds = Math.round(performance.now() - start);
  const rssAfterMegabytes = megabytes(process.memoryUsage().rss);
  const cpuBefore = process.cpuUsage();
  await sleep(1500);
  const cpuAfter = process.cpuUsage(cpuBefore);
  const problems = hostProblems();
  const after = await render({ code: clean, name: "lamp-lit", pose: "" });
  const cleanIdentical = after.ok && differingPixels(decodePng(Buffer.from(after.png)).data, committed) === 0;
  return {
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
    renderMilliseconds,
    rssBeforeMegabytes,
    rssAfterMegabytes,
    idleCpuMilliseconds: Math.round((cpuAfter.user + cpuAfter.system) / 1000),
    hostProblems: problems,
    cleanIdentical,
    ...(after.ok ? {} : { cleanError: after.error }),
  };
}

/** Control: the same polluting build in a reused QuickJS context changes the next render; a fresh context does not. */
async function runControl(): Promise<void> {
  const { default: variant } = await import("@jitl/quickjs-wasmfile-release-sync");
  const { newQuickJSWASMModuleFromVariant } = await import("quickjs-emscripten-core");
  const shared = await import("./quickjs-core");
  const { PREPARED_KIT } = await import("./prepared-kit");
  const { createQuickJsRenderer } = await import("./render-inprocess-quickjs");
  const polluting = readFileSync(join(PROBES_DIRECTORY, "kit-state.js"), "utf8");
  const clean = plainJavaScript(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.ts"), "utf8"));
  const committed = decodePng(readFileSync(join(SPRITES_DIRECTORY, "lamp-lit.png"))).data;
  const kit = PREPARED_KIT;
  const quickJs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickJs.newRuntime();
  const context = runtime.newContext();
  try {
    context.unwrapResult(context.evalCode(shared.kitScript(kit))).dispose();
    const runBuild = (source: string) => {
      const output = context.unwrapResult(context.evalCode(shared.runScript(kit, shared.prepareBuild(source), "")));
      const pixelsHandle = context.getProp(output, "pixels");
      const view = context.getArrayBuffer(pixelsHandle);
      const pixels = view.value.slice();
      view.dispose();
      pixelsHandle.dispose();
      output.dispose();
      return pixels;
    };
    runBuild(polluting);
    const reused = runBuild(clean);
    console.log(
      `reused context: clean lamp-lit after kit-state.js differs from the committed sprite in ${differingPixels(reused, committed)} pixels`,
    );
  } finally {
    context.dispose();
    runtime.dispose();
  }
  const render = createQuickJsRenderer();
  await render({ code: polluting, name: "probe", pose: "" });
  const fresh = await render({ code: clean, name: "lamp-lit", pose: "" });
  console.log(
    `fresh context per render: clean lamp-lit after kit-state.js differs in ${fresh.ok ? differingPixels(decodePng(Buffer.from(fresh.png)).data, committed) : "render failed"} pixels`,
  );
}

// ---- the parent ----

interface Outcome {
  report: Report | undefined;
  exit: string;
  peakRssMegabytes: number;
  markers: string[];
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
  mode: Mode,
  canaryFile: string,
  canaryUrl: string,
  hits: { count: number },
): Promise<Outcome> {
  const workDirectory = mkdtempSync(join(tmpdir(), `lampwarden-probe-${probe}-`));
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
      "--mode",
      mode,
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
  const markers = readdirSync(workDirectory);
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

interface Verdict {
  pass: boolean;
  note: string;
}

function judge(probe: string, outcome: Outcome): Verdict {
  const { report } = outcome;
  if (!report) return { pass: false, note: `host process did not finish: ${outcome.exit}` };
  const error = report.error ?? "";
  const hostIntact = report.hostProblems.length === 0 && report.cleanIdentical;
  const hostNote = hostIntact
    ? "host and next render unaffected"
    : `HOST AFFECTED (${report.hostProblems.join(", ") || "next render differs"})`;
  const reachedHost = /"reached":\[[^\]]+\]|"host":true/.test(error);
  const effects = [
    ...outcome.markers.map((marker) => `marker ${marker}`),
    ...(outcome.canaryHits ? [`${outcome.canaryHits} canary request(s)`] : []),
    ...(outcome.leftoverPid ? ["process left running"] : []),
    ...(report.idleCpuMilliseconds > 250 ? [`${report.idleCpuMilliseconds} ms CPU after the render returned`] : []),
    ...(/secretSeen":"canary/.test(error) ? ["secret read"] : []),
    ...(/fileSeen/.test(error) ? ["canary file read"] : []),
  ];
  const detail = `${error.slice(0, 110)} [${report.renderMilliseconds} ms, rss ${report.rssBeforeMegabytes}->${outcome.peakRssMegabytes} MB peak]`;
  switch (probe) {
    case "escape-process":
    case "env-fs-net":
    case "schedule-after":
    case "schedule-at": {
      const contained = !reachedHost && effects.length === 0;
      return {
        pass: contained && hostIntact,
        note: `${contained ? "contained" : `ESCAPED: ${effects.join(", ") || "host process reached"}`}; ${hostNote}; ${detail}`,
      };
    }
    case "loop": {
      const stopped = !report.ok && report.renderMilliseconds < PROBE_TIMEOUT_MILLISECONDS * 3;
      return { pass: stopped && hostIntact, note: `${stopped ? "stopped" : "NOT STOPPED"}; ${hostNote}; ${detail}` };
    }
    case "regex-loop":
    case "stack-overflow": {
      // an engine may end the probe itself (a backtracking limit, a stack limit); what matters is that the host was not held up
      const returned = report.renderMilliseconds < PROBE_TIMEOUT_MILLISECONDS * 3;
      return {
        pass: returned && hostIntact,
        note: `${returned ? (report.ok ? "returned (no hang)" : "stopped") : "NOT STOPPED"}; ${hostNote}; ${detail}`,
      };
    }
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
        pass: bounded && hostIntact,
        note: `${bounded ? "stopped and bounded" : "NOT BOUNDED"}; ${hostNote}; ${detail}`,
      };
    }
    case "throws":
      return {
        pass: !report.ok && /boom from build/.test(error) && hostIntact,
        note: `error reported; ${hostNote}; ${detail}`,
      };
    case "throws-object":
      return {
        pass: !report.ok && report.renderMilliseconds < PROBE_TIMEOUT_MILLISECONDS * 3 && hostIntact,
        note: `error reported; ${hostNote}; ${detail}`,
      };
    default:
      // prototype-pollution, kit-state: the render itself may succeed or fail; what matters is the host and the next render
      return { pass: hostIntact, note: `${hostNote}; ${detail}` };
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      child: { type: "boolean" },
      control: { type: "boolean" },
      mode: { type: "string" },
      probe: { type: "string" },
      workdir: { type: "string" },
      url: { type: "string" },
      "canary-file": { type: "string" },
      runtimes: { type: "string", default: "bun,node" },
      modes: { type: "string" },
      probes: { type: "string" },
      node: { type: "string", default: "node" },
      json: { type: "string" },
    },
  });
  if (values.control) {
    await runControl();
    return;
  }
  if (values.child) {
    const { mode, probe, workdir, url } = values;
    const canaryFile = values["canary-file"];
    if (!mode || !isMode(mode) || !probe || !workdir || !url || !canaryFile)
      throw new Error("--child needs --mode --probe --workdir --url --canary-file");
    console.log(JSON.stringify(await runChild(mode, probe, workdir, url, canaryFile)));
    return;
  }
  const runtimes = (values.runtimes ?? "").split(",").filter(isRuntime);
  const modes = values.modes ? values.modes.split(",").filter(isMode) : [...MODES];
  const allProbes = readdirSync(PROBES_DIRECTORY)
    .filter((file) => file.endsWith(".js"))
    .map((file) => file.slice(0, -3))
    .sort();
  const probes = values.probes ? values.probes.split(",") : allProbes;
  const scratch = mkdtempSync(join(tmpdir(), "lampwarden-probe-canary-"));
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
      ? await bundleForNode(join(PIPELINE_DIRECTORY, "probe-inprocess.ts"), "probe-inprocess.mjs")
      : "";
    for (const runtime of runtimes) {
      const command =
        runtime === "bun"
          ? [process.execPath, join(PIPELINE_DIRECTORY, "probe-inprocess.ts")]
          : [values.node ?? "node", "--no-node-snapshot", nodeBundle];
      for (const mode of modes) {
        const key = `${runtime}/${mode}`;
        results[key] = {};
        for (const probe of probes) {
          const outcome = await runProbe(command, probe, mode, canaryFile, canaryUrl, hits);
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
      console.log(`  ${probe.padEnd(18)} ${verdict.pass ? "PASS" : "FAIL"}  ${verdict.note}`);
  }
}

await main();
