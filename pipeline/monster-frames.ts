// Regenerates the hand-made monsters' animation frames: for the satyr, the cyclops and the harpy, one atlas
// (public/sprites/<kind>-frames.png) of the five drawn directions (src/scene/assets.ts mirrors the other three) and every
// frame of idle, walk and attack, laid out as a live creature's atlas is (src/game/creature-frames.ts). They are drawn from
// the committed sprite code (public/sprites/<kind>.ts) by the same frame set the live creature job renders
// (creature-frames.ts): one sandbox batch of 75 frames a monster, checked (every frame renders and is a figure, the walk
// moves from every side, the sides differ), each frame slid along its cell when its figure reaches the edge and the figure
// drawn smaller, all frames alike, when one is too big for its cell. The canvas each atlas was drawn on and how far each
// frame was slid go to src/scene/monster-frames.json, which the game reads and `bun run check:pixels` reproduces every
// frame from. A monster that cannot be drawn from every side fails the run, and nothing is written.
// Needs Vercel auth and VERCEL_SANDBOX_SNAPSHOT_ID (docs/tooling.md, "Rendering needs Vercel auth").
// usage: bun --no-env-file pipeline/monster-frames.ts [--vcpus 8]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { SHEET_KINDS } from "../src/scene/monster-sheets";
import { canvasOfStill, renderFrameSet } from "./creature-frames";
import { MONSTER_FRAMES_FILE, monsterAtlasFile, monsterCodePath } from "./monster-source";
import { renderBatchFromCheckout } from "./render-checkout";

const { values } = parseArgs({ options: { vcpus: { type: "string", default: "8" } } });
const vcpus = Number(values.vcpus);

const codes = SHEET_KINDS.map((kind) => ({ kind, code: readFileSync(monsterCodePath(kind), "utf8") }));

// the stills, drawn as the game's sprites were, tell which canvas each monster's frames are drawn on
const stills = await renderBatchFromCheckout(
  codes.map(({ kind, code }) => ({ code, name: kind, pose: "" })),
  { vcpus: 4 },
);

const written = await Promise.all(
  codes.map(async ({ kind, code }, index) => {
    const still = stills[index];
    if (!still?.ok) throw new Error(`${kind}: its still did not render: ${still?.error ?? "no result"}`);
    const started = performance.now();
    const set = await renderFrameSet(
      (requests) => renderBatchFromCheckout(requests, { vcpus }),
      code,
      canvasOfStill(still.stats),
    );
    if (!set.ok) throw new Error(`${kind}: ${set.kind}: ${set.reason}`);
    if (!set.frames.directions)
      throw new Error(`${kind} could not be drawn from every side (${set.earlier.join(", ")})`);
    return { kind, set, seconds: (performance.now() - started) / 1000 };
  }),
);

const recorded: Record<string, { canvas: { scale: number; dx: number; dy: number }; shifts: Array<[number, number]> }> =
  {};
for (const { kind, set, seconds } of written) {
  writeFileSync(monsterAtlasFile(kind), set.atlas);
  recorded[kind] = { canvas: set.canvas, shifts: set.frames.shifts ?? Array.from({ length: 75 }, () => [0, 0]) };
  const slid = (set.frames.shifts ?? []).filter(([across, down]) => across !== 0 || down !== 0).length;
  console.log(
    `wrote ${monsterAtlasFile(kind)} (${set.atlas.length} bytes, ${set.batches} batch${set.batches === 1 ? "" : "es"} in ${seconds.toFixed(1)} s, canvas scale ${set.canvas.scale.toFixed(3)} shift ${set.canvas.dx},${set.canvas.dy}, ${slid} frames slid)`,
  );
}
writeFileSync(MONSTER_FRAMES_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
console.log(`wrote ${MONSTER_FRAMES_FILE}`);
