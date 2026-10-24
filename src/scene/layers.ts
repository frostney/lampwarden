// What the scene looks like, in plain Pixi: textures, the ground, props, the night tint and the strokes redrawn every
// frame (the lights are in light.ts). src/components/Scene.tsx puts these on screen with @pixi/react and keeps them in step
// with the sim.
import { Assets, type Graphics, Rectangle, Texture } from "pixi.js";
import { type Archetype, creatureSpritePath } from "../game/creature";
import {
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAME_SIZE,
  type CreatureFrames,
  creatureAtlasLayout,
  creatureAtlasPath,
  creaturePoseName,
} from "../game/creature-frames";
import {
  CENTRE_X,
  CENTRE_Y,
  type HandMadeKind,
  MONSTER,
  type Monster,
  type MonsterKind,
  monsterStats,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  type Puff,
  type State,
  SWING_HALF_ARC,
} from "../game/sim";
import {
  anchorYFor,
  assetList,
  FRAMES,
  FRAMES_PER_SECOND,
  HERO_FRAME_SIZE,
  type HeroAnimation,
  heroAtlasKey,
  heroFrames,
  octantVector,
  SEXES,
  sceneryAssetList,
  sceneryKeyFor,
} from "./assets";
import { creatureFrameKey, creatureFrameOf } from "./creature-animation";
import { bufferTexture } from "./paint";
import { PLAZA_WALL } from "./plaza";
import { cutCharacterFrames, isCharacterKey, withoutPaintedShadow } from "./rim";
import { VIGNETTE_STRENGTHS, vignetteTexture } from "./vignette";
import { SEA_COLOUR } from "./water";

export type TextureMap = Record<string, Texture>;
// a loaded texture by key; an unknown key shows nothing, as Pixi does for a sprite without a texture
export const textureFor = (textures: TextureMap, key: string): Texture => textures[key] ?? Texture.EMPTY;

let textureCache: Promise<TextureMap> | null = null;
export function loadTextures(): Promise<TextureMap> {
  textureCache ??= (async () => {
    const assets = assetList();
    const loaded: Record<string, Texture> = await Assets.load(assets);
    const textures: TextureMap = {};
    for (const asset of assets) {
      const texture = loaded[asset.alias];
      if (!texture) continue;
      textures[asset.alias] = prepared(asset.alias, texture);
    }
    // the scenery loads sprite by sprite: one that will not load is missing, and sceneryTextureKey draws the building's
    // hand-written sprite in its place
    await Promise.all(
      sceneryAssetList().map(async (asset) => {
        try {
          textures[asset.alias] = prepared(asset.alias, await Assets.load<Texture>(asset));
        } catch {
          // left out of the map: the building's hand-written sprite is drawn instead, and a decoration draws nothing
          console.warn(`scenery sprite ${asset.alias} did not load`);
        }
      }),
    );
    // the wardens' frames are cut out of one atlas a sex, each its own texture named as its file would have been
    for (const sex of SEXES) {
      const atlas = textures[heroAtlasKey(sex)];
      if (!atlas) continue;
      const cells = heroFrames(sex).map((frame) => ({ ...frame, label: `/sprites/${frame.key}.png` }));
      const cut = cutCharacterFrames(atlas, HERO_FRAME_SIZE, cells);
      // a browser that will not give up the atlas's pixels still draws the frames, with their painted shadow and no rim
      for (const cell of cells)
        textures[cell.key] =
          cut?.get(cell.key) ??
          new Texture({ source: atlas.source, frame: new Rectangle(cell.x, cell.y, HERO_FRAME_SIZE, HERO_FRAME_SIZE) });
    }
    // the vignette's pictures are painted now, not in the frame of the first blow
    for (let strength = 1; strength <= VIGNETTE_STRENGTHS; strength++) vignetteTexture(strength);
    for (const kind of Object.keys(MONSTER)) {
      const base = textures[kind];
      const white = base && silhouette(base);
      if (white) textures[flashKey(kind)] = white;
    }
    return textures;
  })();
  return textureCache;
}

