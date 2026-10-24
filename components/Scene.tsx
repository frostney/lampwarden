"use client";
// The Pixi scene as @pixi/react components, rendered inside Game's <Application>. The tree mirrors the scene graph and
// re-renders only when its structure changes: a night starts, a monster spawns or dies. Everything that moves is
// written straight to the Pixi objects through refs from memoised useTick callbacks; the sim itself steps at a fixed
// 60 Hz in a higher-priority tick, so every other callback (and Pixi's render) sees the stepped state.
import { extend, useTick } from "@pixi/react";
import { Container, Graphics, Sprite, UPDATE_PRIORITY, type FederatedPointerEvent, type Texture, type Ticker } from "pixi.js";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { heroKey, type Sex } from "@/lib/assets";
import { bindKeyboard, consumePresses, liveInput, shootAt, type Controls } from "@/lib/controls";
import { newGamepadMemory, pollGamepadForPlay } from "@/lib/gamepad";
import { arrowTextureFor, createProjectileTextures, projectileFor, type ProjectileTextures } from "@/lib/projectiles";
import { STEP } from "@/lib/replay";
import {
  PROPS, anchor, drawGround, drawMarks, drawSheet, drawSweep, flicker, glowTexture, heroFrame, lightsAlpha, nightTint, type Tex,
} from "@/lib/scene";
import { CX, MONSTER, step, type Hero as HeroState, type Input, type Lamp, type Monster, type Rules, type State } from "@/lib/sim";

extend({ Container, Graphics, Sprite });

// Chooses the input for sim step n: live play passes `live` through (and records it), a replay ignores it.
export type Driver = (n: number, live: Input, s: State) => Input;
// What the scene shows: one night's state, whose warden it is, and who drives it. A new Night is a new scene structure.
export interface Night { state: State; sex: Sex; driver: Driver | null }

interface SceneProps {
  night: Night;
  tex: Tex;
  controls: Controls;
  paused: boolean;
  speed: number;
  frozenClock: number | null;   // visual verifier: a fixed flicker/pulse phase
  onTick: (s: State) => void;   // every frame, after the sim has stepped
  onReady: () => void;          // the scene is on the stage
}

// Shared by every entity for the life of the scene: textures, the glow disc and the clock (seconds; the boat's bob and
// the dark lamps' pulse). The clock is a ref so it can move every frame without a render.
const SceneContext = createContext<{ tex: Tex; glow: Texture; clock: RefObject<number> } | null>(null);
const useScene = () => useContext(SceneContext)!;

// Keeps a Pixi object in step with the sim: once when it mounts (before it is first drawn), then every frame.
function useFrame(update: () => void) {
  useLayoutEffect(update, [update]);
  useTick(update);
}

const noDraw = () => {};   // `draw` is required on pixiGraphics; per-frame layers redraw from useFrame instead

