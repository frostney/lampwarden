"use client";
// The Pixi scene as @pixi/react components, rendered inside Game's <Application>. The tree mirrors the scene graph and
// re-renders only when its structure changes: a night starts, a monster spawns or dies. Everything that moves is
// written straight to the Pixi objects through refs from memoised useTick callbacks; the sim itself steps at a fixed
// 60 Hz in a higher-priority tick, so every other callback (and Pixi's render) sees the stepped state.
import { extend, useTick } from "@pixi/react";
import {
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Ticker,
  TilingSprite,
  UPDATE_PRIORITY,
} from "pixi.js";
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
import { bindKeyboard, type Controls, consumePresses, liveInput, shootAt } from "@/game/controls";
import { newGamepadMemory, pollGamepadForPlay } from "@/game/gamepad";
import { STEP } from "@/game/replay";
import {
  CENTRE_X,
  type Hero as HeroState,
  type Input,
  type Lamp,
  MONSTER,
  type Monster,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type State,
  step,
} from "@/game/sim";
import { heroKey, type Sex } from "@/scene/assets";
import {
  anchor,
  drawGround,
  drawMarks,
  drawSweep,
  heroFrame,
  lightsAlpha,
  nightProgress,
  nightTint,
  PROPS,
  type TextureMap,
  textureFor,
} from "@/scene/layers";
import { glintFrame, heroLight, type LightPiece, lampFlicker, lampFoot, lampLight, lanternGlow } from "@/scene/light";
import {
  type CharacterLight,
  DARK_CHARACTER,
  lampFootTint,
  lightCharacter,
  mirroredOctant,
  type RimSpec,
} from "@/scene/lighting";
import { arrowTextureFor, createProjectileTextures, type ProjectileTextures, projectileFor } from "@/scene/projectiles";
import { rimTexture } from "@/scene/rim";
import { shadowPiece } from "@/scene/shadow";
import {
  LIGHTHOUSE_LAMP,
  lighthouseFrame,
  MOON_GLITTER,
  moonGlitterFrame,
  skyTexture,
  TWINKLES,
  twinkleFrame,
} from "@/scene/sky";
import { createWater, HORIZON_Y, swellDrift, waterFrame } from "@/scene/water";

extend({ Container, Graphics, Sprite, TilingSprite });

const STAGE_AREA = new Rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT); // the scene takes clicks anywhere on the canvas

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

// Shared by every entity for the life of the scene: textures, the clock (seconds; the boat's bob, the dark lamps'
// pulse, the lights' flicker and glints) and how the lamps light each character. The clock is a ref so it can move every
// frame without a render; the lighting is worked out once a frame, right after the sim steps, and read by identity.
type Lighting = Map<object, CharacterLight>;
interface SceneShared {
  textures: TextureMap;
  clock: RefObject<number>;
  lighting: Lighting;
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
  const lighting = useMemo<Lighting>(() => new Map(), []);
  const shared = useMemo(() => ({ textures, clock, lighting }), [textures, lighting]);

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
        lightCharacters(state, lighting, clock.current);
        settings.onTick(state);
      },
      [night, controls, lighting],
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
      <pixiContainer eventMode="static" hitArea={STAGE_AREA} onPointerDown={shoot}>
        <Sky state={state} />
        <World state={state}>
          <Water />
          <pixiGraphics draw={drawGround} />
        </World>
        <GroundLights state={state}>
          <MoonGlitter />
          <HeroLight hero={state.hero} />
          {state.lamps.map((lamp) => (
            <LampPool key={`pool@${lamp.x},${lamp.y}`} lamp={lamp} radius={state.rules.lightRadius} />
          ))}
        </GroundLights>
        <Shadows state={state} />
        <pixiContainer sortableChildren>
          <Props state={state} />
          <Trireme state={state} />
          <Hero state={state} sex={night.sex} />
          {state.lamps.map((lamp) => (
            <LampPost key={`lamp@${lamp.x},${lamp.y}`} state={state} lamp={lamp} />
          ))}
          {state.lamps.map((lamp) => (
            <LampGlow key={`glow@${lamp.x},${lamp.y}`} state={state} lamp={lamp} radius={state.rules.lightRadius} />
          ))}
          <Monsters state={state} />
        </pixiContainer>
        <World state={state}>
          <Strokes draw={sweep} />
        </World>
      </pixiContainer>
      <Projectiles state={state} sex={night.sex} />
      <Strokes draw={marks} />
    </SceneContext.Provider>
  );
});