// The key whose texture draws a prop: its own, or when a building's sprite did not load, its hand-written one
export const sceneryTextureKey = (textures: TextureMap, key: string) =>
  sceneryKeyFor(key, (candidate) => candidate in textures);

// A loaded sprite as the scene draws it: nearest-sampled. Every sprite goes through here, hand-made or from the sea.
function prepared(alias: string, texture: Texture): Texture {
  texture.source.scaleMode = "nearest";
  // the sprites' own painted shadows fall one way whatever the light; the scene casts the shadows now (shadow.ts)
  return isCharacterKey(alias) ? (withoutPaintedShadow(texture) ?? texture) : texture;
}

// the white copy of a monster's sprite that shows for the first frames after a blow (`key` is a sprite key, see monsterLook)
const flashKey = (key: string) => `flash/${key}`;

// --- the creature from the sea ------------------------------------------------------------------------------------
// Its sprite is a PNG on the gallery's server, loaded when the night is about to start. Its keys start with "creature/".

const creatureKey = (id: string) => `creature/${id}`;
const CREATURE_SPRITE_SIZE = 128; // every sprite is a 128 px frame; the anchor is a fraction of it
const creatureLoads = new Map<string, Promise<TextureMap | null>>();

// The frame counts of the creatures whose atlas loaded, so the scene knows which creature animates and how many frames
// each animation has.
const animatedCreatures = new Map<string, CreatureFrames>();

// The creature's sprite and its white flash, by key; null when the sprite does not load or is not a 128 px frame, which
// is how a night learns to go without it. A creature with `frames` (its record says it has an atlas) also gets one
// texture for each frame of its animations, cut from the atlas the way the warden's are; `null` says it has none (no
// atlas is asked for), and a replay, which does not know the record (`undefined`), looks for the atlas with the usual
// counts. If the atlas is missing or is not the size the counts make, the creature keeps its single sprite and stands
// still.
export function loadCreatureTextures(id: string, frames?: CreatureFrames | null): Promise<TextureMap | null> {
  let load = creatureLoads.get(id);
  if (!load) {
    load = (async () => {
      try {
        const key = creatureKey(id);
        const loaded: Texture = await Assets.load({
          alias: key,
          src: creatureSpritePath(id),
          data: { scaleMode: "nearest" },
        });
        if (loaded.source.pixelWidth !== CREATURE_SPRITE_SIZE || loaded.source.pixelHeight !== CREATURE_SPRITE_SIZE)
          return null;
        const texture = prepared(key, loaded);
        const textures: TextureMap = { [key]: texture };
        const white = silhouette(texture);
        if (white) textures[flashKey(key)] = white;
        if (frames !== null) Object.assign(textures, await loadCreatureFrames(id, frames ?? CREATURE_FRAME_COUNTS));
        return textures;
      } catch {
        creatureLoads.delete(id); // a later night may try again
        return null;
      }
    })();
    creatureLoads.set(id, load);
  }
  return load;
}

// One texture for each frame of a creature's animations, cut out of its atlas; empty when it has no usable atlas.
async function loadCreatureFrames(id: string, frames: CreatureFrames): Promise<TextureMap> {
  const layout = creatureAtlasLayout(frames);
  let atlas: Texture;
  try {
    atlas = await Assets.load({
      alias: `creature-atlas/${id}`,
      src: creatureAtlasPath(id),
      data: { scaleMode: "nearest" },
    });
  } catch {
    return {};
  }
  if (atlas.source.pixelWidth !== layout.width || atlas.source.pixelHeight !== layout.height) return {};
  atlas.source.scaleMode = "nearest";
  const cells = layout.cells.map((cell) => ({
    key: creatureFrameKey(id, cell.animation, cell.frame),
    label: `/api/creatures/${id}/${creaturePoseName(cell.animation, cell.frame)}`,
    x: cell.x,
    y: cell.y,
  }));
  const cut = cutCharacterFrames(atlas, CREATURE_FRAME_SIZE, cells);
  const textures: TextureMap = {};
  for (const cell of cells)
    textures[cell.key] =
      cut?.get(cell.key) ??
      new Texture({
        source: atlas.source,
        frame: new Rectangle(cell.x, cell.y, CREATURE_FRAME_SIZE, CREATURE_FRAME_SIZE),
      });
  animatedCreatures.set(id, frames);
  return textures;
}