export const Scene = memo(function Scene({ night, tex, controls, paused, speed, frozenClock, onTick, onReady }: SceneProps) {
  const glow = useMemo(glowTexture, []);
  const clock = useRef(0);
  const ctx = useMemo(() => ({ tex, glow, clock }), [tex, glow]);

  // per-frame settings, read by the sim tick without re-registering it
  const live = useRef({ paused, speed, frozenClock, onTick });
  useLayoutEffect(() => { live.current = { paused, speed, frozenClock, onTick }; }, [paused, speed, frozenClock, onTick]);

  // a new night starts from step 0 with no keys held
  const run = useRef({ n: 0, acc: 0 });
  const gamepadMemory = useRef(newGamepadMemory());
  useLayoutEffect(() => { run.current = { n: 0, acc: 0 }; controls.keys.clear(); }, [night, controls]);

  useEffect(() => bindKeyboard(controls), [controls]);
  useEffect(() => { onReady(); }, [onReady]);

  useTick({
    priority: UPDATE_PRIORITY.HIGH,
    callback: useCallback((t: Ticker) => {
      const dt = Math.min(t.deltaMS / 1000, 0.05);
      const { paused, speed, frozenClock, onTick } = live.current;
      clock.current = frozenClock ?? clock.current + dt;
      const s = night.state, r = run.current;
      if (!paused) {
        // fixed 60 Hz sim step, so a recorded night replays exactly
        r.acc += dt * speed;
        pollGamepadForPlay(controls, s, gamepadMemory.current);
        let inp = liveInput(controls);
        while (r.acc >= STEP && !s.outcome) {
          step(s, STEP, night.driver ? night.driver(r.n, inp, s) : inp);
          r.n++; r.acc -= STEP;
          if (inp.melee || inp.ranged) { consumePresses(controls); inp = { ...inp, melee: false, ranged: false }; }
        }
      }
      onTick(s);
    }, [night, controls]),
  });

  // a click on the canvas shoots towards it
  const shoot = useCallback((e: FederatedPointerEvent) => shootAt(controls, e.global.x, e.global.y), [controls]);
  const s = night.state;
  const sweep = useCallback((g: Graphics) => drawSweep(g, s), [s]);
  const marks = useCallback((g: Graphics) => drawMarks(g, s, clock.current), [s]);

  return (
    <SceneContext.Provider value={ctx}>
      <pixiGraphics draw={drawGround} eventMode="static" onPointerDown={shoot} />
      <pixiContainer sortableChildren>
        {PROPS.map(([k, x, y], i) => <pixiSprite key={i} texture={tex[k]} anchor={anchor(k)} x={x} y={y} zIndex={y} />)}
        <Trireme />
        <Hero hero={s.hero} sex={night.sex} />
        {s.lamps.map((l, i) => <LampPost key={i} lamp={l} />)}
        <Monsters state={s} />
      </pixiContainer>
      <Strokes draw={sweep} />
      <NightSheet state={s} />
      <Lights state={s}>
        <HeroGlow hero={s.hero} />
        {s.lamps.map((l, i) => <LampGlow key={i} lamp={l} rules={s.rules} />)}
      </Lights>
      <Projectiles state={s} sex={night.sex} />
      <Strokes draw={marks} />
    </SceneContext.Provider>
  );
});

function Trireme() {
  const { tex, clock } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => { ref.current!.y = 440 + Math.sin(clock.current * 1.5) * 4; }, [clock]));
  return <pixiSprite ref={ref} texture={tex.trireme} anchor={anchor("trireme")} x={130} y={440} zIndex={440} />;
}

const Hero = memo(function Hero({ hero: h, sex }: { hero: HeroState; sex: Sex }) {
  const { tex } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => {
    const sp = ref.current!;
    sp.texture = tex[heroKey(sex, h.anim, heroFrame(h.anim, h.frameT))];
    sp.position.set(Math.round(h.x), Math.round(h.y)); sp.zIndex = h.y;
    sp.scale.x = h.left ? -1 : 1;
    sp.tint = h.hurt > 0 ? 0xff8080 : 0xffffff;
  }, [tex, h, sex]));
  return <pixiSprite ref={ref} texture={tex[heroKey(sex, "idle", 0)]} anchor={anchor("hero")} />;
});

const LampPost = memo(function LampPost({ lamp }: { lamp: Lamp }) {
  const { tex } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => { ref.current!.texture = tex[lamp.lit ? "lamp-lit" : "lamp-unlit"]; }, [tex, lamp]));
  return <pixiSprite ref={ref} texture={tex["lamp-lit"]} anchor={anchor("lamp-lit")} x={lamp.x} y={lamp.y} zIndex={lamp.y} />;
});

// The monster list is the only React state that changes during a night: when one spawns or dies, not every frame.
function Monsters({ state }: { state: State }) {
  const [shown, setShown] = useState({ state, list: state.monsters.slice() });
  // a new night replaces the list in the same render, so the last night's monsters are never drawn over it
  const cur = shown.state === state ? shown : { state, list: state.monsters.slice() };
  if (cur !== shown) setShown(cur);
  const last = useRef(cur.list);   // the list last handed to React, so a pending render is not asked for twice
  useLayoutEffect(() => { last.current = cur.list; }, [cur]);
  useTick(useCallback(() => {
    const ms = state.monsters, c = last.current;
    if (ms.length === c.length && ms.every((m, i) => m === c[i])) return;
    last.current = ms.slice();
    setShown({ state, list: last.current });
  }, [state]));
  return cur.list.map((m) => <MonsterSprite key={m.id} m={m} />);
}

