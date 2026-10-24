import { FPS, FRAMES, type Anim } from "./assets";

export const W = 960;
export const H = 600;
export const CX = 480;
export const CY = 320;
export const HALF_W = 384; // plaza diamond half width (12 tiles of 64x32)
export const HALF_H = 192;
export const TOWN_R = 38; // monsters this close to the statue hit the town

export type MonsterKind = "satyr" | "cyclops" | "harpy";
export const MONSTER: Record<MonsterKind, { speed: number; damage: number; fly: boolean }> = {
  satyr: { speed: 52, damage: 8, fly: false },
  cyclops: { speed: 32, damage: 15, fly: false },
  harpy: { speed: 74, damage: 6, fly: true },
};

export interface Monster { id: number; kind: MonsterKind; x: number; y: number; t: number; wob: number }
export interface Shot { id: number; x: number; y: number; vx: number; vy: number; life: number }
export interface Puff { id: number; x: number; y: number; t: number }
export interface Hero {
  x: number; y: number; anim: Anim; frameT: number; left: boolean;
  dirX: number; dirY: number; fired: boolean; // fired: has the current attack already landed
  aim: { x: number; y: number } | null;
}
export interface State {
  hero: Hero; monsters: Monster[]; shots: Shot[]; puffs: Puff[];
  health: number; kills: number; over: boolean; spawnT: number; elapsed: number; nextId: number;
}

export const MAX_HEALTH = 100;

export function inPlaza(x: number, y: number, margin = 0.92) {
  return Math.abs(x - CX) / HALF_W + Math.abs(y - CY) / HALF_H <= margin;
}

export function newState(): State {
  const s: State = {
    hero: { x: CX - 90, y: CY + 70, anim: "idle", frameT: 0, left: false, dirX: 0, dirY: 1, fired: false, aim: null },
    monsters: [], shots: [], puffs: [], health: MAX_HEALTH, kills: 0, over: false, spawnT: 1.5, elapsed: 0, nextId: 1,
  };
  for (let i = 0; i < 3; i++) spawn(s);
  return s;
}

export function spawn(s: State) {
  const kinds: MonsterKind[] = ["satyr", "cyclops", "harpy"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const a = Math.random() * Math.PI * 2;
  s.monsters.push({
    id: s.nextId++, kind, x: CX + Math.cos(a) * HALF_W * 0.9, y: CY + Math.sin(a) * HALF_H * 0.9,
    t: Math.random() * 10, wob: 14 + Math.random() * 20,
  });
}

export interface Input { dx: number; dy: number; melee: boolean; ranged: boolean; aim: { x: number; y: number } | null }

function dist2(ax: number, ay: number, bx: number, by: number) {
  // ground distance in iso: vertical is foreshortened 2:1
  return Math.hypot(ax - bx, (ay - by) * 2);
}

export function step(s: State, dt: number, inp: Input) {
  if (s.over) return;
  s.elapsed += dt;
  const h = s.hero;
  const busy = h.anim === "melee" || h.anim === "ranged";

  if (!busy && inp.melee) { h.anim = "melee"; h.frameT = 0; h.fired = false; }
  else if (!busy && inp.ranged) { h.anim = "ranged"; h.frameT = 0; h.fired = false; h.aim = inp.aim; }

  const attacking = h.anim === "melee" || h.anim === "ranged";
  if (!attacking) {
    const len = Math.hypot(inp.dx, inp.dy);
    if (len > 0) {
      const ux = inp.dx / len, uy = inp.dy / len;
      h.dirX = ux; h.dirY = uy;
      if (ux !== 0) h.left = ux < 0;
      const sp = 150;
      const nx = h.x + ux * sp * dt, ny = h.y + uy * sp * dt * 0.5;
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
    for (const m of s.monsters.slice()) {
      if (dist2(m.x, m.y, h.x, h.y) < 72) kill(s, m);
    }
  }
  if (h.anim === "ranged" && !h.fired && frame >= 3) {
    h.fired = true;
    let dx = h.dirX, dy = h.dirY;
    if (h.aim) { dx = h.aim.x - h.x; dy = h.aim.y - (h.y - 40); }
    const l = Math.hypot(dx, dy) || 1;
    if (dx !== 0) h.left = dx < 0;
    s.shots.push({ id: s.nextId++, x: h.x, y: h.y - 40, vx: (dx / l) * 400, vy: (dy / l) * 400, life: 1.3 });
  }

  for (const p of s.shots) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    for (const m of s.monsters.slice()) {
      const my = m.y - (MONSTER[m.kind].fly ? 56 : 32);
      if (Math.hypot(m.x - p.x, my - p.y) < 30) { kill(s, m); p.life = 0; break; }
    }
  }
  s.shots = s.shots.filter((p) => p.life > 0 && p.x > -50 && p.x < W + 50 && p.y > -50 && p.y < H + 50);

  for (const m of s.monsters.slice()) {
    const def = MONSTER[m.kind];
    m.t += dt;
    const dx = CX - m.x, dy = (CY - m.y) * 2;
    const d = Math.hypot(dx, dy);
    if (d < TOWN_R) {
      s.health = Math.max(0, s.health - def.damage);
      s.monsters = s.monsters.filter((o) => o !== m);
      s.puffs.push({ id: s.nextId++, x: m.x, y: m.y, t: 0 });
      continue;
    }
    // move in ground space (vertical foreshortened 2:1), with a sideways wobble
    const gx = dx / d, gy = dy / d;
    const lat = Math.cos(m.t * 2.2) * m.wob;
    m.x += (gx * def.speed - gy * lat) * dt;
    m.y += (gy * def.speed + gx * lat) * dt * 0.5;
  }

  for (const p of s.puffs) p.t += dt;
  s.puffs = s.puffs.filter((p) => p.t < 0.4);

  s.spawnT -= dt;
  if (s.spawnT <= 0 && s.monsters.length < 7) {
    spawn(s);
    s.spawnT = Math.max(1.1, 2.8 - s.elapsed / 60);
  }
  if (s.health <= 0) s.over = true;
}

function kill(s: State, m: Monster) {
  s.monsters = s.monsters.filter((o) => o !== m);
  s.puffs.push({ id: s.nextId++, x: m.x, y: m.y - 30, t: 0 });
  s.kills++;
}
