// Play recording for testing and balancing. A night is fully determined by its seed, the legacy it started from and the
// warden's inputs at a fixed 60 Hz step, so a recording is just those inputs (only when they change) plus a per-second
// timeline that the balance analysis can read without replaying anything.
import type { Legacy } from "./legacy";
import { litCount, newNight, step, type Input, type State } from "./sim";

export const STEP = 1 / 60;

// [step, dx, dy, melee, ranged, aimX, aimY]   (aim -1,-1 = no aim)
type InputRow = [number, number, number, number, number, number, number];
// [second, kills, lampsLit, hp, monsters, lampsLost]
type TimelineRow = [number, number, number, number, number, number];

export interface Play {
  v: 1;
  id: string;
  session: string;              // random per browser, no personal data
  build: string;                // git sha of the deployment, when known
  startedAt: string;
  seed: number;
  legacy: Pick<Legacy, "night" | "generation" | "tide" | "levels" | "heir">;
  inputs: InputRow[];
  timeline: TimelineRow[];
  steps: number;
  outcome: string | null;       // dawn | dark | fallen | null when abandoned
  stats: State["stats"] & { oilEarned: number; hp: number; maxHp: number; lit: number };
  replay?: { endsMatch: boolean }; // filled in when a recording is verified by replay
}

const rid = () => Math.random().toString(36).slice(2, 10);
export function sessionId(): string {
  try {
    let s = localStorage.getItem("lampwarden:session");
    if (!s) { s = rid() + rid(); localStorage.setItem("lampwarden:session", s); }
    return s;
  } catch { return "anon"; }
}

// Inputs are quantised before they reach the sim, so live play and replay see identical numbers.
export function quantise(inp: Input): Input {
  return inp.aim ? { ...inp, aim: { x: Math.round(inp.aim.x), y: Math.round(inp.aim.y) } } : inp;
}

export class Recorder {
  play: Play;
  private last: InputRow | null = null;
  constructor(l: Legacy, seed: number, build: string) {
    this.play = {
      v: 1, id: new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "-" + rid(), session: sessionId(), build,
      startedAt: new Date().toISOString(), seed,
      legacy: JSON.parse(JSON.stringify({ night: l.night, generation: l.generation, tide: l.tide, levels: l.levels, heir: l.heir })),
      inputs: [], timeline: [], steps: 0, outcome: null,
      stats: { kills: 0, lampsLost: 0, hpLost: 0, time: 0, oilEarned: 0, hp: 0, maxHp: 0, lit: 0 },
    };
  }
  // call once per sim step n with the input about to be applied; s is the state after steps 0..n-1
  input(n: number, inp: Input, s: State) {
    this.play.steps = n + 1;
    if (n > 0 && n % 60 === 0) this.play.timeline.push([n / 60, s.stats.kills, litCount(s), Math.ceil(s.hero.hp), s.monsters.length, s.stats.lampsLost]);
    const row: InputRow = [n, inp.dx, inp.dy, inp.melee ? 1 : 0, inp.ranged ? 1 : 0, inp.aim ? inp.aim.x : -1, inp.aim ? inp.aim.y : -1];
    const l = this.last;
    if (!l || row[3] || row[4] || l[1] !== row[1] || l[2] !== row[2]) { this.play.inputs.push(row); this.last = row; }
  }
  finish(s: State): Play {
    const p = this.play;
    p.outcome = s.outcome;
    p.stats = { ...s.stats, oilEarned: s.oilEarned, hp: Math.ceil(s.hero.hp), maxHp: s.hero.maxHp, lit: litCount(s) };
    return p;
  }
}

// Feeds a recording's inputs back step by step.
export class Replayer {
  private i = 0;
  private cur: Input = { dx: 0, dy: 0, melee: false, ranged: false, aim: null };
  constructor(public play: Play) {}
  input(n: number): Input {
    const rows = this.play.inputs;
    let edge = false;
    while (this.i < rows.length && rows[this.i][0] <= n) {
      const r = rows[this.i++];
      this.cur = { dx: r[1], dy: r[2], melee: r[3] === 1, ranged: r[4] === 1, aim: r[5] >= 0 ? { x: r[5], y: r[6] } : null };
      edge = r[0] === n;
    }
    return edge ? this.cur : { ...this.cur, melee: false, ranged: false };
  }
}

export function legacyOf(p: Play): Legacy {
  return { ...p.legacy, bestNight: 0, oil: 0, fallen: [] } as Legacy;
}

// Replays a recording headlessly and reports whether it ends where the live play ended.
export function verifyPlay(p: Play): { state: State; endsMatch: boolean } {
  const s = newNight(legacyOf(p), p.seed);
  const r = new Replayer(p);
  for (let n = 0; n < p.steps && !s.outcome; n++) step(s, STEP, r.input(n));
  const endsMatch = s.outcome === p.outcome && s.stats.kills === p.stats.kills && s.stats.lampsLost === p.stats.lampsLost;
  return { state: s, endsMatch };
}

export async function upload(p: Play): Promise<boolean> {
  try {
    const body = JSON.stringify(p);
    const r = await fetch("/api/plays", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: body.length < 60000 });
    return r.ok;
  } catch { return false; }
}