// What a replay draws when a creature's sprite is gone: the hand-made monster that plays like its archetype.
const STAND_IN: Record<Archetype, HandMadeKind> = { skulker: "satyr", brute: "cyclops", flyer: "harpy" };
export function standInTextures(textures: TextureMap, creatureId: string, archetype: Archetype): TextureMap {
  const key = creatureKey(creatureId);
  const handMade = STAND_IN[archetype];
  const standIn: TextureMap = {};
  const sprite = textures[handMade];
  const flash = textures[flashKey(handMade)];
  if (sprite) standIn[key] = sprite;
  if (flash) standIn[flashKey(key)] = flash;
  return standIn;
}

// Where a monster kind's sprite lives tonight and where its feet touch the ground: the one lookup the scene makes for
// any monster, so a creature is a monster like the others. `key` names its texture; the flash is flashKey(key).
export function monsterLook(state: Pick<State, "creature">, kind: MonsterKind): { key: string; anchorY: number } {
  if (kind === "creature" && state.creature)
    return { key: creatureKey(state.creature.id), anchorY: state.creature.anchorY };
  const handMade = kind === "creature" ? "satyr" : kind;
  return { key: handMade, anchorY: anchorYFor(handMade) };
}

// The texture key a monster is drawn with now: its one sprite, or, for a creature that has frames, the frame its
// animation is at (src/scene/creature-animation.ts).
export function monsterTextureKey(
  state: Pick<State, "creature" | "hero">,
  monster: Monster,
  textures: TextureMap,
): string {
  const look = monsterLook(state, monster.kind);
  const frames = monster.kind === "creature" && state.creature ? animatedCreatures.get(state.creature.id) : undefined;
  if (!state.creature || !frames) return look.key;
  const { animation, frame } = creatureFrameOf(monster, state.hero, frames);
  const key = creatureFrameKey(state.creature.id, animation, frame);
  return textures[key] ? key : look.key;
}

// The key of the frame a creature hangs on when it is struck down: an idle frame, at the pace it idled.
export function ghostTextureKey(state: Pick<State, "creature">, kind: MonsterKind, age: number): string {
  const look = monsterLook(state, kind);
  const frames = kind === "creature" && state.creature ? animatedCreatures.get(state.creature.id) : undefined;
  if (!state.creature || !frames) return look.key;
  const held = { x: 0, y: 0, age, snuff: 0, attackCooldown: 0, stun: 1 };
  return creatureFrameKey(state.creature.id, "idle", creatureFrameOf(held, { x: 0, y: 0 }, frames).frame);
}

// The white silhouette of a monster's drawn sprite: the creature's frames get theirs made when a blow first shows them,
// like the warden's; the other sprites have one ready.
export function monsterFlashTexture(textures: TextureMap, spriteKey: string): Texture {
  return textures[flashKey(spriteKey)] ?? heroFlashTexture(textures, spriteKey) ?? Texture.EMPTY;
}

// the white copy of a warden frame, made the first time a blow shows it and kept (there are many frames, and a blow
// shows few of them)
const heroSilhouettes = new WeakMap<Texture, Texture | null>();
export function heroFlashTexture(textures: TextureMap, key: string): Texture | null {
  const base = textures[key];
  if (!base) return null;
  let white = heroSilhouettes.get(base);
  if (white === undefined) {
    white = silhouette(base);
    if (white) white.source.label = `flash:${base.source.label}`;
    heroSilhouettes.set(base, white);
  }
  return white;
}

