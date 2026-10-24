"use client";

import { Application, extend, useApplication, useTick } from "@pixi/react";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANCHOR_Y, FPS, FRAMES, assetList, heroKey, type Sex } from "@/lib/assets";
import {
  CX, CY, H, HALF_H, HALF_W, MAX_HEALTH, MONSTER, W, newState, step, type Input, type State,
} from "@/lib/sim";

extend({ Container, Graphics, Sprite });

type Tex = Record<string, Texture>;

const SETTINGS = [
  { id: "greek", label: "Greek", live: true },
  { id: "norse", label: "Norse", live: false },
  { id: "egyptian", label: "Egyptian", live: false },
];

function drawGround(g: Graphics) {
  g.clear();
  g.rect(0, 0, W, H).fill(0x1e5f8a); // sea
  // soft sea bands
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
  // plaza thickness (cliff face on the two lower edges)
  g.poly([CX - HALF_W, CY, CX, CY + HALF_H, CX, CY + HALF_H + 14, CX - HALF_W, CY + 14]).fill(0x8a7048);
  g.poly([CX + HALF_W, CY, CX, CY + HALF_H, CX, CY + HALF_H + 14, CX + HALF_W, CY + 14]).fill(0x6f5a3a);
  // central mosaic ring around the statue
  g.ellipse(CX, CY + 8, 70, 35).stroke({ width: 3, color: 0x3d6f8c });
  g.ellipse(CX, CY + 8, 46, 23).fill({ color: 0x3d6f8c, alpha: 0.35 });
  // dock planks along the lower-right edge
  for (let i = 0; i < 6; i++) {
    const x = CX + 270 + i * 14, y = CY + 108 - i * 7;
    g.poly([x, y, x + 34, y + 17, x + 34, y + 23, x, y + 6]).fill(i % 2 ? 0x8a6a3a : 0x9b7843);
  }
}

function Scene({ tex, sexRef, stateRef, onHud, paused }: {
  tex: Tex; sexRef: React.RefObject<Sex>; stateRef: React.RefObject<State>;
  onHud: (h: number, k: number, over: boolean) => void; paused: boolean;
}) {
  const { app } = useApplication();
  const keys = useRef(new Set<string>());
  const pend = useRef({ melee: false, ranged: false, aim: null as { x: number; y: number } | null });
  const [, force] = useState(0);
  const last = useRef({ h: -1, k: -1, o: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (k === "j" || k === " ") { if (!e.repeat) pend.current.melee = true; return; }
      if (k === "k") { if (!e.repeat) { pend.current.ranged = true; pend.current.aim = null; } return; }
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const click = (e: PointerEvent) => {
      const r = app.canvas.getBoundingClientRect();
      pend.current.ranged = true;
      pend.current.aim = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    app.canvas.addEventListener("pointerdown", click);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      app.canvas.removeEventListener("pointerdown", click);
    };
  }, [app]);

  useTick((ticker) => {
    const s = stateRef.current;
    const k = keys.current;
    const inp: Input = {
      dx: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
      dy: (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0),
      melee: pend.current.melee, ranged: pend.current.ranged, aim: pend.current.aim,
    };
    pend.current.melee = false; pend.current.ranged = false;
    if (!paused) step(s, Math.min(ticker.deltaMS / 1000, 0.05), inp);
    const l = last.current;
    if (l.h !== s.health || l.k !== s.kills || l.o !== s.over) {
      l.h = s.health; l.k = s.kills; l.o = s.over;
      onHud(s.health, s.kills, s.over);
    }
    force((n) => (n + 1) % 1e9);
  });

  const s = stateRef.current;
  const sex = sexRef.current;
  const hero = s.hero;
  const frame = Math.min(Math.floor(hero.frameT * FPS[hero.anim]) % Math.max(1, FRAMES[hero.anim]), FRAMES[hero.anim] - 1);
  const heroTex = tex[heroKey(sex, hero.anim, frame)];

  type Item = { key: string; y: number; node: React.ReactNode };
  const items: Item[] = [];
  const spr = (key: string, name: string, x: number, y: number, anchor: number, flip = false, t?: Texture) =>
    ({
      key, y, node: (
        <pixiSprite key={key} texture={t ?? tex[name]} anchor={{ x: 0.5, y: anchor }}
          x={Math.round(x)} y={Math.round(y)} scale={{ x: flip ? -1 : 1, y: 1 }} />
      ),
    }) as Item;

  items.push(spr("zeus", "zeus-statue", CX, CY + 14, ANCHOR_Y["zeus-statue"]));
  for (const [i, [x, y]] of ([[230, 322], [260, 372], [676, 378], [400, 444], [742, 330]] as const).entries())
    items.push(spr(`olive${i}`, "olive", x, y, ANCHOR_Y.olive));
  items.push(spr("temple", "temple", 372, 236, ANCHOR_Y.temple));
  items.push(spr("house", "house", 620, 240, ANCHOR_Y.house));
  items.push(spr("dock", "galley-dock", CX + 345, CY + 112, ANCHOR_Y["galley-dock"]));
  items.push(spr("trireme", "trireme", 130, 440 + Math.sin(s.elapsed * 1.5) * 4, ANCHOR_Y.trireme));
  for (const m of s.monsters) {
    const fly = MONSTER[m.kind].fly;
    const bob = Math.sin(m.t * (fly ? 7 : 5)) * (fly ? 6 : 2);
    items.push(spr(`m${m.id}`, m.kind, m.x, m.y - (fly ? 22 : 0) + bob, ANCHOR_Y[m.kind], m.x > CX));
  }
  items.push(spr("hero", "", hero.x, hero.y, ANCHOR_Y.hero, hero.left, heroTex));
  items.sort((a, b) => a.y - b.y);

  const drawFx = (g: Graphics) => {
    g.clear();
    for (const p of s.shots) {
      g.circle(Math.round(p.x), Math.round(p.y), 3).fill(sex === "male" ? 0xf4ecd8 : 0x8a8a8a);
      g.circle(Math.round(p.x - p.vx * 0.02), Math.round(p.y - p.vy * 0.02), 2).fill({ color: 0xf2c14e, alpha: 0.7 });
    }
    for (const p of s.puffs) {
      const r = 6 + p.t * 60;
      g.circle(Math.round(p.x), Math.round(p.y), r).stroke({ width: 3, color: 0xf2c14e, alpha: 1 - p.t / 0.4 });
    }
    // ground shadow-ish ring under the hero while attacking in melee
    if (hero.anim === "melee") g.ellipse(Math.round(hero.x), Math.round(hero.y), 72, 36).stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
  }; // new function identity every render, so @pixi/react redraws it each frame

  return (
    <pixiContainer>
      <pixiGraphics draw={drawGround} />
      {items.map((i) => i.node)}
      <pixiGraphics draw={drawFx} />
    </pixiContainer>
  );
}

