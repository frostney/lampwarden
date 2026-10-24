// Which kit builders animate? Renders every creature-capable builder (the body plans pipeline/prompts/creature.md steers
// briefs to) in the same set of poses, with the direct-worker renderer, measures how much each pose moves the picture
// away from the standing one, and writes enlarged contact sheets. Measurement only; docs/LIVE_GENERATION.md, "Direct
// execution in a worker", reports the result.
//
// usage: bun pipeline/pose-check.ts [--out DIR]   (default /tmp/lampwarden-pose-check; writes pose-<group>.png sheets
//        and pose-check.json, and prints one line per builder)
//
// A builder "animates" when its idle, walk and attack frames differ from each other. The sprites are drawn with
// `noScale`, as the hero's frames are, so the kit's fit-to-frame scaling cannot hide or fake movement.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { createDirectWorkerRenderer } from "./render-direct-worker";

const POSES = ["idle1", "idle3", "walk1", "walk3", "walk5", "attack1", "attack3", "attack5", "hurt", "death"] as const;
const ENLARGEMENT = 2;
const CELL = 128 * ENLARGEMENT;

interface Builder {
  name: string;
  group: "humanoids" | "beasts" | "others";
  /** The call, with POSE standing for the pose name. */
  call: string;
}

const BUILDERS: Builder[] = [
  {
    name: "humanoid (spear)",
    group: "humanoids",
    call: "humanoid(k, {facing:20, pose:POSE, weapon:'spear', build:'average'})",
  },
  {
    name: "humanoid (sword + shield)",
    group: "humanoids",
    call: "humanoid(k, {facing:20, pose:POSE, weapon:'sword', shield:'hoplon'})",
  },
  { name: "humanoid (bow)", group: "humanoids", call: "humanoid(k, {facing:20, pose:POSE, weapon:'bow'})" },
  {
    name: "humanoid (unarmed skeleton)",
    group: "humanoids",
    call: "humanoid(k, {facing:20, pose:POSE, head:{type:'skull'}, skin:'bone'})",
  },
  {
    name: "humanoid (lamia, serpent tail)",
    group: "humanoids",
    call: "humanoid(k, {facing:20, pose:POSE, gender:'female', head:{type:'gorgon'}, legs:{lower:'serpent'}, weapon:'trident'})",
  },
  { name: "spartan", group: "humanoids", call: "spartan(k, {pose:POSE})" },
  { name: "cyclops", group: "humanoids", call: "cyclops(k, {pose:POSE})" },
  { name: "minotaur", group: "humanoids", call: "minotaur(k, {pose:POSE})" },
  { name: "satyr", group: "humanoids", call: "satyr(k, {pose:POSE})" },
  { name: "harpy", group: "humanoids", call: "harpy(k, {pose:POSE})" },
  {
    name: "winged (bat wings)",
    group: "humanoids",
    call: "winged(k, {pose:POSE, facing:20, weapon:'spear', wings:{type:'bat'}, span:14})",
  },
  {
    name: "hero",
    group: "humanoids",
    call: "hero(k, {sex:'male', melee:'xiphos', ranged:'bow', pose:POSE, facing:-45})",
  },
  { name: "quadruped horse", group: "beasts", call: "quadruped(k, {kind:'horse', pose:POSE})" },
  { name: "quadruped lion", group: "beasts", call: "quadruped(k, {kind:'lion', pose:POSE})" },
  { name: "quadruped bull", group: "beasts", call: "quadruped(k, {kind:'bull', pose:POSE})" },
  { name: "quadruped dog", group: "beasts", call: "quadruped(k, {kind:'dog', pose:POSE})" },
  { name: "quadruped boar", group: "beasts", call: "quadruped(k, {kind:'boar', pose:POSE})" },
  { name: "quadruped goat", group: "beasts", call: "quadruped(k, {kind:'goat', pose:POSE})" },
  { name: "centaur (spear)", group: "beasts", call: "centaur(k, {pose:POSE, upper:{weapon:'spear'}})" },
  { name: "hydra (3 heads)", group: "others", call: "hydra(k, {heads:3, pose:POSE})" },
  { name: "hydra (5 heads)", group: "others", call: "hydra(k, {heads:5, pose:POSE})" },
];

function buildCode(builder: Builder, pose: string): string {
  return `function build(k) {\n  k.noScale = true;\n  ${builder.call.replace("POSE", JSON.stringify(pose))};\n}\n`;
}

