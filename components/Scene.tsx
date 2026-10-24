"use client";
// The Pixi scene as @pixi/react components, rendered inside Game's <Application>. The tree mirrors the scene graph and
// re-renders only when its structure changes: a night starts, a monster spawns or dies. Everything that moves is
// written straight to the Pixi objects through refs from memoised useTick callbacks; the sim itself steps at a fixed
// 60 Hz in a higher-priority tick, so every other callback (and Pixi's render) sees the stepped state.
import { extend, useTick } from "@pixi/react";
import { Container, type FederatedPointerEvent, Graphics, Sprite, type Ticker, UPDATE_PRIORITY } from "pixi.js";
import {
  createContext,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { heroKey, type Sex } from "@/lib/assets";
import { bindKeyboard, type Controls, consumePresses, liveInput, shootAt } from "@/lib/controls";
import { newGamepadMemory, pollGamepadForPlay } from "@/lib/gamepad";
import { glintFrame, heroLight, type LightPiece, lampFlicker, lampLight, lanternGlow } from "@/lib/light";
import { arrowTextureFor, createProjectileTextures, type ProjectileTextures, projectileFor } from "@/lib/projectiles";
import { STEP } from "@/lib/replay";
import {
  anchor,
  drawGround,
  drawMarks,
  drawSheet,
  drawSweep,
  heroFrame,
  lightsAlpha,
  nightTint,
  PROPS,
  type TextureMap,
} from "@/lib/scene";
import {
  CENTRE_X,
  type Hero as HeroState,
  type Input,
  type Lamp,
  MONSTER,
  type Monster,
  type State,
  step,
} from "@/lib/sim";

extend({ Container, Graphics, Sprite });

// Chooses the input for one sim step: live play passes `live` through (and records it), a replay ignores it.
export type Driver = (stepIndex: number, live: Input, state: State) => Input;
// What the scene shows: one night's state, whose warden it is, and who drives it. A new Night is a new scene structure.
export interface Night {
  state: State;
  sex: Sex;
  driver: Driver | null;
}

interface SceneProps {
  night: Night;
  textures: TextureMap;
  controls: Controls;
  paused: boolean;
  speed: number;
  frozenClock: number | null; // visual verifier: a fixed flicker/pulse phase
  onTick: (state: State) => void; // every frame, after the sim has stepped
  onReady: () => void; // the scene is on the stage
}

// Shared by every entity for the life of the scene: textures and the clock (seconds; the boat's bob, the dark lamps'
// pulse, the lights' flicker and glints). The clock is a ref so it can move every frame without a render.
interface SceneShared {
  textures: TextureMap;
  clock: RefObject<number>;
}
const SceneContext = createContext<SceneShared | null>(null);
function useScene(): SceneShared {
  const shared = useContext(SceneContext);
  if (!shared) throw new Error("Scene entities must be rendered inside <Scene>");
  return shared;
}

// Keeps a Pixi object in step with the sim: once when it mounts (before it is first drawn), then every frame.
function useFrame(update: () => void) {
  useLayoutEffect(update, [update]);
  useTick(update);
}

const noDraw = () => {}; // `draw` is required on pixiGraphics; per-frame layers redraw from useFrame instead

export const Scene = memo(function Scene({
  night,
  textures,
  controls,
  paused,
  speed,
  frozenClock,
  onTick,
  onReady,
}: SceneProps) {
  const clock = useRef(0);
  const shared = useMemo(() => ({ textures, clock }), [textures]);

  // per-frame settings, read by the sim tick without re-registering it
  const live = useRef({ paused, speed, frozenClock, onTick });
  useLayoutEffect(() => {
    live.current = { paused, speed, frozenClock, onTick };
  }, [paused, speed, frozenClock, onTick]);

  // a new night starts from step 0 with no keys held
  const run = useRef({ night, stepIndex: 0, accumulated: 0 });
  const gamepadMemory = useRef(newGamepadMemory());
  useLayoutEffect(() => {
    run.current = { night, stepIndex: 0, accumulated: 0 };
    controls.keys.clear();
  }, [night, controls]);

  useEffect(() => bindKeyboard(controls), [controls]);
  useEffect(() => {
    onReady();
  }, [onReady]);

  useTick({
    priority: UPDATE_PRIORITY.HIGH,
    callback: useCallback(
      (ticker: Ticker) => {
        const elapsedSeconds = Math.min(ticker.deltaMS / 1000, 0.05);
        const settings = live.current;
        clock.current = settings.frozenClock ?? clock.current + elapsedSeconds;
        const state = night.state;
        const progress = run.current;
        if (!settings.paused) {
          // fixed 60 Hz sim step, so a recorded night replays exactly
          progress.accumulated += elapsedSeconds * settings.speed;
          pollGamepadForPlay(controls, state, gamepadMemory.current);
          let input = liveInput(controls);
          while (progress.accumulated >= STEP && !state.outcome) {
            step(state, STEP, night.driver ? night.driver(progress.stepIndex, input, state) : input);
            progress.stepIndex++;
            progress.accumulated -= STEP;
            if (input.melee || input.ranged) {
              consumePresses(controls);
              input = { ...input, melee: false, ranged: false };
            }
          }
        }
        settings.onTick(state);
      },
      [night, controls],
    ),
  });

  // a click on the canvas shoots towards it
  const shoot = useCallback(
    (event: FederatedPointerEvent) => shootAt(controls, event.global.x, event.global.y),
    [controls],
  );
  const state = night.state;
  const sweep = useCallback((graphics: Graphics) => drawSweep(graphics, state), [state]);
  const marks = useCallback((graphics: Graphics) => drawMarks(graphics, state, clock.current), [state]);

  return (
    <SceneContext.Provider value={shared}>
      <pixiGraphics draw={drawGround} eventMode="static" onPointerDown={shoot} />
      <pixiContainer sortableChildren>
        {PROPS.map(([key, x, y]) => (
          <pixiSprite key={`${key}@${x},${y}`} texture={textures[key]} anchor={anchor(key)} x={x} y={y} zIndex={y} />
        ))}
        <Trireme />
        <Hero hero={state.hero} sex={night.sex} />
        {state.lamps.map((lamp) => (
          <LampPost key={`lamp@${lamp.x},${lamp.y}`} lamp={lamp} />
        ))}
        <Monsters state={state} />
      </pixiContainer>
      <Strokes draw={sweep} />
      <NightSheet state={state} />
      <Lights state={state}>
        <HeroLight hero={state.hero} />
        {state.lamps.map((lamp) => (
          <LampLight key={`light@${lamp.x},${lamp.y}`} lamp={lamp} radius={state.rules.lightRadius} />
        ))}
      </Lights>
      <Projectiles state={state} sex={night.sex} />
      <Strokes draw={marks} />
    </SceneContext.Provider>
  );
});

function Trireme() {
  const { textures, clock } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      if (ref.current) ref.current.y = 440 + Math.sin(clock.current * 1.5) * 4;
    }, [clock]),
  );
  return <pixiSprite ref={ref} texture={textures.trireme} anchor={anchor("trireme")} x={130} y={440} zIndex={440} />;
}