// The sky above the horizon, painted in src/scene/sky.ts in its final colours (it is not under the night tint): the
// stage's sky, the twinkling stars and the lighthouse's lamp, picked from the night's progress and the clock.
function Sky({ state }: { state: State }) {
  const { clock } = useScene();
  const sky = useRef<Sprite>(null);
  const lighthouse = useRef<Sprite>(null);
  const twinkleSprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const progress = nightProgress(state);
      if (sky.current) sky.current.texture = skyTexture(progress);
      TWINKLES.forEach((twinkle, index) => {
        const sprite = twinkleSprites.current[index];
        if (!sprite) return;
        const piece = twinkleFrame(twinkle, clock.current, progress);
        sprite.visible = piece !== null;
        if (piece) place(sprite, piece, twinkle.x, twinkle.y);
      });
      const lamp = lighthouse.current;
      if (lamp) {
        const piece = lighthouseFrame(clock.current, progress);
        lamp.visible = piece !== null;
        if (piece) place(lamp, piece, LIGHTHOUSE_LAMP.x, LIGHTHOUSE_LAMP.y);
      }
    }, [state, clock]),
  );
  return (
    <pixiContainer>
      <pixiSprite ref={sky} />
      {TWINKLES.map((twinkle, index) => (
        <pixiSprite
          key={`${twinkle.x},${twinkle.y}`}
          ref={(sprite: Sprite | null) => {
            twinkleSprites.current[index] = sprite;
          }}
        />
      ))}
      <pixiSprite ref={lighthouse} />
    </pixiContainer>
  );
}

// Everything below the horizon, tinted by the night: deep blue, warming to dawn. The tint multiplies every pixel of the
// world as a multiply sheet over it would, but leaves the sky out, so its stars and moon keep their own colours.
function World({ state, children }: { state: State; children: ReactNode }) {
  const ref = useRef<Container>(null);
  useFrame(
    useCallback(() => {
      if (ref.current) ref.current.tint = nightTint(nightProgress(state));
    }, [state]),
  );
  return <pixiContainer ref={ref}>{children}</pixiContainer>;
}

// the moon's broken path on the far sea, added over the night like the lamps' light
function MoonGlitter() {
  const { clock } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const texture = moonGlitterFrame(clock.current);
      if (ref.current && texture) ref.current.texture = texture;
    }, [clock]),
  );
  return <pixiSprite ref={ref} x={MOON_GLITTER.x} y={MOON_GLITTER.y} blendMode="add" />;
}

// The sea, all of it painted once in src/scene/water.ts: the still depths, the swell tiled over the canvas and drifting
// down the grid, and the surf in patches along the plaza; each frame only picks the loop's textures from the clock.
function Water() {
  const { clock } = useScene();
  const water = useMemo(createWater, []);
  const swell = useRef<TilingSprite>(null);
  const patchSprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const frame = waterFrame(clock.current);
      const swellSprite = swell.current;
      const swellTexture = water.swell[frame];
      if (swellSprite && swellTexture) {
        swellSprite.texture = swellTexture;
        const drift = swellDrift(clock.current);
        swellSprite.tilePosition.set(drift.x, drift.y);
      }
      water.patches.forEach((patch, index) => {
        const sprite = patchSprites.current[index];
        const texture = patch.frames[frame];
        if (sprite && texture) sprite.texture = texture;
      });
    }, [clock, water]),
  );
  return (
    <pixiContainer>
      <pixiSprite texture={water.base} y={HORIZON_Y} />
      <pixiTilingSprite
        ref={swell}
        texture={water.swell[0] ?? Texture.EMPTY}
        y={water.swellTop}
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT - water.swellTop}
      />
      {water.patches.map((patch, index) => (
        <pixiSprite
          key={`${patch.x},${patch.y}`}
          ref={(sprite: Sprite | null) => {
            patchSprites.current[index] = sprite;
          }}
          x={patch.x}
          y={patch.y}
        />
      ))}
    </pixiContainer>
  );
}

const tintOf = (state: State) => nightTint(nightProgress(state));

// the static props, depth-sorted with everything that moves; each is tinted by the night on its own, as the sprites
// share a container with the lights that must not be
function Props({ state }: { state: State }) {
  const { textures } = useScene();
  const sprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const tint = tintOf(state);
      for (const sprite of sprites.current) if (sprite) sprite.tint = tint;
    }, [state]),
  );
  return PROPS.map(([key, x, y], index) => (
    <pixiSprite
      key={`${key}@${x},${y}`}
      ref={(sprite: Sprite | null) => {
        sprites.current[index] = sprite;
      }}
      texture={textureFor(textures, key)}
      anchor={anchor(key)}
      x={x}
      y={y}
      zIndex={y}
    />
  ));
}

function Trireme({ state }: { state: State }) {
  const { textures, clock } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      if (!ref.current) return;
      ref.current.y = 440 + Math.sin(clock.current * 1.5) * 4;
      ref.current.tint = tintOf(state);
    }, [clock, state]),
  );
  return (
    <pixiSprite
      ref={ref}
      texture={textureFor(textures, "trireme")}
      anchor={anchor("trireme")}
      x={130}
      y={440}
      zIndex={440}
    />
  );
}