const MonsterSprite = memo(function MonsterSprite({ m }: { m: Monster }) {
  const { tex } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => {
    const sp = ref.current!, fly = MONSTER[m.kind].fly;
    const bob = Math.sin(m.t * (fly ? 7 : 5)) * (fly ? 6 : 2);
    sp.position.set(Math.round(m.x), Math.round(m.y - (fly ? 22 : 0) + bob)); sp.zIndex = m.y;
    sp.scale.x = m.x > CX ? -1 : 1;
    sp.tint = m.hurt > 0 ? 0xff7070 : 0xffffff;
  }, [m]));
  return <pixiSprite ref={ref} texture={tex[m.kind]} anchor={anchor(m.kind)} />;
});

// a Graphics layer cleared and redrawn every frame (shots, puffs, rings)
function Strokes({ draw }: { draw: (g: Graphics) => void }) {
  const ref = useRef<Graphics>(null);
  useFrame(useCallback(() => { const g = ref.current!; g.clear(); draw(g); }, [draw]));
  return <pixiGraphics ref={ref} draw={noDraw} />;
}

const progress = (s: State) => Math.min(1, s.elapsed / s.length);

// the night, multiplied over everything below it: deep blue, warming to dawn
function NightSheet({ state }: { state: State }) {
  const ref = useRef<Graphics>(null);
  useFrame(useCallback(() => { ref.current!.tint = nightTint(progress(state)); }, [state]));
  return <pixiGraphics ref={ref} draw={drawSheet} blendMode="multiply" />;
}

// additive lights over the night; they fade as dawn comes
function Lights({ state, children }: { state: State; children: ReactNode }) {
  const ref = useRef<Container>(null);
  useFrame(useCallback(() => { ref.current!.alpha = lightsAlpha(progress(state)); }, [state]));
  return <pixiContainer ref={ref}>{children}</pixiContainer>;
}

const HeroGlow = memo(function HeroGlow({ hero: h }: { hero: HeroState }) {
  const { glow } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => { ref.current!.position.set(h.x, h.y - 4); }, [h]));
  return <pixiSprite ref={ref} texture={glow} anchor={0.5} blendMode="add" width={120} height={60} alpha={0.5} />;
});

// a lit lamp's pool of light on the ground and the glow of the lantern itself
const LampGlow = memo(function LampGlow({ lamp: l, rules }: { lamp: Lamp; rules: Rules }) {
  const { glow } = useScene();
  const pool = useRef<Sprite>(null), head = useRef<Sprite>(null);
  useFrame(useCallback(() => {
    const f = flicker(l), g = pool.current!, hd = head.current!;
    g.visible = hd.visible = l.lit;
    g.width = rules.lightR * 2.2 * f; g.height = rules.lightR * 1.1 * f;
    hd.width = hd.height = 46 * f;
  }, [l, rules]));
  return (
    <>
      <pixiSprite ref={pool} texture={glow} anchor={0.5} blendMode="add" x={l.x} y={l.y - 6} />
      <pixiSprite ref={head} texture={glow} anchor={0.5} blendMode="add" alpha={0.8} x={l.x} y={l.y - 78} />
    </>
  );
});

// Shots in flight, above the night tint so they stay readable: arrows for the bow, stones for the sling. Sprites are
// pooled by shot id and moved from the tick, so a volley never causes a React render.
function Projectiles({ state, sex }: { state: State; sex: Sex }) {
  const textures = useMemo<ProjectileTextures>(createProjectileTextures, []);
  const layer = useRef<Container>(null);
  const spritesByShot = useRef(new Map<number, Sprite>());
  useFrame(useCallback(() => {
    const container = layer.current;
    if (!container) return;
    const kind = projectileFor(sex);
    const inFlight = new Set<number>();
    for (const shot of state.shots) {
      inFlight.add(shot.id);
      let sprite = spritesByShot.current.get(shot.id);
      if (!sprite) {
        sprite = new Sprite(textures.stone);
        sprite.anchor.set(0.5);
        container.addChild(sprite);
        spritesByShot.current.set(shot.id, sprite);
      }
      sprite.texture = kind === "arrow" ? arrowTextureFor(textures, shot.vx, shot.vy) : textures.stone;
      sprite.position.set(Math.round(shot.x), Math.round(shot.y));
    }
    for (const [shotId, sprite] of spritesByShot.current) {
      if (inFlight.has(shotId)) continue;
      sprite.destroy();
      spritesByShot.current.delete(shotId);
    }
  }, [state, sex, textures]));
  return <pixiContainer ref={layer} />;
}