export default function Game() {
  const [tex, setTex] = useState<Tex | null>(null);
  const [sex, setSex] = useState<Sex>("male");
  const [setting, setSetting] = useState("greek");
  const [hud, setHud] = useState({ health: MAX_HEALTH, kills: 0, over: false });
  const [run, setRun] = useState(0);
  const sexRef = useRef<Sex>("male");
  sexRef.current = sex;
  const stateRef = useRef<State>(null as unknown as State);
  if (!stateRef.current) stateRef.current = newState();

  useEffect(() => {
    let dead = false;
    const list = assetList();
    Assets.load(list).then((res: Record<string, Texture>) => {
      if (dead) return;
      for (const t of Object.values(res)) { t.source.scaleMode = "nearest"; }
      const out: Tex = {};
      for (const a of list) out[a.alias] = res[a.alias];
      setTex(out);
    });
    return () => { dead = true; };
  }, []);

  const onHud = useCallback((health: number, kills: number, over: boolean) => setHud({ health, kills, over }), []);
  const restart = () => {
    stateRef.current = newState();
    setHud({ health: MAX_HEALTH, kills: 0, over: false });
    setRun((r) => r + 1);
  };
  const appOptions = useMemo(() => ({
    width: W, height: H, background: 0x1e5f8a, antialias: false, roundPixels: true, resolution: 1, autoDensity: false,
  }), []);

  return (
    <div className="stage" data-health={hud.health} data-kills={hud.kills} data-over={hud.over ? 1 : 0} data-ready={tex ? 1 : 0}>
      {tex && (
        <Application key={run} {...appOptions}>
          <Scene tex={tex} sexRef={sexRef} stateRef={stateRef} onHud={onHud} paused={hud.over} />
        </Application>
      )}
      <div className="hud">
        <div className="title">LAMPWARDEN</div>
        <div className="stats">
          <div>Town health {hud.health}/{MAX_HEALTH}</div>
          <div className="bar"><i style={{ width: `${(hud.health / MAX_HEALTH) * 100}%` }} /></div>
          <div>Monsters slain: {hud.kills}</div>
        </div>
        <div className="right">
          <div className="settings">
            {SETTINGS.map((s) => (
              <button key={s.id} className={`btn ${setting === s.id ? "on" : ""}`} disabled={!s.live}
                title={s.live ? "" : "Coming soon"} onClick={() => s.live && setSetting(s.id)}>
                {s.label}{s.live ? "" : " (soon)"}
              </button>
            ))}
          </div>
          <div className="settings">
            <button className={`btn ${sex === "male" ? "on" : ""}`} onClick={() => setSex("male")}>Male hero</button>
            <button className={`btn ${sex === "female" ? "on" : ""}`} onClick={() => setSex("female")}>Female hero</button>
          </div>
        </div>
        <div className="help">WASD / arrows move · J or Space melee · K or click ranged</div>
        {hud.over && (
          <div className="over">
            <div>The town has fallen. {hud.kills} monsters slain.</div>
            <button className="btn" onClick={restart}>Light the lamps again</button>
          </div>
        )}
      </div>
    </div>
  );
}