// Puts a character's rim over it: the hard warm pixels along the edge that faces the lamp, a sprite of its own over the
// character's (it must not take the night's tint), mirrored with the character.
function showRim(rim: Sprite | null, sprite: Sprite, texture: Texture, spec: RimSpec | null) {
  if (!rim) return;
  const rimOver = spec
    ? rimTexture(texture, sprite.scale.x < 0 ? mirroredOctant(spec.direction) : spec.direction)
    : null;
  rim.visible = spec !== null && rimOver !== null;
  if (!spec || !rimOver) return;
  rim.texture = rimOver;
  rim.alpha = spec.alpha;
  rim.position.copyFrom(sprite.position);
  rim.scale.x = sprite.scale.x;
  rim.zIndex = sprite.zIndex + 0.001;
}

// multiplies two tints, as one lands on top of the other
function multiplyTints(first: number, second: number) {
  const mixed = (shift: number) => Math.round((((first >> shift) & 255) * ((second >> shift) & 255)) / 255) << shift;
  return mixed(16) | mixed(8) | mixed(0);
}

const Hero = memo(function Hero({ state, sex }: { state: State; sex: Sex }) {
  const { textures, lighting } = useScene();
  const hero = state.hero;
  const ref = useRef<Sprite>(null);
  const rim = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const sprite = ref.current;
      const texture = textures[heroKey(sex, hero.animation, heroFrame(hero.animation, hero.frameTime))];
      if (!sprite || !texture) return;
      const light = lighting.get(hero) ?? DARK_CHARACTER;
      sprite.texture = texture;
      sprite.position.set(Math.round(hero.x), Math.round(hero.y));
      sprite.zIndex = hero.y;
      sprite.scale.x = hero.left ? -1 : 1;
      sprite.tint = hero.hurt > 0 ? multiplyTints(light.tint, 0xff8080) : light.tint;
      showRim(rim.current, sprite, texture, light.rim);
    }, [textures, lighting, hero, sex]),
  );
  return (
    <>
      <pixiSprite ref={ref} texture={textureFor(textures, heroKey(sex, "idle", 0))} anchor={anchor("hero")} />
      <pixiSprite ref={rim} anchor={anchor("hero")} visible={false} />
    </>
  );
});

const LampPost = memo(function LampPost({ state, lamp }: { state: State; lamp: Lamp }) {
  const { textures } = useScene();
  const ref = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const texture = textures[lamp.lit ? "lamp-lit" : "lamp-unlit"];
      if (!ref.current) return;
      if (texture) ref.current.texture = texture;
      ref.current.tint = tintOf(state);
    }, [textures, state, lamp]),
  );
  return (
    <pixiSprite
      ref={ref}
      texture={textureFor(textures, "lamp-lit")}
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
  const { textures, lighting } = useScene();
  const ref = useRef<Sprite>(null);
  const rim = useRef<Sprite>(null);
  useFrame(
    useCallback(() => {
      const sprite = ref.current;
      if (!sprite) return;
      const flying = MONSTER[monster.kind].fly;
      const bob = Math.sin(monster.age * (flying ? 7 : 5)) * (flying ? 6 : 2);
      const light = lighting.get(monster) ?? DARK_CHARACTER;
      sprite.position.set(Math.round(monster.x), Math.round(monster.y - (flying ? 22 : 0) + bob));
      sprite.zIndex = monster.y;
      sprite.scale.x = monster.x > CENTRE_X ? -1 : 1;
      sprite.tint = monster.hurt > 0 ? multiplyTints(light.tint, 0xff7070) : light.tint;
      showRim(rim.current, sprite, textureFor(textures, monster.kind), light.rim);
    }, [monster, textures, lighting]),
  );
  return (
    <>
      <pixiSprite ref={ref} texture={textureFor(textures, monster.kind)} anchor={anchor(monster.kind)} />
      <pixiSprite ref={rim} anchor={anchor(monster.kind)} visible={false} />
    </>
  );
});

// How the lamps light each character, worked out once a frame after the sim has stepped: its warm tint, its shadows and its
// rim (src/scene/lighting.ts). Everything that draws a character reads it from here.
function lightCharacters(state: State, lighting: Lighting, clock: number) {
  lighting.clear();
  lighting.set(state.hero, lightCharacter(state, state.hero.x, state.hero.y, false, clock));
  for (const monster of state.monsters)
    lighting.set(monster, lightCharacter(state, monster.x, monster.y, MONSTER[monster.kind].fly, clock));
}

