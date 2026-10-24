// What the scene looks like, in plain Pixi: textures, the ground, props, the night tint, the lights and the strokes
// redrawn every frame. components/Scene.tsx puts these on screen with @pixi/react and keeps them in step with the sim.
import { Assets, Graphics, Texture } from "pixi.js";
import { ANCHOR_Y, FPS, FRAMES, assetList, type Anim } from "./assets";
import { CX, CY, H, HALF_H, HALF_W, MONSTER, W, type Lamp, type State } from "./sim";

export type Tex = Record<string, Texture>;

let texCache: Promise<Tex> | null = null;
export function loadTextures(): Promise<Tex> {
  texCache ??= (async () => {
    const list = assetList();
    const res: Record<string, Texture> = await Assets.load(list);
    const out: Tex = {};
    for (const a of list) { out[a.alias] = res[a.alias]; out[a.alias].source.scaleMode = "nearest"; }
    return out;
  })();
  return texCache;
}

export function drawGround(g: Graphics) {
  g.rect(0, 0, W, H).fill(0x1e5f8a); // sea
  for (let i = 0; i < 12; i++) g.rect(0, 40 + i * 52, W, 3).fill({ color: 0x2b78a6, alpha: 0.6 });
  // plaza: 12x12 iso diamond tiles of 64x32
  const n = 12;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const sx = CX + (c - r) * 32;
      const sy = CY - HALF_H + (c + r) * 16 + 16;
      const edge = r === 0 || c === 0 || r === n - 1 || c === n - 1;
      const col = edge ? 0xb89a6a : (r + c) % 2 === 0 ? 0xe3d3a8 : 0xd6c394;
      g.poly([sx, sy - 16, sx + 32, sy, sx, sy + 16, sx - 32, sy]).fill(col).stroke({ width: 1, color: 0xa88f60, alpha: 0.7 });
    }
  }
  g.poly([CX - HALF_W, CY, CX, CY + HALF_H, CX, CY + HALF_H + 14, CX - HALF_W, CY + 14]).fill(0x8a7048);
  g.poly([CX + HALF_W, CY, CX, CY + HALF_H, CX, CY + HALF_H + 14, CX + HALF_W, CY + 14]).fill(0x6f5a3a);
  g.ellipse(CX, CY + 8, 70, 35).stroke({ width: 3, color: 0x3d6f8c });
  g.ellipse(CX, CY + 8, 46, 23).fill({ color: 0x3d6f8c, alpha: 0.35 });
  for (let i = 0; i < 6; i++) {
    const x = CX + 270 + i * 14, y = CY + 108 - i * 7;
    g.poly([x, y, x + 34, y + 17, x + 34, y + 23, x, y + 6]).fill(i % 2 ? 0x8a6a3a : 0x9b7843);
  }
}

// a soft warm disc, drawn once and stretched into iso ellipses for every light
export function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,190,110,0.85)");
  gr.addColorStop(0.45, "rgba(255,150,70,0.35)");
  gr.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 128, 128);
  return Texture.from(c);
}

// the white sheet the night tint is multiplied through
export function drawSheet(g: Graphics) { g.clear(); g.rect(0, 0, W, H).fill(0xffffff); }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(c1: number, c2: number, t: number) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
// night tint (multiplied over the scene): deep blue, warming to dawn over the last fifth of the night
export function nightTint(p: number) {
  if (p < 0.8) return 0x46559a;
  const t = (p - 0.8) / 0.2;
  return t < 0.6 ? mix(0x46559a, 0xd08a7a, t / 0.6) : mix(0xd08a7a, 0xffffff, (t - 0.6) / 0.4);
}
// the lights fade out over the last 15% of the night
export const lightsAlpha = (p: number) => (p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15);

export const PROPS: [string, number, number][] = [
  ["temple", 372, 236], ["house", 620, 240], ["zeus-statue", CX, CY + 14], ["galley-dock", CX + 345, CY + 112],
  ["olive", 160, 300], ["olive", 800, 300], ["stall", 610, 330], ["wall", 250, 228],
];

// where a sprite's base touches the ground, as a Pixi anchor (one object per key, so React props stay equal)
const anchors = new Map<string, { x: number; y: number }>();
export function anchor(key: keyof typeof ANCHOR_Y | string) {
  let a = anchors.get(key);
  if (!a) { a = { x: 0.5, y: ANCHOR_Y[key as keyof typeof ANCHOR_Y] ?? 0.85 }; anchors.set(key, a); }
  return a;
}

export const heroFrame = (anim: Anim, frameT: number) =>
  Math.min(Math.floor(frameT * FPS[anim]) % Math.max(1, FRAMES[anim]), FRAMES[anim] - 1);

export const flicker = (l: Lamp) => 1 + Math.sin(l.flicker * 9) * 0.03 + Math.sin(l.flicker * 23) * 0.02;

// a progress ring; moveTo first, or the arc is joined to wherever the previous shape ended
function ring(g: Graphics, x: number, y: number, r: number, k: number, color: number) {
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.min(1, k);
  g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1).stroke({ width: 3, color });
}

// below the night tint: the melee sweep
export function drawSweep(g: Graphics, s: State) {
  const h = s.hero, R = s.rules;
  if (h.anim === "melee") g.ellipse(Math.round(h.x), Math.round(h.y), R.meleeReach, R.meleeReach / 2).stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
}

// above the night tint, so they stay readable: shots, puffs, dark-lamp markers, relight and snuff progress, hp pips
export function drawMarks(g: Graphics, s: State, clock: number) {
  const R = s.rules;
  for (const sh of s.shots) {
    g.circle(Math.round(sh.x), Math.round(sh.y), 3).fill(0xfff2c0);
    g.circle(Math.round(sh.x - sh.vx * 0.02), Math.round(sh.y - sh.vy * 0.02), 2).fill({ color: 0xf2c14e, alpha: 0.7 });
  }
  for (const pf of s.puffs) {
    const r = 6 + pf.t * 60, a = 1 - pf.t / 0.5;
    const col = pf.kind === "snuff" ? 0x9aa0b0 : pf.kind === "hurt" ? 0xff5050 : pf.kind === "light" ? 0xffe6a0 : 0xf2c14e;
    g.circle(Math.round(pf.x), Math.round(pf.y), r).stroke({ width: 3, color: col, alpha: a });
  }
  for (const l of s.lamps) {
    if (!l.lit) {   // dark lamp: pulsing marker and relight progress
      const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
      g.ellipse(l.x, l.y, 26, 13).stroke({ width: 2, color: 0xffd27a, alpha: 0.35 + 0.4 * pulse });
      if (l.relight > 0) ring(g, l.x, l.y - 70, 9, l.relight / R.relight, 0xffe6a0);
    }
  }
  for (const m of s.monsters) {   // clawing a lamp: red progress over it
    if (m.snuff <= 0) continue;
    const k = m.snuff / (MONSTER[m.kind].snuff * R.snuffMul);
    ring(g, m.x, m.y - 74, 8, k, 0xff5a4a);
  }
  for (const m of s.monsters) if (MONSTER[m.kind].hp > 1)
    for (let i = 0; i < m.hp; i++) g.rect(m.x - 8 + i * 6, m.y - 84, 4, 3).fill(0xff5a4a);
}