function differingPixels(first: Uint8Array, second: Uint8Array): number {
  let differing = 0;
  for (let offset = 0; offset < first.length; offset += 4)
    if (
      first[offset] !== second[offset] ||
      first[offset + 1] !== second[offset + 1] ||
      first[offset + 2] !== second[offset + 2] ||
      first[offset + 3] !== second[offset + 3]
    )
      differing++;
  return differing;
}

/** Pastes the 128 px frame into the sheet at the cell, enlarged with nearest-neighbour. */
function paste(sheet: PixelImage, pixels: Uint8Array, column: number, row: number): void {
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const source = (y * 128 + x) * 4;
      const color = [
        pixels[source] ?? 0,
        pixels[source + 1] ?? 0,
        pixels[source + 2] ?? 0,
        pixels[source + 3] ?? 0,
      ] as const;
      // flat grey backdrop so the transparent pixels read
      const alpha = color[3] / 255;
      const blended = [0, 1, 2].map((channel) => Math.round((color[channel] ?? 0) * alpha + 58 * (1 - alpha)));
      for (let offsetY = 0; offsetY < ENLARGEMENT; offsetY++)
        for (let offsetX = 0; offsetX < ENLARGEMENT; offsetX++) {
          const target =
            ((row * CELL + y * ENLARGEMENT + offsetY) * sheet.width + column * CELL + x * ENLARGEMENT + offsetX) * 4;
          sheet.data.set([blended[0] ?? 0, blended[1] ?? 0, blended[2] ?? 0, 255], target);
        }
    }
}

const { values } = parseArgs({ options: { out: { type: "string", default: "/tmp/lampwarden-pose-check" } } });
const outputDirectory = resolve(values.out ?? "/tmp/lampwarden-pose-check");
mkdirSync(outputDirectory, { recursive: true });

const renderer = createDirectWorkerRenderer({ poolSize: 2 });
const report: Record<string, unknown> = {};
const sheets = new Map<string, { image: PixelImage; rows: string[] }>();
try {
  for (const builder of BUILDERS) {
    const frames = new Map<string, Uint8Array>();
    const errors: string[] = [];
    for (const pose of POSES) {
      const result = await renderer.render({ code: buildCode(builder, pose), name: "pose", pose: "" });
      if (result.ok) frames.set(pose, decodePng(Buffer.from(result.png)).data);
      else errors.push(`${pose}: ${result.error}`);
    }
    const distance = (first: string, second: string) => {
      const left = frames.get(first);
      const right = frames.get(second);
      return left && right ? differingPixels(left, right) : -1;
    };
    // how far each pose moves the picture away from the standing one (idle1), in pixels
    const fromStanding = Object.fromEntries(POSES.map((pose) => [pose, distance("idle1", pose)]));
    const walkSteps = Math.min(distance("walk1", "walk3"), distance("walk3", "walk5"));
    const attackSteps = Math.min(distance("attack1", "attack3"), distance("attack3", "attack5"));
    report[builder.name] = {
      fromStanding,
      idleBreath: distance("idle1", "idle3"),
      walkSteps,
      attackSteps,
      errors,
    };
    console.log(
      `${builder.name.padEnd(34)} idle1->idle3 ${String(distance("idle1", "idle3")).padStart(5)}  walk1->3->5 ${String(walkSteps).padStart(5)}  attack1->3->5 ${String(attackSteps).padStart(5)}  hurt ${String(fromStanding.hurt).padStart(5)}  death ${String(fromStanding.death).padStart(5)}${errors.length ? `  ERRORS ${errors.join("; ")}` : ""}`,
    );
    let sheet = sheets.get(builder.group);
    if (!sheet) {
      const rows = BUILDERS.filter((candidate) => candidate.group === builder.group).map((candidate) => candidate.name);
      sheet = { image: new PixelImage(POSES.length * CELL, rows.length * CELL), rows };
      sheets.set(builder.group, sheet);
    }
    const row = sheet.rows.indexOf(builder.name);
    POSES.forEach((pose, column) => {
      const pixels = frames.get(pose);
      if (pixels) paste(sheet.image, pixels, column, row);
    });
  }
} finally {
  await renderer.close();
}
for (const [group, sheet] of sheets) writeFileSync(join(outputDirectory, `pose-${group}.png`), encodePng(sheet.image));
writeFileSync(
  join(outputDirectory, "pose-check.json"),
  `${JSON.stringify({ poses: POSES, rows: Object.fromEntries([...sheets].map(([group, sheet]) => [group, sheet.rows])), report }, null, 2)}\n`,
);
console.log(`\nsheets in ${outputDirectory}: ${[...sheets.keys()].map((group) => `pose-${group}.png`).join(", ")}`);