const Hero = memo(function Hero({ hero, sex }: { hero: HeroState; sex: Sex }) {
  const { textures } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const sprite = ref.current;
      const texture = textures[heroKey(sex, hero.animation, heroFrame(hero.animation, hero.frameTime))];
      if (!sprite || !texture) return;
      sprite.texture = texture;
      sprite.position.set(Math.round(hero.x), Math.round(hero.y));
      sprite.zIndex = hero.y;
      sprite.scale.x = hero.left ? -1 : 1;
      sprite.tint = hero.hurt > 0 ? 0xff8080 : 0xffffff;
    }, [textures, hero, sex]),
  );
  return <pixiSprite ref={ref} texture={textures[heroKey(sex, "idle", 0)]} anchor={anchor("hero")} />;
});

const LampPost = memo(function LampPost({ lamp }: { lamp: Lamp }) {
  const { textures } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const texture = textures[lamp.lit ? "lamp-lit" : "lamp-unlit"];
      if (ref.current && texture) ref.current.texture = texture;
    }, [textures, lamp]),
  );
  return (
    <pixiSprite
      ref={ref}
      texture={textures["lamp-lit"]}
      anchor={anchor("lamp-lit")}
      x={lamp.x}
      y={lamp.y}
      zIndex={lamp.y}
    />
  );
});

// The monster list is the only React state that changes during a night: when one spawns or dies, not every frame.
function Monsters({ state }: { state: State }) {
  const [shown, setShown] = useState({ state, list: state.monsters.slice() });
  // a new night replaces the list in the same render, so the last night's monsters are never drawn over it
  const current = shown.state === state ? shown : { state, list: state.monsters.slice() };
  if (current !== shown) setShown(current);
  const lastHandedToReact = useRef(current.list); // so a pending render is not asked for twice
  useLayoutEffect(() => {
    lastHandedToReact.current = current.list;
  }, [current]);
  useTick(
    useCallback(() => {
      const monsters = state.monsters;
      const handed = lastHandedToReact.current;
      if (monsters.length === handed.length && monsters.every((monster, index) => monster === handed[index])) return;
      lastHandedToReact.current = monsters.slice();
      setShown({ state, list: lastHandedToReact.current });
    }, [state]),
  );
  return current.list.map((monster) => <MonsterSprite key={monster.id} monster={monster} />);
}

