// Balance report from recorded plays (the private Blob store behind /api/plays).
// usage: bun run plays -- [--since 2026-10-24] [--build abc1234] [--verify]
//   needs BLOB_READ_WRITE_TOKEN (vercel env pull .env.local); `bun run plays` runs this under `varlock run` and hands it
//   that variable only. --verify replays the finished nights recorded on this checkout's sim (tools/sim-fingerprint) and checks each ends the same; nights from another sim version are counted, not replayed.
import { join } from "node:path";
import { get, list } from "@vercel/blob";
import { replaysExactlyOn } from "../src/game/plays";
import type { Play } from "../src/game/recording";
import { verifyPlay } from "../src/game/replay";
import { simFingerprint } from "../tools/sim-fingerprint/sim-fingerprint";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const since = argument("--since");
const build = argument("--build");
const shouldVerify = process.argv.includes("--verify");
const runningSim = simFingerprint(join(import.meta.dir, ".."));
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN is not set (vercel env pull .env.local)");
  process.exit(1);
}

const paths: string[] = [];
let cursor: string | undefined;
do {
  const page = await list({ prefix: "plays/", token, ...(cursor ? { cursor } : {}) });
  paths.push(...page.blobs.map((blob) => blob.pathname).filter((path) => !since || path.slice(6, 16) >= since));
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

const plays: Play[] = [];
for (const path of paths) {
  const blob = await get(path, { access: "private", token });
  if (blob?.statusCode !== 200) continue;
  const play: Play = JSON.parse(await new Response(blob.stream).text());
  if (!build || play.build === build) plays.push(play);
}
if (!plays.length) {
  console.log("no plays");
  process.exit(0);
}

const percent = (count: number, total: number) => `${total ? Math.round((100 * count) / total) : 0}%`;
const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const seconds = (play: Play) => play.steps / 60;
// kills per real minute of the night, as rulesTide reads them (no floor of a minute: every night before the seventh is
// shorter than one, and a floor would read a night's kills)
const killsPerMinute = (play: Play) => play.stats.kills / Math.max(1 / 60, seconds(play) / 60);

console.log(
  `${plays.length} nights from ${new Set(plays.map((play) => play.session)).size} players, ${(plays.reduce((total, play) => total + seconds(play), 0) / 60).toFixed(1)} min played`,
);
const countBy = (key: (play: Play) => string) => {
  const counts = new Map<string, number>();
  for (const play of plays) {
    const name = key(play);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => `${name} (${count})`).join(", ");
};
console.log(`builds: ${countBy((play) => play.build)}`);
console.log(`sim versions (this checkout: ${runningSim}): ${countBy((play) => play.sim ?? "unknown")}\n`);
console.log("night  plays  dawn   dark   fallen  quit   avg len  kills/min  lamps lost  hp lost  tide");
const nights = [...new Set(plays.map((play) => play.legacy.night))].sort((first, second) => first - second);
for (const night of nights) {
  const nightPlays = plays.filter((play) => play.legacy.night === night);
  const ending = (outcome: string | null) => nightPlays.filter((play) => play.outcome === outcome).length;
  console.log(
    [
      String(night).padEnd(6),
      String(nightPlays.length).padEnd(6),
      percent(ending("dawn"), nightPlays.length).padEnd(6),
      percent(ending("dark"), nightPlays.length).padEnd(6),
      percent(ending("fallen"), nightPlays.length).padEnd(7),
      percent(ending(null), nightPlays.length).padEnd(6),
      `${average(nightPlays.map(seconds)).toFixed(0)} s`.padEnd(8),
      average(nightPlays.map(killsPerMinute)).toFixed(1).padEnd(10),
      average(nightPlays.map((play) => play.stats.lampsLost))
        .toFixed(1)
        .padEnd(11),
      average(nightPlays.map((play) => play.stats.hpLost))
        .toFixed(0)
        .padEnd(8),
      average(nightPlays.map((play) => play.legacy.tide)).toFixed(2),
    ].join(" "),
  );
}

// nights that met a creature from the sea, per creature (the nights without one are the rows above)
const metCreatures = new Map<string, Play[]>();
for (const play of plays) {
  if (!play.creature) continue;
  metCreatures.set(play.creature.id, [...(metCreatures.get(play.creature.id) ?? []), play]);
}
if (metCreatures.size) {
  console.log("\ncreatures from the sea: nights met, how they ended, and what they cost");
  console.log(
    "creature                         archetype  nights  dawn   dark   fallen  quit   kills/min  lamps lost  hp lost",
  );
  for (const [id, creaturePlays] of [...metCreatures].sort((first, second) => second[1].length - first[1].length)) {
    const [first] = creaturePlays;
    if (!first?.creature) continue;
    const ending = (outcome: string | null) => creaturePlays.filter((play) => play.outcome === outcome).length;
    console.log(
      [
        `${first.creature.name} (${id.slice(0, 8)})`.padEnd(32),
        first.creature.archetype.padEnd(10),
        String(creaturePlays.length).padEnd(7),
        percent(ending("dawn"), creaturePlays.length).padEnd(6),
        percent(ending("dark"), creaturePlays.length).padEnd(6),
        percent(ending("fallen"), creaturePlays.length).padEnd(7),
        percent(ending(null), creaturePlays.length).padEnd(6),
        average(creaturePlays.map(killsPerMinute)).toFixed(1).padEnd(10),
        average(creaturePlays.map((play) => play.stats.lampsLost))
          .toFixed(1)
          .padEnd(11),
        average(creaturePlays.map((play) => play.stats.hpLost)).toFixed(0),
      ].join(" "),
    );
  }
}

// when do lost nights go wrong: lamps lit over time, averaged over the nights that ended dark
const dark = plays.filter((play) => play.outcome === "dark");
if (dark.length) {
  const litBySecond: number[][] = [];
  for (const play of dark)
    for (const [second, , lit] of play.timeline) {
      const samples = litBySecond[second] ?? [];
      samples.push(lit);
      litBySecond[second] = samples;
    }
  const summary = litBySecond
    .map((samples, second) => (samples ? `${second}s:${average(samples).toFixed(1)}` : ""))
    .filter(Boolean)
    .filter((_, index) => index % 5 === 0);
  console.log(`\nlamps still lit in nights lost to darkness (by second): ${summary.join("  ")}`);
}

if (shouldVerify) {
  // A night replays to the same end only on the sim it was played on, so only those are checked: the others are not
  // mismatches, they were recorded on another version of the sim (or before versions were noted).
  const finished = plays.filter((play) => play.outcome);
  const comparable = finished.filter((play) => replaysExactlyOn(play, runningSim));
  const matching = comparable.filter((play) => verifyPlay(play).endsMatch).length;
  console.log(
    `\nreplay check on sim ${runningSim}: ${matching}/${comparable.length} finished nights replay to the same end; recorded on another sim version (${finished.length - comparable.length})`,
  );
}

console.log("\nlatest nights (watch with /?replay=<id>):");
for (const play of plays.slice(-8))
  console.log(
    `  ${play.id}  night ${play.legacy.night}  ${play.outcome ?? "quit"}  ${play.stats.kills} slain  ${seconds(play).toFixed(0)} s  ${play.legacy.heir.name}`,
  );
