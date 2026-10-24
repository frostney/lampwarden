// One night in Lychnos: monsters come out of the sea to snuff the town's lamps; the warden fights and relights them until dawn.
// Pure game state and step(); no Pixi, so scripts/balance.ts can run it headless.
import { FPS, FRAMES, type Anim } from "./assets";
import type { Legacy, TraitId } from "./legacy";

export const W = 960;
export const H = 600;
export const CX = 480;
export const CY = 320;
export const HALF_W = 384; // plaza diamond half width (12 tiles of 64x32)
export const HALF_H = 192;

export type MonsterKind = "satyr" | "cyclops" | "harpy";
// snuff: seconds of clawing to put a lamp out. oil: reward per kill.
export const MONSTER: Record<MonsterKind, { speed: number; hp: number; damage: number; snuff: number; oil: number; fly: boolean }> = {
  satyr: { speed: 50, hp: 1, damage: 8, snuff: 2.6, oil: 1, fly: false },
  cyclops: { speed: 30, hp: 3, damage: 16, snuff: 1.5, oil: 3, fly: false },
  harpy: { speed: 76, hp: 1, damage: 6, snuff: 3.2, oil: 1, fly: true },
};

// Lamps around the plaza (screen px; ground y). The statue stands in the middle.
export const LAMP_SPOTS: [number, number][] = [[262, 318], [698, 318], [372, 414], [588, 414], [480, 246]];

export interface Lamp { x: number; y: number; lit: boolean; relight: number; flicker: number }
export interface Monster { id: number; kind: MonsterKind; x: number; y: number; hp: number; t: number; wob: number; snuff: number; cd: number; hurt: number }
export interface Shot { id: number; x: number; y: number; vx: number; vy: number; life: number; hit: number[] }
export interface Puff { id: number; x: number; y: number; t: number; kind: "kill" | "snuff" | "light" | "hurt" }
export interface Hero {
  x: number; y: number; anim: Anim; frameT: number; left: boolean;
  dirX: number; dirY: number; fired: boolean; aim: { x: number; y: number } | null;
  hp: number; maxHp: number; hurt: number; shotCd: number;
}
export type Outcome = "dawn" | "dark" | "fallen";
export interface Stats { kills: number; lampsLost: number; hpLost: number; time: number }
export interface Rules {
  speed: number; meleeReach: number; meleeDmg: number; shotCd: number; spread: boolean; pierce: boolean;
  relight: number; snuffMul: number; lightR: number;
}
export interface State {
  hero: Hero; monsters: Monster[]; shots: Shot[]; puffs: Puff[]; lamps: Lamp[];
  night: number; length: number; elapsed: number; spawnT: number; nextId: number; tide: number;
  rng: number;   // mulberry32 state: a night replays exactly from its seed and inputs
  rules: Rules; stats: Stats; oilEarned: number; outcome: Outcome | null;
}

export const nightLength = (night: number) => 40 + 6 * Math.min(night - 1, 6);

export function rulesFor(l: Pick<Legacy, "levels">, trait: TraitId): Rules {
  const { wick, blade, quiver } = l.levels;
  return {
    speed: 150 * (trait === "swift" ? 1.25 : 1),
    meleeReach: 70 + blade * 10 + (trait === "longarm" ? 16 : 0),
    meleeDmg: 2 + (blade >= 2 ? 1 : 0),
    shotCd: 0.55 * (1 - 0.15 * quiver),
    spread: quiver >= 2,
    pierce: trait === "keen",
    relight: trait === "lamplighter" ? 0.5 : 1.0,
    snuffMul: 1 + 0.35 * wick,
    lightR: 92 + 12 * wick,
  };
}

// seeded RNG kept in the state (mulberry32)
export function rand(s: State): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const newSeed = () => (Math.random() * 4294967296) >>> 0;

export function newNight(l: Legacy, seed = newSeed()): State {
  const rules = rulesFor(l, l.heir.trait);
  const maxHp = 100 + 20 * l.levels.heart + (l.heir.trait === "stout" ? 30 : 0);
  const s: State = {
    hero: { x: CX, y: CY + 62, anim: "idle", frameT: 0, left: false, dirX: 0, dirY: 1, fired: false, aim: null, hp: maxHp, maxHp, hurt: 0, shotCd: 0 },
    monsters: [], shots: [], puffs: [],
    lamps: LAMP_SPOTS.map(([x, y], i) => ({ x, y, lit: true, relight: 0, flicker: i * 1.7 })),
    night: l.night, length: nightLength(l.night), elapsed: 0, spawnT: 2.5, nextId: 1, tide: l.tide, rng: seed | 0,
    rules, stats: { kills: 0, lampsLost: 0, hpLost: 0, time: 0 }, oilEarned: 0, outcome: null,
  };
  return s;
}

export function inPlaza(x: number, y: number, margin = 0.92) {
  return Math.abs(x - CX) / HALF_W + Math.abs(y - CY) / HALF_H <= margin;
}
// ground distance in iso: vertical is foreshortened 2:1
export const ground = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, (ay - by) * 2);