const MonsterSprite = memo(function MonsterSprite({ monster }: { monster: Monster }) {
  const { textures } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const sprite = ref.current;
      if (!sprite) return;
      const flying = MONSTER[monster.kind].fly;
      const bob = Math.sin(monster.age * (flying ? 7 : 5)) * (flying ? 6 : 2);
      sprite.position.set(Math.round(monster.x), Math.round(monster.y - (flying ? 22 : 0) + bob));
      sprite.zIndex = monster.y;
      sprite.scale.x = monster.x > CENTRE_X ? -1 : 1;
      sprite.tint = monster.hurt > 0 ? 0xff7070 : 0xffffff;
    }, [monster]),
  );
  return <pixiSprite ref={ref} texture={textures[monster.kind]} anchor={anchor(monster.kind)} />;
});

// a Graphics layer cleared and redrawn every frame (shots, puffs, rings)
function Strokes({ draw }: { draw: (graphics: Graphics) => void }) {
  const ref = useRef<Graphics>(null);
  useFrame(
    useCallback(() => {
      const graphics = ref.current;
      if (!graphics) return;
      graphics.clear();
      draw(graphics);
    }, [draw]),
  );
  return <pixiGraphics ref={ref} draw={noDraw} />;
}

const nightProgress = (state: State) => Math.min(1, state.elapsed / state.length);

// the night, multiplied over everything below it: deep blue, warming to dawn
function NightSheet({ state }: { state: State }) {
  const ref = useRef<Graphics>(null);
  useFrame(
    useCallback(() => {
      if (ref.current) ref.current.tint = nightTint(nightProgress(state));
    }, [state]),
  );
  return <pixiGraphics ref={ref} draw={drawSheet} blendMode="multiply" />;
}

// additive lights over the night; they fade as dawn comes
function Lights({ state, children }: { state: State; children: ReactNode }) {
  const ref = useRef<Container>(null);
  useFrame(
    useCallback(() => {
      if (ref.current) ref.current.alpha = lightsAlpha(nightProgress(state));
    }, [state]),
  );
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
  useFrame(
    useCallback(() => {
      const sprite = ref.current;
      if (!sprite) return;
      const centerX = Math.round(hero.x),
        centerY = Math.round(hero.y) - 4;
      place(sprite, heroLight(centerX, centerY, clock.current), centerX, centerY);
    }, [hero, clock]),
  );
  return <pixiSprite ref={ref} blendMode="add" />;
});

// A lit lamp's light, all of it precomputed in lib/light.ts: the pool on the ground, the lantern glowing in its own
// colours inside a halo, and the glints on the stone, the brass and the sea. A dark lamp shows none of it.
const LampLight = memo(function LampLight({ lamp, radius }: { lamp: Lamp; radius: number }) {
  const { textures, clock } = useScene();
  const lantern = lanternGlow(textures["lamp-lit"]);
  const light = useMemo(() => lampLight(lamp.x, lamp.y, radius), [lamp.x, lamp.y, radius]);
  const group = useRef<Container>(null),
    pool = useRef<Sprite>(null),
    halo = useRef<Sprite>(null);
  const glintSprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const groupContainer = group.current,
        poolSprite = pool.current,
        haloSprite = halo.current;
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
    }, [lamp, light, clock]),
  );
  return (
    <pixiContainer ref={group}>
      <pixiSprite ref={pool} blendMode="add" />
      <pixiSprite ref={halo} blendMode="add" />
      <pixiSprite
        texture={lantern.texture}
        x={lamp.x + lantern.offsetX}
        y={lamp.y + lantern.offsetY}
        blendMode="add"
        alpha={0.45}
      />
      {light.glints.map((glint, index) => (
        <pixiSprite
          key={`${glint.x},${glint.y}`}
          ref={(sprite: Sprite | null) => {
            glintSprites.current[index] = sprite;
          }}
          blendMode="add"
        />
      ))}
    </pixiContainer>
  );
});

// Shots in flight, above the night tint so they stay readable: arrows for the bow, stones for the sling. Sprites are
// pooled by shot id and moved from the tick, so a volley never causes a React render.
function Projectiles({ state, sex }: { state: State; sex: Sex }) {
  const textures = useMemo<ProjectileTextures>(createProjectileTextures, []);
  const layer = useRef<Container>(null);
  const spritesByShot = useRef(new Map<number, Sprite>());
  useFrame(
    useCallback(() => {
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
        sprite.texture = kind === "arrow" ? arrowTextureFor(textures, shot.velocityX, shot.velocityY) : textures.stone;
        sprite.position.set(Math.round(shot.x), Math.round(shot.y));
      }
      for (const [shotId, sprite] of spritesByShot.current) {
        if (inFlight.has(shotId)) continue;
        sprite.destroy();
        spritesByShot.current.delete(shotId);
      }
    }, [state, sex, textures]),
  );
  return <pixiContainer ref={layer} />;
}
