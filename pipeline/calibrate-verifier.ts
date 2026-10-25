// Scores our own committed art with the verifier exactly as the creature job does (same prompt, same message, the
// borderline double-take), so the acceptance bar can be set against it: the score that most of our own sprites reach.
//
// usage: bun run calibrate:verifier -- [--out scores.json]
//        [--repeat 1] [--concurrency 4]
// Every sprite is re-rendered from its committed build code, all of them in one Vercel Sandbox batch (the PNG is
// byte-identical to the committed one), so the verifier gets the same engine stats it would in a job. Needs Vercel auth
// (docs/tooling.md, "Rendering needs Vercel auth"). Costs about one verifier call per sprite and repeat.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { heroFrameBuilds } from "./hero-animation";
import { type LoopCore, verify } from "./loop";
import { createMubitClient } from "./mubit";
import { renderBatchFromCheckout } from "./render-checkout";

const PIPELINE_DIRECTORY = import.meta.dir;
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const manifestSchema = z.object({ sprites: z.record(z.string(), z.object({ brief: z.string(), code: z.string() })) });

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
  },
});
const apiKey = process.env.MUBIT_API_KEY;
if (!apiKey) {
  throw new Error("MUBIT_API_KEY is not set");
}

interface Item {
  name: string;
  brief: string;
  code: string;
}

const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(SPRITES_DIRECTORY, "manifest.json"), "utf8")));
const items: Item[] = Object.entries(manifest.sprites).map(([name, row]) => ({
  name,
  brief: row.brief,
  code: readFileSync(join(SPRITES_DIRECTORY, row.code), "utf8"),
}));
// a few hero animation frames too: a character in motion, a weapon swing
for (const [sex, animation, frame, brief] of [
  ["male", "walk", 2, "male hero warrior walking with a xiphos and a bow on his back"],
  ["female", "melee", 2, "female hero warrior mid-swing with a spear, sling at her hip"],
  ["male", "idle", 0, "male hero warrior standing at ease"],
] as const) {
  const build = heroFrameBuilds(sex, animation)[frame];
  if (build) {
    items.push({ name: build.name, brief, code: build.code });
  }
}

const loop: LoopCore = {
  model: createMubitClient({ apiKey }),
  render: async () => ({ ok: false, error: "not used" }),
  pose: "",
  generatorPrompt: "",
  verifierPrompt: readFileSync(join(PIPELINE_DIRECTORY, "prompts", "verifier.md"), "utf8"),
  store: { logCall: () => {}, saveAttemptCode: () => {}, saveAttemptPng: () => {} },
  print: () => {},
};

const requests = items.map((item) => ({
  code: item.code,
  name: item.name.replace(/[^A-Za-z0-9_-]/g, "-"),
  pose: "",
}));
const renders = await renderBatchFromCheckout(requests, { vcpus: 4 });

const results: Array<{ name: string; scores: Array<number | null>; flags: string }> = [];
const queue = items.entries();
const worker = async () => {
  for (let step = queue.next(); !step.done; step = queue.next()) {
    const [position, item] = step.value;
    const rendered = renders[position];
    if (!rendered?.ok) {
      results.push({ name: item.name, scores: [], flags: rendered?.error ?? "no render" });
      continue;
    }
    const scores = await Promise.all(
      Array.from({ length: Number(values.repeat) }, async (_unused, repeat) => {
        const { verdict } = await verify(
          loop,
          rendered.png,
          item.brief,
          item.code,
          rendered.stats,
          `calibrate-${item.name}-${repeat}`,
          {},
        );
        return verdict.score;
      }),
    );
    results.push({ name: item.name, scores, flags: rendered.stats.flags });
    console.log(item.name.padEnd(20), scores.join(" ").padEnd(14), rendered.stats.flags);
  }
};
await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

const all = results.flatMap((result) => result.scores).filter((score): score is number => score !== null);
all.sort((first, second) => first - second);
const reaching = (bar: number) => all.filter((score) => score >= bar).length / all.length;
console.log(`\n${all.length} scores, min ${all[0]}, median ${all[Math.floor(all.length / 2)]}, max ${all.at(-1)}`);
for (const bar of [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8]) {
  console.log(`share at or above ${bar}: ${(100 * reaching(bar)).toFixed(0)}%`);
}
if (values.out) {
  writeFileSync(values.out, `${JSON.stringify(results, null, 1)}\n`);
}