const spawnInterval = (s: State) => 2.3 / (s.tide * (1 + 0.3 * (s.night - 1)));
const maxAlive = (s: State) => Math.round((3 + 1.6 * s.night) * s.tide);
const haste = (s: State) => 1 + 0.05 * (s.night - 1);   // the sea's creatures get bolder every night

function pickKind(s: State, r: number): MonsterKind {
  const w: [MonsterKind, number][] = [["satyr", 1], ["harpy", 0.4 + 0.1 * s.night], ["cyclops", s.night >= 2 ? 0.15 + 0.1 * s.night : 0]];
  let x = r * w.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of w) { if ((x -= v) < 0) return k; }
  return "satyr";
}

export function spawn(s: State) {
  const kind = pickKind(s, rand(s));
  // out of the sea: anywhere on the rim, a little more often from the harbour side (bottom)
  const a = rand(s) < 0.6 ? Math.PI * (0.15 + rand(s) * 0.7) : rand(s) * Math.PI * 2;
  s.monsters.push({
    id: s.nextId++, kind, x: CX + Math.cos(a) * HALF_W * 0.9, y: CY + Math.sin(a) * HALF_H * 0.9,
    hp: MONSTER[kind].hp, t: rand(s) * 10, wob: 10 + rand(s) * 18, snuff: 0, cd: 0, hurt: 0,
  });
}

export interface Input { dx: number; dy: number; melee: boolean; ranged: boolean; aim: { x: number; y: number } | null }
export const NO_INPUT: Input = { dx: 0, dy: 0, melee: false, ranged: false, aim: null };

export const litCount = (s: State) => s.lamps.reduce((n, l) => n + (l.lit ? 1 : 0), 0);
const inLight = (s: State, x: number, y: number) => s.lamps.some((l) => l.lit && ground(l.x, l.y, x, y) < s.rules.lightR);
export const AGGRO = 80;

