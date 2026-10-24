// Measures what the runner's 4x magnified copy (`<name>_x4.png`, written by render/run_local.ts) costs, against rendering
// at 1x and magnifying on the host the way pipeline/verifier-image.ts does for the verifier.
//
// usage: bun --no-env-file pipeline/measure-x4.ts [--runs 10]
// For lamp-lit, house, satyr, temple (public/sprites/<id>.ts) and the male idle frame 1 (hero-animation.ts) it
//   1. renders `--runs` times with the copy and `--runs` times without (KIT_X4=0), through renderLocally, interleaved so
//      drift in the machine's load hits both alike, after one untimed warm-up of each; the wall time is the whole
//      subprocess (bun start, kit import, build, render, PNG writes), the render time is the runner's own `ms`;
//   2. runs the runner once directly to compare the copy's bytes and pixels with verifierImageBytes() of the 1x PNG,
//      and times verifierImageBytes() `--runs` times in this process (the host-side cost, paid with or without the copy).
// It prints markdown tables. No Mubit call, no network; the only subprocesses are the local runner.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodePng } from "../tools/logo/png";
import { heroFrameBuilds } from "./hero-animation";
import { renderLocally } from "./render-local";
import { verifierImageBytes } from "./verifier-image";

const SPRITE_DIRECTORY = join(import.meta.dir, "..", "public", "sprites");
const RENDER_DIRECTORY = join(import.meta.dir, "render");
const SPRITE_NAMES = ["lamp-lit", "house", "satyr", "temple"] as const;

const { values } = parseArgs({ options: { runs: { type: "string", default: "10" } } });
const RUNS = Number(values.runs);

interface Timings {
  wall: number[];
  render: number[];
}

interface Case {
  name: string;
  code: string;
}

const heroBuild = heroFrameBuilds("male", "idle")[0];
if (!heroBuild) throw new Error("no hero frame builds");
const cases: Case[] = [
  ...SPRITE_NAMES.map((name) => ({ name, code: readFileSync(join(SPRITE_DIRECTORY, `${name}.ts`), "utf8") })),
  { name: "hero-idle1", code: heroBuild.code },
];

const mean = (numbers: number[]) => numbers.reduce((total, value) => total + value, 0) / numbers.length;
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const fixed = (value: number, digits = 1) => value.toFixed(digits);

async function renderOnce(testCase: Case, writeMagnifiedCopy: boolean): Promise<{ wall: number; render: number }> {
  const start = performance.now();
  const result = await renderLocally(
    { code: testCase.code, name: testCase.name, pose: "" },
    { writeMagnifiedCopy, timeoutMilliseconds: 120_000 },
  );
  const wall = performance.now() - start;
  if (!result.ok) throw new Error(`${testCase.name}: ${result.error}`);
  return { wall, render: result.stats.ms ?? 0 };
}

/** Runs the runner directly with the copy on, and returns the bytes it wrote. */
async function runnerOutputs(testCase: Case): Promise<{ sprite: Buffer; magnified: Buffer }> {
  const workDirectory = mkdtempSync(join(tmpdir(), "lampwarden-x4-"));
  try {
    const sourcePath = join(workDirectory, "build.ts");
    writeFileSync(sourcePath, `${testCase.code}\n`);
    const subprocess = Bun.spawn(
      ["bun", "--preload", "./shim_plugin.ts", "run_local.ts", sourcePath, testCase.name, ""],
      {
        cwd: RENDER_DIRECTORY,
        env: { KIT_OUT: workDirectory, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
        stdout: "ignore",
        stderr: "inherit",
      },
    );
    if ((await subprocess.exited) !== 0) throw new Error(`${testCase.name}: runner failed`);
    return {
      sprite: readFileSync(join(workDirectory, `${testCase.name}.png`)),
      magnified: readFileSync(join(workDirectory, `${testCase.name}_x4.png`)),
    };
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function differingPixels(first: Uint8Array, second: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < first.length; index += 4) {
    for (let channel = 0; channel < 4; channel++)
      if (first[index + channel] !== second[index + channel]) {
        count++;
        break;
      }
  }
  return count;
}

console.log(`${RUNS} renders per case and mode, bun ${Bun.version}, ${process.platform}/${process.arch}\n`);
console.log(
  "| sprite | wall with x4 (ms) | wall without (ms) | saved per render (ms) | saved (%) | runner `ms` with | runner `ms` without |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
const savedPerCase: number[] = [];
for (const testCase of cases) {
  await renderOnce(testCase, true);
  await renderOnce(testCase, false);
  const withCopy: Timings = { wall: [], render: [] };
  const without: Timings = { wall: [], render: [] };
  for (let run = 0; run < RUNS; run++) {
    // alternate which mode goes first
    for (const writeMagnifiedCopy of run % 2 ? [false, true] : [true, false]) {
      const measured = await renderOnce(testCase, writeMagnifiedCopy);
      const bucket = writeMagnifiedCopy ? withCopy : without;
      bucket.wall.push(measured.wall);
      bucket.render.push(measured.render);
    }
  }
  const saved = median(withCopy.wall) - median(without.wall);
  savedPerCase.push(saved);
  console.log(
    `| ${testCase.name} | ${fixed(median(withCopy.wall))} (mean ${fixed(mean(withCopy.wall))}) | ${fixed(median(without.wall))} (mean ${fixed(mean(without.wall))}) | ${fixed(saved)} | ${fixed((saved / median(withCopy.wall)) * 100)} | ${fixed(median(withCopy.render), 0)} | ${fixed(median(without.render), 0)} |`,
  );
}
console.log(
  `\nmedian wall times; the copy costs ${fixed(mean(savedPerCase))} ms per render on average over the cases\n`,
);

console.log(
  "| sprite | 128 px PNG (bytes) | _x4 PNG (bytes) | verifier image (bytes) | _x4 vs verifier image: differing pixels of 262144 | verifierImageBytes() on the host (ms, median: decode, magnify, encode) |",
);
console.log("| --- | --- | --- | --- | --- | --- |");
for (const testCase of cases) {
  const { sprite, magnified } = await runnerOutputs(testCase);
  const verifierBytes = verifierImageBytes(sprite);
  const differing = differingPixels(decodePng(magnified).data, decodePng(Buffer.from(verifierBytes)).data);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    verifierImageBytes(sprite);
    times.push(performance.now() - start);
  }
  console.log(
    `| ${testCase.name} | ${sprite.length} | ${magnified.length} | ${verifierBytes.length} | ${differing} | ${fixed(median(times))} |`,
  );
}
