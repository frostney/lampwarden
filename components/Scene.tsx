"use client";
// The Pixi scene as @pixi/react components, rendered inside Game's <Application>. The tree mirrors the scene graph and
// re-renders only when its structure changes: a night starts, a monster spawns or dies. Everything that moves is
// written straight to the Pixi objects through refs from memoised useTick callbacks; the sim itself steps at a fixed
// 60 Hz in a higher-priority tick, so every other callback (and Pixi's render) sees the stepped state.
import { extend, useTick } from "@pixi/react";
import { Container, Graphics, Sprite, UPDATE_PRIORITY, type FederatedPointerEvent, type Ticker } from "pixi.js";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { heroKey, type Sex } from "@/lib/assets";
import { bindKeyboard, consumePresses, liveInput, shootAt, type Controls } from "@/lib/controls";
import { glintFrame, heroLight, lampFlicker, lampLight, lanternGlow, type LightPiece } from "@/lib/light";
import { STEP } from "@/lib/replay";
import {
  PROPS, anchor, drawGround, drawMarks, drawSheet, drawSweep, heroFrame, lightsAlpha, nightTint, type Tex,
} from "@/lib/scene";
import { CX, MONSTER, step, type Hero as HeroState, type Input, type Lamp, type Monster, type State } from "@/lib/sim";

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

// Shared by every entity for the life of the scene: textures and the clock (seconds; the boat's bob, the dark lamps'
// pulse, the lights' flicker and glints). The clock is a ref so it can move every frame without a render.
const SceneContext = createContext<{ tex: Tex; clock: RefObject<number> } | null>(null);
const useScene = () => useContext(SceneContext)!;

// Keeps a Pixi object in step with the sim: once when it mounts (before it is first drawn), then every frame.
function useFrame(update: () => void) {
  useLayoutEffect(update, [update]);
  useTick(update);
}

const noDraw = () => {};   // `draw` is required on pixiGraphics; per-frame layers redraw from useFrame instead

export const Scene = memo(function Scene({ night, tex, controls, paused, speed, frozenClock, onTick, onReady }: SceneProps) {
  const clock = useRef(0);
  const ctx = useMemo(() => ({ tex, clock }), [tex]);

  // per-frame settings, read by the sim tick without re-registering it
  const live = useRef({ paused, speed, frozenClock, onTick });
  useLayoutEffect(() => { live.current = { paused, speed, frozenClock, onTick }; }, [paused, speed, frozenClock, onTick]);

  // a new night starts from step 0 with no keys held
  const run = useRef({ n: 0, acc: 0 });
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
        <HeroLight hero={s.hero} />
        {s.lamps.map((lamp, index) => <LampLight key={index} lamp={lamp} radius={s.rules.lightR} />)}
      </Lights>
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

// a light piece drawn at a point: its texture, placed by its top-left offset
function place(sprite: Sprite, piece: LightPiece, x: number, y: number) {
  sprite.texture = piece.texture;
  sprite.position.set(x + piece.offsetX, y + piece.offsetY);
}

// the warden's own small light, in the same stepped bands as the lamps
const HeroLight = memo(function HeroLight({ hero }: { hero: HeroState }) {
  const { clock } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(useCallback(() => {
    const sprite = ref.current;
    if (!sprite) return;
    const centerX = Math.round(hero.x), centerY = Math.round(hero.y) - 4;
    place(sprite, heroLight(centerX, centerY, clock.current), centerX, centerY);
  }, [hero, clock]));
  return <pixiSprite ref={ref} blendMode="add" />;
});

// A lit lamp's light, all of it precomputed in lib/light.ts: the pool on the ground, the lantern glowing in its own
// colours inside a halo, and the glints on the stone, the brass and the sea. A dark lamp shows none of it.
const LampLight = memo(function LampLight({ lamp, radius }: { lamp: Lamp; radius: number }) {
  const { tex, clock } = useScene();
  const lantern = lanternGlow(tex["lamp-lit"]);
  const light = useMemo(() => lampLight(lamp.x, lamp.y, radius), [lamp.x, lamp.y, radius]);
  const group = useRef<Container>(null), pool = useRef<Sprite>(null), halo = useRef<Sprite>(null);
  const glintSprites = useRef<(Sprite | null)[]>([]);
  useFrame(useCallback(() => {
    const groupContainer = group.current, poolSprite = pool.current, haloSprite = halo.current;
    if (!groupContainer || !poolSprite || !haloSprite) return;
    groupContainer.visible = lamp.lit;
    if (!lamp.lit) return;
    const variant = lampFlicker(light, clock.current);
    place(poolSprite, light.pools[variant], light.poolX, light.poolY);
    place(haloSprite, light.halos[variant], light.haloX, light.haloY);
    light.glints.forEach((glint, index) => {
      const sprite = glintSprites.current[index];
      if (!sprite) return;
      const frame = glintFrame(glint, clock.current);
      sprite.visible = frame !== null;
      if (frame) place(sprite, frame, glint.x, glint.y);
    });
  }, [lamp, light, clock]));
  return (
    <pixiContainer ref={group}>
      <pixiSprite ref={pool} blendMode="add" />
      <pixiSprite ref={halo} blendMode="add" />
      <pixiSprite texture={lantern.texture} x={lamp.x + lantern.offsetX} y={lamp.y + lantern.offsetY} blendMode="add" alpha={0.45} />
      {light.glints.map((glint, index) => (
        <pixiSprite key={index} ref={(sprite: Sprite | null) => { glintSprites.current[index] = sprite; }} blendMode="add" />
      ))}
    </pixiContainer>
  );
});
