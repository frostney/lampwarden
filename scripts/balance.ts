// Headless balance check: plays nights with an idle warden and a simple bot, prints outcome rates.
// usage: bun scripts/balance.ts [runs=200]
import { newLegacy } from "../lib/legacy";
import { MONSTER, NO_INPUT, ground, litCount, newNight, step, type Input, type State } from "../lib/sim";

function bot(s: State): Input {
  const h = s.hero, R = s.rules;
  let near = null as State["monsters"][number] | null, nd = Infinity;
  for (const m of s.monsters) { const d = ground(m.x, m.y, h.x, h.y); if (d < nd) { nd = d; near = m; } }
  if (near && nd < R.meleeReach - 8) return { ...NO_INPUT, melee: true };
  const dark = s.lamps.filter((l) => !l.lit).sort((a, b) => ground(a.x, a.y, h.x, h.y) - ground(b.x, b.y, h.x, h.y))[0];
  // threat: the monster closest to a lit lamp
  let threat = null as State["monsters"][number] | null, td = Infinity;
  for (const m of s.monsters) for (const l of s.lamps) if (l.lit) { const d = ground(m.x, m.y, l.x, l.y); if (d < td) { td = d; threat = m; } }
  const goal = dark && (nd > 120) ? { x: dark.x, y: dark.y } : threat ?? near;
  if (threat && h.shotCd <= 0 && ground(threat.x, threat.y, h.x, h.y) > 180)
    return { ...NO_INPUT, ranged: true, aim: { x: threat.x, y: threat.y - (MONSTER[threat.kind].fly ? 56 : 32) } };
  if (!goal) return NO_INPUT;
  const dx = goal.x - h.x, dy = goal.y - h.y;
  return { ...NO_INPUT, dx: Math.abs(dx) > 10 ? Math.sign(dx) : 0, dy: Math.abs(dy) > 5 ? Math.sign(dy) : 0 };
}

function play(night: number, tide: number, policy: "idle" | "bot") {
  const l = newLegacy(); l.night = night; l.tide = tide;
  const s = newNight(l);
  let inp = NO_INPUT, think = 0;
  const dt = 1 / 60;
  while (!s.outcome) {
    if ((think -= dt) <= 0) { inp = policy === "bot" ? bot(s) : NO_INPUT; think = 0.15; }   // ~150 ms reaction time
    step(s, dt, inp);
    if (inp.melee || inp.ranged) inp = { ...inp, melee: false, ranged: false };
  }
  return { outcome: s.outcome, t: s.elapsed, lit: litCount(s), hp: s.hero.hp, kills: s.stats.kills, oil: s.oilEarned };
}

const runs = Number(process.argv[2] || 200);
for (const policy of ["idle", "bot"] as const) {
  for (const [night, tide] of [[1, 1], [2, 1], [3, 1.1], [5, 1.2], [7, 1.4]] as const) {
    const res = Array.from({ length: runs }, () => play(night, tide, policy));
    const n = (o: string) => res.filter((r) => r.outcome === o).length;
    const avg = (f: (r: (typeof res)[number]) => number) => (res.reduce((a, r) => a + f(r), 0) / runs).toFixed(1);
    console.log(`${policy.padEnd(4)} night ${night} tide ${tide}: dawn ${(100 * n("dawn") / runs).toFixed(0)}%  dark ${(100 * n("dark") / runs).toFixed(0)}%  fallen ${(100 * n("fallen") / runs).toFixed(0)}%  | ends at ${avg((r) => r.t)}s, lamps ${avg((r) => r.lit)}, kills ${avg((r) => r.kills)}, oil ${avg((r) => r.oil)}`);
  }
}
