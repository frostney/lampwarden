// Balance report from recorded plays (the private Blob store behind /api/plays).
// usage: bun scripts/plays.ts [--since 2026-10-24] [--build abc1234] [--verify]
//   needs BLOB_READ_WRITE_TOKEN (vercel env pull .env.local); --verify replays every finished night and checks it ends the same.
import { get, list } from "@vercel/blob";
import { verifyPlay, type Play } from "../lib/replay";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const since = arg("--since"), build = arg("--build"), doVerify = process.argv.includes("--verify");
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) { console.error("BLOB_READ_WRITE_TOKEN is not set (vercel env pull .env.local)"); process.exit(1); }

const paths: string[] = [];
let cursor: string | undefined;
do {
  const r = await list({ prefix: "plays/", cursor, token });
  paths.push(...r.blobs.map((b) => b.pathname).filter((p) => !since || p.slice(6, 16) >= since));
  cursor = r.hasMore ? r.cursor : undefined;
} while (cursor);

const plays: (Play & { build: string })[] = [];
for (const p of paths) {
  const r = await get(p, { access: "private", token });
  if (!r || r.statusCode !== 200) continue;
  const play = JSON.parse(await new Response(r.stream).text());
  if (!build || play.build === build) plays.push(play);
}
if (!plays.length) { console.log("no plays"); process.exit(0); }

const pct = (n: number, d: number) => `${d ? Math.round((100 * n) / d) : 0}%`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const secs = (p: Play) => p.steps / 60;

console.log(`${plays.length} nights from ${new Set(plays.map((p) => p.session)).size} players, ${(plays.reduce((a, p) => a + secs(p), 0) / 60).toFixed(1)} min played`);
console.log(`builds: ${[...new Set(plays.map((p) => p.build))].join(", ")}\n`);
console.log("night  plays  dawn   dark   fallen  quit   avg len  kills/min  lamps lost  hp lost  tide");
const nights = [...new Set(plays.map((p) => p.legacy.night))].sort((a, b) => a - b);
for (const n of nights) {
  const ps = plays.filter((p) => p.legacy.night === n);
  const c = (o: string | null) => ps.filter((p) => p.outcome === o).length;
  console.log([
    String(n).padEnd(6), String(ps.length).padEnd(6), pct(c("dawn"), ps.length).padEnd(6), pct(c("dark"), ps.length).padEnd(6),
    pct(c("fallen"), ps.length).padEnd(7), pct(c(null), ps.length).padEnd(6), `${avg(ps.map(secs)).toFixed(0)} s`.padEnd(8),
    avg(ps.map((p) => p.stats.kills / Math.max(1, secs(p) / 60))).toFixed(1).padEnd(10), avg(ps.map((p) => p.stats.lampsLost)).toFixed(1).padEnd(11),
    avg(ps.map((p) => p.stats.hpLost)).toFixed(0).padEnd(8), avg(ps.map((p) => p.legacy.tide)).toFixed(2),
  ].join(" "));
}

// when do lost nights go wrong: lamps lit over time, averaged over the nights that ended dark
const dark = plays.filter((p) => p.outcome === "dark");
if (dark.length) {
  const by: number[][] = [];
  for (const p of dark) for (const [t, , lit] of p.timeline) (by[t] ??= []).push(lit);
  console.log(`\nlamps still lit in nights lost to darkness (by second): ${by.map((v, t) => (v ? `${t}s:${avg(v).toFixed(1)}` : "")).filter(Boolean).filter((_, i) => i % 5 === 0).join("  ")}`);
}

if (doVerify) {
  const done = plays.filter((p) => p.outcome);
  const ok = done.filter((p) => verifyPlay(p).endsMatch).length;
  console.log(`\nreplay check: ${ok}/${done.length} finished nights replay to the same end`);
}

console.log("\nlatest nights (watch with /?replay=<id>):");
for (const p of plays.slice(-8)) console.log(`  ${p.id}  night ${p.legacy.night}  ${p.outcome ?? "quit"}  ${p.stats.kills} slain  ${secs(p).toFixed(0)} s  ${p.legacy.heir.name}`);