export function step(s: State, dt: number, inp: Input) {
  if (s.outcome) return;
  s.elapsed += dt; s.stats.time += dt;
  const h = s.hero, R = s.rules;
  h.hurt = Math.max(0, h.hurt - dt); h.shotCd = Math.max(0, h.shotCd - dt);
  const busy = h.anim === "melee" || h.anim === "ranged";

  if (!busy && inp.melee) { h.anim = "melee"; h.frameT = 0; h.fired = false; }
  else if (!busy && inp.ranged && h.shotCd <= 0) { h.anim = "ranged"; h.frameT = 0; h.fired = false; h.aim = inp.aim; }

  const attacking = h.anim === "melee" || h.anim === "ranged";
  if (!attacking) {
    const len = Math.hypot(inp.dx, inp.dy);
    if (len > 0) {
      const ux = inp.dx / len, uy = inp.dy / len;
      h.dirX = ux; h.dirY = uy;
      if (ux !== 0) h.left = ux < 0;
      const nx = h.x + ux * R.speed * dt, ny = h.y + uy * R.speed * dt * 0.5;
      if (inPlaza(nx, ny)) { h.x = nx; h.y = ny; }
      else if (inPlaza(nx, h.y)) h.x = nx;
      else if (inPlaza(h.x, ny)) h.y = ny;
      if (h.anim !== "walk") { h.anim = "walk"; h.frameT = 0; }
    } else if (h.anim !== "idle") { h.anim = "idle"; h.frameT = 0; }
  }

  h.frameT += dt;
  const frame = Math.floor(h.frameT * FPS[h.anim]);
  if (attacking && frame >= FRAMES[h.anim]) { h.anim = "idle"; h.frameT = 0; }

  // attack effects land mid-animation
  if (h.anim === "melee" && !h.fired && frame >= 2) {
    h.fired = true;
    for (const m of s.monsters.slice()) if (ground(m.x, m.y, h.x, h.y) < R.meleeReach) damage(s, m, R.meleeDmg);
  }
  if (h.anim === "ranged" && !h.fired && frame >= 3) {
    h.fired = true; h.shotCd = R.shotCd;
    let dx = h.dirX, dy = h.dirY;
    if (h.aim) { dx = h.aim.x - h.x; dy = h.aim.y - (h.y - 40); }
    const base = Math.atan2(dy, dx);
    if (dx !== 0) h.left = dx < 0;
    for (const off of R.spread ? [-0.16, 0, 0.16] : [0]) {
      const a = base + off;
      s.shots.push({ id: s.nextId++, x: h.x, y: h.y - 40, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 1.2, hit: [] });
    }
  }

  for (const p of s.shots) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    for (const m of s.monsters.slice()) {
      if (p.hit.includes(m.id)) continue;
      const my = m.y - (MONSTER[m.kind].fly ? 56 : 32);
      if (Math.hypot(m.x - p.x, my - p.y) < 30) {
        p.hit.push(m.id); damage(s, m, 1);
        if (!R.pierce) { p.life = 0; break; }
      }
    }
  }
  s.shots = s.shots.filter((p) => p.life > 0 && p.x > -50 && p.x < W + 50 && p.y > -50 && p.y < H + 50);

  // relight: stand by a dark lamp
  for (const l of s.lamps) {
    l.flicker += dt;
    if (l.lit) continue;
    if (ground(l.x, l.y, h.x, h.y) < 40) {
      l.relight += dt;
      if (l.relight >= R.relight) { l.lit = true; l.relight = 0; s.puffs.push({ id: s.nextId++, x: l.x, y: l.y - 40, t: 0, kind: "light" }); }
    } else l.relight = Math.max(0, l.relight - dt * 2);
  }

  for (const m of s.monsters.slice()) {
    const def = MONSTER[m.kind];
    m.t += dt; m.cd = Math.max(0, m.cd - dt); m.hurt = Math.max(0, m.hurt - dt);
    // target: the warden if close, else the nearest lit lamp
    const dh = ground(m.x, m.y, h.x, h.y);
    let tx = h.x, ty = h.y, lamp: Lamp | null = null;
    if (dh > AGGRO) {
      let best = Infinity;
      for (const l of s.lamps) if (l.lit) { const d = ground(m.x, m.y, l.x, l.y); if (d < best) { best = d; lamp = l; } }
      if (lamp) { tx = lamp.x; ty = lamp.y; }
    }
    const dx = tx - m.x, dy = (ty - m.y) * 2, d = Math.hypot(dx, dy) || 1;
    if (!lamp && d < 26) {               // claw the warden
      if (m.cd <= 0) {
        m.cd = 1.1; h.hp = Math.max(0, h.hp - def.damage); h.hurt = 0.35; s.stats.hpLost += def.damage;
        s.puffs.push({ id: s.nextId++, x: h.x, y: h.y - 30, t: 0, kind: "hurt" });
      }
      continue;
    }
    if (lamp && d < 24) {                // claw the lamp
      m.snuff += dt;
      if (m.snuff >= def.snuff * R.snuffMul) {
        lamp.lit = false; lamp.relight = 0; m.snuff = 0; s.stats.lampsLost++;
        s.puffs.push({ id: s.nextId++, x: lamp.x, y: lamp.y - 40, t: 0, kind: "snuff" });
      }
      continue;
    }
    m.snuff = 0;
    // move in ground space with a sideways wobble; the light slows them
    const sp = def.speed * haste(s) * (inLight(s, m.x, m.y) ? 0.7 : 1) * (m.hurt > 0 ? 0.3 : 1);
    const gx = dx / d, gy = dy / d;
    const lat = Math.cos(m.t * 2.2) * m.wob * Math.min(1, d / 80);
    m.x += (gx * sp - gy * lat) * dt;
    m.y += (gy * sp + gx * lat) * dt * 0.5;
  }

  for (const p of s.puffs) p.t += dt;
  s.puffs = s.puffs.filter((p) => p.t < 0.5);

  if (s.elapsed < s.length) {
    s.spawnT -= dt;
    if (s.spawnT <= 0 && s.monsters.length < maxAlive(s)) { spawn(s); s.spawnT = spawnInterval(s); }
  }

  if (h.hp <= 0) s.outcome = "fallen";
  else if (litCount(s) === 0) s.outcome = "dark";
  else if (s.elapsed >= s.length) {   // dawn: the sun burns the stragglers away
    for (const m of s.monsters) s.puffs.push({ id: s.nextId++, x: m.x, y: m.y - 30, t: 0, kind: "kill" });
    s.monsters = [];
    s.outcome = "dawn";
  }
}

function damage(s: State, m: Monster, n: number) {
  m.hp -= n; m.hurt = 0.25;
  if (m.hp > 0) return;
  s.monsters = s.monsters.filter((o) => o !== m);
  s.puffs.push({ id: s.nextId++, x: m.x, y: m.y - 30, t: 0, kind: "kill" });
  s.stats.kills++;
  s.oilEarned += MONSTER[m.kind].oil;
}

// Dawn reward: oil for every lamp still burning.
export const dawnBonus = (s: State) => 4 + 2 * litCount(s);

// The director: read the night as implicit feedback and set the next tide.
// Clean dawn with most lamps and health kept → the sea pushes harder; a lost night → it eases off.
export function nextTide(tide: number, s: State): number {
  const killRate = s.stats.kills / Math.max(1, s.stats.time / 60);   // kills per minute
  let t = tide;
  if (s.outcome === "dawn") {
    const clean = s.stats.lampsLost <= 1 && s.hero.hp > s.hero.maxHp * 0.5;
    t *= clean ? (killRate > 20 ? 1.18 : 1.1) : 1.0;
  } else t *= 0.85;
  return Math.min(2, Math.max(0.6, Math.round(t * 100) / 100));
}
