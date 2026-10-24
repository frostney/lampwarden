// The Pixi side: one Application, sprites synced from the sim state every tick. React only draws the HUD and menus.
import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { ANCHOR_Y, FPS, FRAMES, assetList, heroKey, type Sex } from "./assets";
import { CX, CY, H, HALF_H, HALF_W, MONSTER, NO_INPUT, W, step, type Input, type State } from "./sim";

type Tex = Record<string, Texture>;

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

function drawGround(g: Graphics) {
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
function glowTexture(): Texture {
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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(c1: number, c2: number, t: number) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
// night tint (multiplied over the scene): deep blue, warming to dawn over the last fifth of the night
function nightTint(p: number) {
  if (p < 0.8) return 0x46559a;
  const t = (p - 0.8) / 0.2;
  return t < 0.6 ? mix(0x46559a, 0xd08a7a, t / 0.6) : mix(0xd08a7a, 0xffffff, (t - 0.6) / 0.4);
}

const PROPS: [string, number, number][] = [
  ["temple", 372, 236], ["house", 620, 240], ["zeus-statue", CX, CY + 14], ["galley-dock", CX + 345, CY + 112],
  ["olive", 160, 300], ["olive", 800, 300],
];

export interface SceneHandle {
  setState(s: State, sex: Sex): void;
  setPaused(p: boolean): void;
  destroy(): void;
}

export async function createScene(host: HTMLElement, onTick: (s: State) => void): Promise<SceneHandle> {
  const tex = await loadTextures();
  const app = new Application();
  await app.init({ width: W, height: H, background: 0x1e5f8a, antialias: false, roundPixels: true, resolution: 1, autoDensity: false });
  host.appendChild(app.canvas);

  let state: State | null = null, sex: Sex = "male", paused = true;
  const ground = new Graphics(); drawGround(ground);
  const world = new Container({ sortableChildren: true });
  const fx = new Graphics();
  const night = new Graphics().rect(0, 0, W, H).fill(0xffffff);
  night.blendMode = "multiply";
  const lights = new Container();
  const glowTex = glowTexture();
  const ui = new Graphics();
  app.stage.addChild(ground, world, fx, night, lights, ui);

  const sprite = (key: string, x: number, y: number) => {
    const s = new Sprite(tex[key]);
    s.anchor.set(0.5, ANCHOR_Y[key as keyof typeof ANCHOR_Y] ?? 0.85);
    s.position.set(x, y); s.zIndex = y;
    world.addChild(s); return s;
  };
  for (const [k, x, y] of PROPS) sprite(k, x, y);
  const trireme = sprite("trireme", 130, 440);
  const hero = sprite("hero/male_idle1", 0, 0);
  const lamps: Sprite[] = [];
  const glows: Sprite[] = [];
  const mons = new Map<number, Sprite>();
  const glow = () => { const g = new Sprite(glowTex); g.anchor.set(0.5); g.blendMode = "add"; lights.addChild(g); return g; };
  const heroGlow = glow();

  // input
  const keys = new Set<string>();
  const pend = { melee: false, ranged: false, aim: null as { x: number; y: number } | null };
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (k === "j" || k === " ") { if (!e.repeat) pend.melee = true; return; }
    if (k === "k") { if (!e.repeat) { pend.ranged = true; pend.aim = null; } return; }
    keys.add(k);
  };
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const click = (e: PointerEvent) => {
    const r = app.canvas.getBoundingClientRect();
    pend.ranged = true;
    pend.aim = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  app.canvas.addEventListener("pointerdown", click);

  let clock = 0;
  app.ticker.add((t) => {
    const dt = Math.min(t.deltaMS / 1000, 0.05);
    clock += dt;
    trireme.y = 440 + Math.sin(clock * 1.5) * 4;
    const s = state;
    if (!s) return;
    const inp: Input = paused ? NO_INPUT : {
      dx: (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
      dy: (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0),
      melee: pend.melee, ranged: pend.ranged, aim: pend.aim,
    };
    pend.melee = false; pend.ranged = false;
    if (!paused) step(s, dt, inp);
    draw(s);
    onTick(s);
  });

  function draw(s: State) {
    const R = s.rules;
    // hero
    const h = s.hero;
    const frame = Math.min(Math.floor(h.frameT * FPS[h.anim]) % Math.max(1, FRAMES[h.anim]), FRAMES[h.anim] - 1);
    hero.texture = tex[heroKey(sex, h.anim, frame)];
    hero.position.set(Math.round(h.x), Math.round(h.y)); hero.zIndex = h.y;
    hero.scale.x = h.left ? -1 : 1;
    hero.tint = h.hurt > 0 ? 0xff8080 : 0xffffff;

    // lamps
    s.lamps.forEach((l, i) => {
      if (!lamps[i]) { lamps[i] = sprite("lamp-lit", l.x, l.y); glows[i] = glow(); }
      lamps[i].texture = tex[l.lit ? "lamp-lit" : "lamp-unlit"];
      const g = glows[i];
      g.visible = l.lit;
      const f = 1 + Math.sin(l.flicker * 9) * 0.03 + Math.sin(l.flicker * 23) * 0.02;
      g.width = R.lightR * 2.2 * f; g.height = R.lightR * 1.1 * f;
      g.position.set(l.x, l.y - 6);
    });
    heroGlow.width = 120; heroGlow.height = 60; heroGlow.alpha = 0.5;
    heroGlow.position.set(h.x, h.y - 4);

    // monsters
    const seen = new Set<number>();
    for (const m of s.monsters) {
      seen.add(m.id);
      let sp = mons.get(m.id);
      if (!sp) { sp = sprite(m.kind, m.x, m.y); mons.set(m.id, sp); }
      const fly = MONSTER[m.kind].fly;
      const bob = Math.sin(m.t * (fly ? 7 : 5)) * (fly ? 6 : 2);
      sp.position.set(Math.round(m.x), Math.round(m.y - (fly ? 22 : 0) + bob)); sp.zIndex = m.y;
      sp.scale.x = m.x > CX ? -1 : 1;
      sp.tint = m.hurt > 0 ? 0xff7070 : 0xffffff;
    }
    for (const [id, sp] of mons) if (!seen.has(id)) { sp.destroy(); mons.delete(id); }

    // night
    const p = Math.min(1, s.elapsed / s.length);
    night.tint = nightTint(p);
    lights.alpha = p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15;

    // effects above the night tint so they stay readable
    fx.clear(); ui.clear();
    for (const sh of s.shots) {
      ui.circle(Math.round(sh.x), Math.round(sh.y), 3).fill(0xfff2c0);
      ui.circle(Math.round(sh.x - sh.vx * 0.02), Math.round(sh.y - sh.vy * 0.02), 2).fill({ color: 0xf2c14e, alpha: 0.7 });
    }
    for (const pf of s.puffs) {
      const r = 6 + pf.t * 60, a = 1 - pf.t / 0.5;
      const col = pf.kind === "snuff" ? 0x9aa0b0 : pf.kind === "hurt" ? 0xff5050 : pf.kind === "light" ? 0xffe6a0 : 0xf2c14e;
      ui.circle(Math.round(pf.x), Math.round(pf.y), r).stroke({ width: 3, color: col, alpha: a });
    }
    if (h.anim === "melee") fx.ellipse(Math.round(h.x), Math.round(h.y), R.meleeReach, R.meleeReach / 2).stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
    for (const l of s.lamps) {
      if (!l.lit) {   // dark lamp: pulsing marker and relight progress
        const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
        ui.ellipse(l.x, l.y, 26, 13).stroke({ width: 2, color: 0xffd27a, alpha: 0.35 + 0.4 * pulse });
        if (l.relight > 0) ui.arc(l.x, l.y - 70, 9, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * l.relight) / R.relight).stroke({ width: 3, color: 0xffe6a0 });
      }
    }
    for (const m of s.monsters) {   // clawing a lamp: red progress over it
      if (m.snuff <= 0) continue;
      const k = m.snuff / (MONSTER[m.kind].snuff * R.snuffMul);
      ui.arc(m.x, m.y - 74, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ width: 3, color: 0xff5a4a });
    }
    for (const m of s.monsters) if (MONSTER[m.kind].hp > 1)
      for (let i = 0; i < m.hp; i++) ui.rect(m.x - 8 + i * 6, m.y - 84, 4, 3).fill(0xff5a4a);
  }

  return {
    setState(s, sx) { state = s; sex = sx; keys.clear(); },
    setPaused(p) { paused = p; if (p) keys.clear(); },
    destroy() {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      app.canvas.removeEventListener("pointerdown", click);
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