// A texture with the same alpha as `texture` and every pixel white. Made by drawing the sprite to a canvas, so the flash
// stays hard-edged pixel art (a tint cannot go brighter than the sprite, and a filter would blur).
function silhouette(texture: Texture): Texture | null {
  const resource = texture.source.resource;
  // the character sprites are pixel buffers once their painted shadow is taken out (rim.ts): premultiplied, so white
  // at alpha a is (a, a, a, a)
  if (resource instanceof Uint8Array) {
    const white = new Uint8Array(resource.length);
    for (let index = 0; index < resource.length; index += 4) white.fill(resource[index + 3] ?? 0, index, index + 4);
    return bufferTexture(white, texture.source.pixelWidth, texture.source.pixelHeight);
  }
  if (!(resource instanceof HTMLImageElement || resource instanceof ImageBitmap)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = resource.width;
  canvas.height = resource.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(resource, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = 255;
    pixels.data[index + 1] = 255;
    pixels.data[index + 2] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const white = Texture.from(canvas);
  white.source.scaleMode = "nearest";
  return white;
}

const PLAZA_TILES = 12;

// the ground over the sea (water.ts): the plaza, its walls, the fountain and the planks to the galley
export function drawGround(graphics: Graphics) {
  // plaza: 12x12 iso diamond tiles of 64x32
  for (let row = 0; row < PLAZA_TILES; row++) {
    for (let column = 0; column < PLAZA_TILES; column++) {
      const tileX = CENTRE_X + (column - row) * 32;
      const tileY = CENTRE_Y - PLAZA_HALF_HEIGHT + (column + row) * 16 + 16;
      const edge = row === 0 || column === 0 || row === PLAZA_TILES - 1 || column === PLAZA_TILES - 1;
      const colour = edge ? 0xb89a6a : (row + column) % 2 === 0 ? 0xe3d3a8 : 0xd6c394;
      graphics
        .poly([tileX, tileY - 16, tileX + 32, tileY, tileX, tileY + 16, tileX - 32, tileY])
        .fill(colour)
        .stroke({ width: 1, color: 0xa88f60, alpha: 0.7 });
    }
  }
  graphics
    .poly([
      CENTRE_X - PLAZA_HALF_WIDTH,
      CENTRE_Y,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT + PLAZA_WALL,
      CENTRE_X - PLAZA_HALF_WIDTH,
      CENTRE_Y + PLAZA_WALL,
    ])
    .fill(0x8a7048);
  graphics
    .poly([
      CENTRE_X + PLAZA_HALF_WIDTH,
      CENTRE_Y,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT + PLAZA_WALL,
      CENTRE_X + PLAZA_HALF_WIDTH,
      CENTRE_Y + PLAZA_WALL,
    ])
    .fill(0x6f5a3a);
  graphics.ellipse(CENTRE_X, CENTRE_Y + 8, 70, 35).stroke({ width: 3, color: 0x3d6f8c });
  graphics.ellipse(CENTRE_X, CENTRE_Y + 8, 46, 23).fill({ color: 0x3d6f8c, alpha: 0.35 });
  for (let plank = 0; plank < 6; plank++) {
    const x = CENTRE_X + 270 + plank * 14;
    const y = CENTRE_Y + 108 - plank * 7;
    graphics.poly([x, y, x + 34, y + 17, x + 34, y + 23, x, y + 6]).fill(plank % 2 ? 0x8a6a3a : 0x9b7843);
  }
}

const interpolate = (start: number, end: number, amount: number) => start + (end - start) * amount;
function mixColours(fromColour: number, toColour: number, amount: number) {
  const red = interpolate((fromColour >> 16) & 255, (toColour >> 16) & 255, amount);
  const green = interpolate((fromColour >> 8) & 255, (toColour >> 8) & 255, amount);
  const blue = interpolate(fromColour & 255, toColour & 255, amount);
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}
// night tint (multiplied over the world below the sky; the sea and ground carry it on a container, each sprite on its own
// so lamp light can bring a character back up): deep blue, warming to dawn over the last fifth of the night
export function nightTint(progress: number) {
  if (progress < 0.8) return 0x46559a;
  const dawning = (progress - 0.8) / 0.2;
  return dawning < 0.6
    ? mixColours(0x46559a, 0xd08a7a, dawning / 0.6)
    : mixColours(0xd08a7a, 0xffffff, (dawning - 0.6) / 0.4);
}
// the open sea under the night tint, which the canvas clears to: the sea covers the stage once the scene draws, so
// clearing to its own colour keeps the canvas from showing a brighter blue while the textures load
export const NIGHT_SEA = multiplyColours(SEA_COLOUR, nightTint(0));
function multiplyColours(colour: number, tint: number) {
  const channel = (shift: number) => Math.round((((colour >> shift) & 255) * ((tint >> shift) & 255)) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
// how far the night has run, 0 to 1
export const nightProgress = (state: State) => Math.min(1, state.elapsed / state.length);
// the lights fade out over the last 15% of the night
export const lightsAlpha = (progress: number) => (progress < 0.85 ? 1 : 1 - (progress - 0.85) / 0.15);

export const PROPS: [string, number, number][] = [
  ["temple", 372, 236],
  ["house", 620, 240],
  ["zeus-statue", CENTRE_X, CENTRE_Y + 14],
  ["galley-dock", CENTRE_X + 345, CENTRE_Y + 112],
  ["olive", 160, 300],
  ["olive", 800, 300],
  ["stall", 610, 330],
  ["wall", 250, 228],
];

// where a sprite's base touches the ground, as a Pixi anchor (one object per height, so React props stay equal)
const anchors = new Map<number, { x: number; y: number }>();
export function anchorAt(anchorY: number) {
  let spriteAnchor = anchors.get(anchorY);
  if (!spriteAnchor) {
    spriteAnchor = { x: 0.5, y: anchorY };
    anchors.set(anchorY, spriteAnchor);
  }
  return spriteAnchor;
}
export const anchor = (key: string) => anchorAt(anchorYFor(key));

// how far a monster's sprite bobs off its ground position (flyers, like the harpy, hover higher and flap more)
export const monsterBob = (state: Pick<State, "creature">, kind: MonsterKind, age: number) => {
  const flies = monsterStats(state, kind).fly;
  return Math.sin(age * (flies ? 7 : 5)) * (flies ? 6 : 2) - (flies ? 22 : 0);
};

export const heroFrame = (animation: HeroAnimation, frameTime: number) =>
  Math.min(
    Math.floor(frameTime * FRAMES_PER_SECOND[animation]) % Math.max(1, FRAMES[animation]),
    FRAMES[animation] - 1,
  );

// a progress ring; moveTo first, or the arc is joined to wherever the previous shape ended
function progressRing(graphics: Graphics, x: number, y: number, radius: number, done: number, color: number) {
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + Math.PI * 2 * Math.min(1, done);
  graphics
    .moveTo(x + Math.cos(startAngle) * radius, y + Math.sin(startAngle) * radius)
    .arc(x, y, radius, startAngle, endAngle)
    .stroke({ width: 3, color });
}

// below the night tint: the melee sweep, the wedge in front of the warden that a blow can land in
export function drawSweep(graphics: Graphics, state: State) {
  const hero = state.hero;
  if (hero.animation !== "melee") return;
  const reach = state.rules.meleeReach;
  const centreX = Math.round(hero.x);
  const centreY = Math.round(hero.y);
  const [facingX, facingY] = octantVector(hero.octant);
  const facing = Math.atan2(facingY, facingX);
  const segments = 12;
  // ground angles, drawn on the 2:1 ground ellipse
  graphics.moveTo(centreX, centreY);
  for (let segment = 0; segment <= segments; segment++) {
    const angle = facing - SWING_HALF_ARC + (2 * SWING_HALF_ARC * segment) / segments;
    graphics.lineTo(centreX + Math.cos(angle) * reach, centreY + (Math.sin(angle) * reach) / 2);
  }
  graphics
    .lineTo(centreX, centreY)
    .fill({ color: 0xffffff, alpha: 0.1 })
    .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
}

const TRAIL: [number, number][] = [
  [0.028, 0.55],
  [0.04, 0.3],
  [0.052, 0.15],
];
const PUFF_COLOURS = { snuff: 0x9aa0b0, light: 0xffe6a0, kill: 0xf2c14e };

// sparks thrown from the point of contact: angle off the blow (radians) and speed (px/s)
const SPARKS: [number, number][] = [
  [-1.1, 190],
  [-0.65, 270],
  [-0.2, 160],
  [0.2, 300],
  [0.65, 215],
  [1.1, 250],
  [2.6, 120],
  [-2.6, 145],
];
const SPARK_COLOURS = [0xffffff, 0xfff2c0, 0xf2c14e];
const IMPACT_TIME = 0.24;

// the sparks of a monster's blow on the warden cool from pink through red to dark red, and are a pixel larger
const WOUND_SPARK_COLOURS = [0xffb0a0, 0xe84040, 0x9a1c28];

// The impact burst of a blow, pixel squares only: a white four-armed flash for the first three frames, then sparks
// that fly along the blow, shrink and cool from white to gold (a blow on the warden: from pink to dark red).
function drawImpact(graphics: Graphics, puff: Puff) {
  if (puff.age > IMPACT_TIME) return;
  const centreX = Math.round(puff.x);
  const centreY = Math.round(puff.y);
  if (puff.age < 0.05) {
    const arm = puff.age < 0.025 ? 8 : 5;
    graphics.rect(centreX - arm, centreY - 1, arm * 2 + 1, 3).fill(0xffffff);
    graphics.rect(centreX - 1, centreY - arm, 3, arm * 2 + 1).fill(0xffffff);
  }
  const progress = puff.age / IMPACT_TIME;
  const wound = puff.kind === "hurt";
  const size = (progress < 0.4 ? 4 : progress < 0.75 ? 3 : 2) + (wound ? 1 : 0);
  const colours = wound ? WOUND_SPARK_COLOURS : SPARK_COLOURS;
  const colour = colours[Math.min(colours.length - 1, Math.floor(progress * colours.length))] ?? 0xffffff;
  const base = Math.atan2(puff.directionY / 2, puff.directionX);
  for (const [offset, speed] of SPARKS) {
    const angle = base + offset;
    const travel = speed * puff.age;
    graphics
      .rect(Math.round(centreX + Math.cos(angle) * travel), Math.round(centreY + Math.sin(angle) * travel), size, size)
      .fill(colour);
  }
}

// above the night tint, so they stay readable: shot trails, puffs, dark-lamp markers, relight and snuff progress,
// health pips
export function drawMarks(graphics: Graphics, state: State, clock: number) {
  const rules = state.rules;
  for (const shot of state.shots) {
    // a short motion trail behind each projectile sprite (see the Projectiles layer in Scene.tsx)
    for (const [behind, alpha] of TRAIL)
      graphics
        .rect(Math.round(shot.x - shot.velocityX * behind), Math.round(shot.y - shot.velocityY * behind), 1, 1)
        .fill({ color: 0xfff2c0, alpha });
  }
  for (const puff of state.puffs) {
    if (puff.kind === "hit" || puff.kind === "hurt") {
      drawImpact(graphics, puff);
      continue;
    }
    const radius = 6 + puff.age * 60;
    graphics
      .circle(Math.round(puff.x), Math.round(puff.y), radius)
      .stroke({ width: 3, color: PUFF_COLOURS[puff.kind], alpha: 1 - puff.age / 0.5 });
  }
  for (const lamp of state.lamps) {
    if (lamp.lit) continue;
    // dark lamp: pulsing marker and relight progress
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    graphics.ellipse(lamp.x, lamp.y, 26, 13).stroke({ width: 2, color: 0xffd27a, alpha: 0.35 + 0.4 * pulse });
    if (lamp.relight > 0) progressRing(graphics, lamp.x, lamp.y - 70, 9, lamp.relight / rules.relight, 0xffe6a0);
  }
  for (const monster of state.monsters) {
    // clawing a lamp: red progress over it
    if (monster.snuff <= 0) continue;
    const done = monster.snuff / (monsterStats(state, monster.kind).snuff * rules.snuffMultiplier);
    progressRing(graphics, monster.x, monster.y - 74, 8, done, 0xff5a4a);
  }
  for (const monster of state.monsters) {
    if (monsterStats(state, monster.kind).health <= 1) continue;
    for (let pip = 0; pip < monster.health; pip++)
      graphics.rect(monster.x - 8 + pip * 6, monster.y - 84, 4, 3).fill(0xff5a4a);
  }
}