// The characters' shadows on the ground: under every sprite and over the lamps' pools, so a figure stands in front of its
// own shadow and the light it blocks. One faint for the moon, one for each lamp lighting it; the sprites are pooled.
function Shadows({ state }: { state: State }) {
  const { lighting } = useScene();
  const layer = useRef<Container>(null);
  const sprites = useRef<Sprite[]>([]);
  useFrame(
    useCallback(() => {
      const container = layer.current;
      if (!container) return;
      let used = 0;
      const cast = (character: object, x: number, y: number) => {
        for (const shadow of lighting.get(character)?.shadows ?? []) {
          if (shadow.alpha <= 0) continue;
          let sprite = sprites.current[used];
          if (!sprite) {
            sprite = new Sprite();
            container.addChild(sprite);
            sprites.current.push(sprite);
          }
          used++;
          sprite.visible = true;
          sprite.alpha = shadow.alpha;
          place(sprite, shadowPiece(shadow.angleIndex, shadow.lengthStep), Math.round(x), Math.round(y));
        }
      };
      cast(state.hero, state.hero.x, state.hero.y);
      for (const monster of state.monsters) cast(monster, monster.x, monster.y);
      for (let index = used; index < sprites.current.length; index++) {
        const sprite = sprites.current[index];
        if (sprite) sprite.visible = false;
      }
    }, [state, lighting]),
  );
  return <pixiContainer ref={layer} />;
}

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

// The lights that lie on the ground, added over the night tint: the moon's path, the warden's own light and the lamps'
// pools. They sit under every sprite, shadows included, and fade as dawn comes.
function GroundLights({ state, children }: { state: State; children: ReactNode }) {
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

// the warden's own small light on the ground, in the same stepped bands as the lamps
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

// A lit lamp's light on the ground, precomputed in src/scene/light.ts: the pool and the glints on the stone and the sea.
// A dark lamp shows none of it.
const LampPool = memo(function LampPool({ lamp, radius }: { lamp: Lamp; radius: number }) {
  const { clock } = useScene();
  const light = useMemo(() => lampLight(lamp.x, lamp.y, radius), [lamp.x, lamp.y, radius]);
  const group = useRef<Container>(null),
    pool = useRef<Sprite>(null);
  const glintSprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const groupContainer = group.current,
        poolSprite = pool.current;
      if (!groupContainer || !poolSprite) return;
      groupContainer.visible = lamp.lit;
      if (!lamp.lit) return;
      const poolPiece = light.pools[lampFlicker(light, clock.current)];
      if (poolPiece) place(poolSprite, poolPiece, light.poolX, light.poolY);
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

// What a lit lamp shows at its own height, depth-sorted with the lamp so it lies over what stands behind it and under
// what stands in front: the lamp's foot lit warm by its own pool, the lantern glowing in its own colours inside a halo,
// and the glints on the brass.
const LampGlow = memo(function LampGlow({ state, lamp, radius }: { state: State; lamp: Lamp; radius: number }) {
  const { textures, clock } = useScene();
  const lantern = lanternGlow(textureFor(textures, "lamp-lit"));
  const light = useMemo(() => lampLight(lamp.x, lamp.y, radius), [lamp.x, lamp.y, radius]);
  const foot = lampFoot(textureFor(textures, "lamp-lit"));
  const group = useRef<Container>(null),
    halo = useRef<Sprite>(null),
    footSprite = useRef<Sprite>(null);
  const glintSprites = useRef<(Sprite | null)[]>([]);
  useFrame(
    useCallback(() => {
      const groupContainer = group.current,
        haloSprite = halo.current;
      if (!groupContainer || !haloSprite) return;
      groupContainer.visible = lamp.lit;
      if (!lamp.lit) return;
      groupContainer.alpha = lightsAlpha(nightProgress(state));
      if (footSprite.current) footSprite.current.tint = lampFootTint(state);
      const haloPiece = light.halos[lampFlicker(light, clock.current)];
      if (haloPiece) place(haloSprite, haloPiece, light.haloX, light.haloY);
      light.brassGlints.forEach((glint, index) => {
        const sprite = glintSprites.current[index];
        if (!sprite) return;
        const frame = glintFrame(glint, clock.current);
        sprite.visible = frame !== null;
        if (frame) place(sprite, frame, glint.x, glint.y);
      });
    }, [state, lamp, light, clock]),
  );
  return (
    <pixiContainer ref={group} zIndex={lamp.y + 0.1}>
      <pixiSprite ref={footSprite} texture={foot.texture} x={lamp.x + foot.offsetX} y={lamp.y + foot.offsetY} />
      <pixiSprite ref={halo} blendMode="add" />
      <pixiSprite
        texture={lantern.texture}
        x={lamp.x + lantern.offsetX}
        y={lamp.y + lantern.offsetY}
        blendMode="add"
        alpha={0.45}
      />
      {light.brassGlints.map((glint, index) => (
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
