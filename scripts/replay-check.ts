// Records bot-played nights through the Recorder at the fixed step, replays them, and checks they end identically.
// usage: bun scripts/replay-check.ts [runs=20]
import { newLegacy } from "../lib/legacy";
import { Recorder, STEP, quantise, verifyPlay } from "../lib/replay";
import { MONSTER, NO_INPUT, ground, newNight, newSeed, step, type Input, type State } from "../lib/sim";

function bot(s: State): Input {
  const h = s.hero;
  let near: State["monsters"][number] | null = null, nd = Infinity;
  for (const m of s.monsters) { const d = ground(m.x, m.y, h.x, h.y); if (d < nd) { nd = d; near = m; } }
  if (near && nd < s.rules.meleeReach - 8) return { ...NO_INPUT, melee: true };
  if (near && h.shotCd <= 0 && nd > 180) return { ...NO_INPUT, ranged: true, aim: { x: near.x + 0.37, y: near.y - (MONSTER[near.kind].fly ? 56 : 32) } };
  if (!near) return NO_INPUT;
  return { ...NO_INPUT, dx: Math.sign(near.x - h.x), dy: Math.sign(near.y - h.y) };
}

const runs = Number(process.argv[2] || 20);
let ok = 0;
for (let i = 0; i < runs; i++) {
  const l = newLegacy(); l.night = 1 + (i % 6); l.tide = 1 + (i % 3) * 0.2;
  const seed = newSeed(), s = newNight(l, seed), rec = new Recorder(l, seed, "check");
  let inp = NO_INPUT;
  for (let n = 0; !s.outcome; n++) {
    if (n % 9 === 0) inp = bot(s); else inp = { ...inp, melee: false, ranged: false };
    const q = quantise(inp);
    rec.input(n, q, s);
    step(s, STEP, q);
  }
  const p = JSON.parse(JSON.stringify(rec.finish(s)));   // through JSON, as it travels
  const v = verifyPlay(p);
  if (v.endsMatch) ok++;
  else console.log("DIVERGED", { seed, night: l.night, live: [s.outcome, s.stats.kills, s.stats.lampsLost], replay: [v.state.outcome, v.state.stats.kills, v.state.stats.lampsLost] });
  if (i === 0) console.log(`sample: night ${l.night}, ${p.outcome}, ${p.steps} steps, ${p.inputs.length} input rows, ${JSON.stringify(p).length} bytes`);
}
console.log(`${ok}/${runs} replays end exactly like the live night`);
if (ok !== runs) process.exit(1);
