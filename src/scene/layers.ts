// What the scene looks like, in plain Pixi: textures, the ground, props, the night tint and the strokes redrawn every
// frame (the lights are in light.ts). src/components/Scene.tsx puts these on screen with @pixi/react and keeps them in step
// with the sim.
import { Assets, type Graphics, Rectangle, Texture } from "pixi.js";
import { buildingSpritePath, type RecordedBuilding } from "../game/building";
import { type Archetype, creatureSpritePath } from "../game/creature";
import {
  CREATURE_ALL_DIRECTIONS,
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAME_SIZE,
  type CreatureFrames,
  creatureAtlasLayout,
  creatureAtlasPath,
  creaturePoseName,
  STILL_DIRECTION,
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
  heroView,
  octantVector,
  SEXES,
  sceneryAssetList,
  sceneryKeyFor,
} from "./assets";
import { creatureFrameOf, sheetFrameKey } from "./creature-animation";
import type { LiveBuilding } from "./decor";
import type { Point } from "./extent";
import { monsterOctant } from "./monster-heading";
import { isSheetKind, monsterAtlasKey, monsterAtlasPath, SHEET_FRAMES, SHEET_KINDS } from "./monster-sheets";
import { bufferTexture } from "./paint";
import { PLAZA_WALL } from "./plaza";
import { cutCharacterFrames, isCharacterKey, splitPaintedShadow, withoutPaintedShadow } from "./rim";
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
    // the hand-made monsters' frames, from every direction, each its own texture cut out of one atlas a monster; one that
    // will not load leaves the monster its single sprite
    await Promise.all(
      SHEET_KINDS.map(async (kind) =>
        Object.assign(
          textures,
          await loadSheet(kind, monsterAtlasKey(kind), monsterAtlasPath(kind), [SHEET_FRAMES[kind]]),
        ),
      ),
    );
    // a lamp's painted shadow lies on the ground, so it is a texture of its own, drawn under every sprite (Scene.tsx)
    for (const key of LAMP_KEYS) {
      const lamp = textures[key];
      const split = lamp && splitPaintedShadow(lamp);
      if (!split) continue;
      textures[key] = split.body;
      textures[paintedShadowKey(key)] = split.shadow;
    }
    // the vignette's pictures are painted now, not in the frame of the first blow
    for (let strength = 1; strength <= VIGNETTE_STRENGTHS; strength++) vignetteTexture(strength);
    for (const kind of Object.keys(MONSTER)) {
      const base = textures[kind];
      const white = base && silhouette(base);
      if (white) textures[flashKey(kind)] = white;
    }
    return textures;
  })().catch((error: unknown) => {
    textureCache = null; // a failed load is not kept, so the next call tries again
    throw error;
  });
  return textureCache;
}

// the lamps, whose sprites carry a shadow painted on the ground beside them; `shadow/<key>` is that shadow alone
const LAMP_KEYS = ["lamp-lit", "lamp-unlit"];
export const paintedShadowKey = (key: string) => `shadow/${key}`;

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

// The frames of the sheets whose atlas loaded (a creature's key, or a hand-made monster's kind), so the scene knows which
// monster animates, how many frames each animation has and from which directions it is drawn.
const animatedSheets = new Map<string, CreatureFrames>();
// How far each frame that was slid along its cell is, by its texture key: across, down (src/game/creature-frames.ts).
const slidFrames = new Map<string, readonly [number, number]>();

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
        if (frames !== null)
          Object.assign(
            textures,
            await loadSheet(key, `creature-atlas/${id}`, creatureAtlasPath(id), frames ? [frames] : REPLAY_LAYOUTS),
          );
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

// What a replay, which does not know the creature's record, looks for: an atlas of every direction, or one of a single row.
const REPLAY_LAYOUTS: readonly CreatureFrames[] = [CREATURE_ALL_DIRECTIONS, CREATURE_FRAME_COUNTS];

// One texture for each frame of a sheet's animations, cut out of its atlas, named by `sheetFrameKey`; empty when it has no
// usable atlas. `layouts` are the frames the atlas may have (the record's, or the ones a replay tries): the atlas must be
// the size of one of them.
async function loadSheet(
  sheet: string,
  alias: string,
  src: string,
  layouts: readonly CreatureFrames[],
): Promise<TextureMap> {
  let atlas: Texture;
  try {
    atlas = await Assets.load({ alias, src, data: { scaleMode: "nearest" } });
  } catch {
    return {};
  }
  const frames = layouts.find((candidate) => {
    const size = creatureAtlasLayout(candidate);
    return atlas.source.pixelWidth === size.width && atlas.source.pixelHeight === size.height;
  });
  if (!frames) return {};
  atlas.source.scaleMode = "nearest";
  const layout = creatureAtlasLayout(frames);
  const cells = layout.cells.map((cell) => ({
    key: sheetFrameKey(sheet, cell.direction, cell.animation, cell.frame),
    label: `${src}#${cell.direction}/${creaturePoseName(cell.animation, cell.frame)}`,
    x: cell.x,
    y: cell.y,
  }));
  const cut = cutCharacterFrames(atlas, CREATURE_FRAME_SIZE, cells);
  const textures: TextureMap = {};
  for (const [index, cell] of cells.entries()) {
    const shift = layout.cells[index]?.shift;
    if (shift && (shift[0] !== 0 || shift[1] !== 0)) slidFrames.set(cell.key, shift);
  }
  for (const cell of cells)
    textures[cell.key] =
      cut?.get(cell.key) ??
      new Texture({
        source: atlas.source,
        frame: new Rectangle(cell.x, cell.y, CREATURE_FRAME_SIZE, CREATURE_FRAME_SIZE),
      });
  animatedSheets.set(sheet, frames);
  return textures;
}

// --- the building raised on the plaza ---------------------------------------------------------------------------------
// A live building's sprite is a PNG on the gallery's server, loaded when the night is about to start, like the creature's.
// Its key starts with "building/", and where its base touches the ground is the anchor its record gave (the committed
// sprites' are in assets.ts), kept here once its sprite has loaded.

const buildingKey = (id: string) => `building/${id}`;
const buildingLoads = new Map<string, Promise<TextureMap | null>>();
const buildingAnchors = new Map<string, number>();

// The building's sprite by key; null when it does not load or is not a 128 px frame, which is how a night learns to go
// with the plaza it always had.
export function loadBuildingTexture(building: Pick<RecordedBuilding, "id" | "anchorY">): Promise<TextureMap | null> {
  let load = buildingLoads.get(building.id);
  if (!load) {
    load = (async () => {
      try {
        const key = buildingKey(building.id);
        const loaded: Texture = await Assets.load({
          alias: key,
          src: buildingSpritePath(building.id),
          data: { scaleMode: "nearest" },
        });
        if (loaded.source.pixelWidth !== CREATURE_SPRITE_SIZE || loaded.source.pixelHeight !== CREATURE_SPRITE_SIZE)
          return null;
        buildingAnchors.set(key, building.anchorY);
        return { [key]: prepared(key, loaded) };
      } catch {
        buildingLoads.delete(building.id); // a later night may try again
        return null;
      }
    })();
    buildingLoads.set(building.id, load);
  }
  return load;
}

// The building as the placer takes it: the sprite's key, and where its pixels are.
export const liveBuildingOf = (building: Pick<RecordedBuilding, "id" | "extent">): LiveBuilding => ({
  key: buildingKey(building.id),
  extents: building.extent,
});

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

// The frames a monster has tonight: its sheet's key and what is in it, when its atlas loaded (a creature's, or a hand-made
// monster's), else nothing and the monster keeps its one sprite.
function sheetOf(state: Pick<State, "creature">, kind: MonsterKind): { key: string; frames: CreatureFrames } | null {
  const key =
    kind === "creature" ? (state.creature ? creatureKey(state.creature.id) : null) : isSheetKind(kind) ? kind : null;
  const frames = key === null ? undefined : animatedSheets.get(key);
  return key !== null && frames ? { key, frames } : null;
}

// What a monster is drawn with: a texture's key, whether it is drawn mirrored left to right, and how far from the monster's
// own place the sprite is put, in screen pixels: a frame that was slid along its cell to keep its figure inside it is
// drawn that far back, so the figure stands where the monster does and only a long weapon reaches past the cell.
export interface MonsterPicture {
  key: string;
  mirrored: boolean;
  offsetX: number;
  offsetY: number;
}

function picture(key: string, mirrored: boolean): MonsterPicture {
  const slid = slidFrames.get(key);
  if (!slid) return { key, mirrored, offsetX: 0, offsetY: 0 };
  // a mirrored sprite is flipped about its anchor, so the slide across turns round with it
  return { key, mirrored, offsetX: mirrored ? slid[0] : -slid[0], offsetY: -slid[1] };
}

// The picture a monster is drawn with now: its one sprite, flipped on the right of the plaza so it faces the centre, or,
// for a monster that has frames, the frame its animation is at (src/scene/creature-animation.ts) seen from the way it
// faces (src/scene/monster-heading.ts), the three directions that are not drawn being mirrored as the warden's are. A sheet
// of a single direction (a creature made before directions) is its one south-east side, flipped like the single sprite.
export function monsterPicture(
  state: Pick<State, "creature" | "hero">,
  monster: Monster,
  textures: TextureMap,
): MonsterPicture {
  const look = monsterLook(state, monster.kind);
  const facingCentre = monster.x > CENTRE_X;
  const sheet = sheetOf(state, monster.kind);
  if (!sheet) return picture(look.key, facingCentre);
  const { animation, frame } = creatureFrameOf(monster, state.hero, sheet.frames);
  const view = sheet.frames.directions
    ? heroView(monsterOctant(monster, state.hero))
    : { drawn: STILL_DIRECTION, mirrored: facingCentre };
  const key = sheetFrameKey(sheet.key, view.drawn, animation, frame);
  return textures[key] ? picture(key, view.mirrored) : picture(look.key, facingCentre);
}

// The picture a monster hangs on when it is struck down: an idle frame, at the pace it idled, facing the blow that killed
// it (a monster with one side and the single sprite are flipped by where it fell, as they are alive).
export function ghostPicture(
  state: Pick<State, "creature">,
  ghost: { monster: MonsterKind; x: number; monsterAge: number },
  facingOctant: number,
  textures: TextureMap,
): MonsterPicture {
  const look = monsterLook(state, ghost.monster);
  const facingCentre = ghost.x > CENTRE_X;
  const sheet = sheetOf(state, ghost.monster);
  if (!sheet) return picture(look.key, facingCentre);
  const held = { x: 0, y: 0, age: ghost.monsterAge, snuff: 0, attackCooldown: 0, stun: 1 };
  const { frame } = creatureFrameOf(held, { x: 0, y: 0 }, sheet.frames);
  const view = sheet.frames.directions ? heroView(facingOctant) : { drawn: STILL_DIRECTION, mirrored: facingCentre };
  const key = sheetFrameKey(sheet.key, view.drawn, "idle", frame);
  return textures[key] ? picture(key, view.mirrored) : picture(look.key, facingCentre);
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

// the ground over the sea (water.ts): the plaza, its walls and the fountain
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
}

// the boards of a night's bridge (decor.ts: the galley's dock brings one, from its pier to the plaza's rim), over the ground
// and under the sprites: each lies across the way to the stone, 24 px wide and 9 deep, and they alternate in tone
const BOARD_ACROSS: Point = [24, -12];
const BOARD_DEEP: Point = [-9, -4.5];
export function drawPlanks(graphics: Graphics, planks: readonly Point[]) {
  planks.forEach(([centreX, centreY], index) => {
    const x = centreX - (BOARD_ACROSS[0] + BOARD_DEEP[0]) / 2;
    const y = centreY - (BOARD_ACROSS[1] + BOARD_DEEP[1]) / 2;
    graphics
      .poly([
        x,
        y,
        x + BOARD_ACROSS[0],
        y + BOARD_ACROSS[1],
        x + BOARD_ACROSS[0] + BOARD_DEEP[0],
        y + BOARD_ACROSS[1] + BOARD_DEEP[1],
        x + BOARD_DEEP[0],
        y + BOARD_DEEP[1],
      ])
      .fill(index % 2 ? 0x8a6a3a : 0x9b7843);
  });
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

// The props small enough for one warm tint to light, by the lamps and by the warden's light on the ground at their base
// (lighting.ts lightProp), named by the key a prop is placed under, not the sprite drawn for it: the statue, the stall,
// the olive trees and the decorations (the young olive, the broken column, the votive altar, the amphora stack). The
// temple, the house (and its ochre one) and the wall are buildings, and the galley at its dock and the trireme are boats:
// a single tint across a sprite that large would light its whole face at once, so they keep the night's tint.
const LIT_PROPS: ReadonlySet<string> = new Set([
  "zeus-statue",
  "stall",
  "olive",
  "olive-young",
  "broken-column",
  "votive-altar",
  "amphora-stack",
]);
export const isLitProp = (key: string) => LIT_PROPS.has(key);

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
export const anchor = (key: string) => anchorAt(buildingAnchors.get(key) ?? anchorYFor(key));

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

// on the ground, under every sprite and the night tint: the melee sweep, the wedge in front of the warden that a blow can
// land in
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

// On the ground, under every sprite and above the night tint so it stays readable: the ring round each dark lamp, pulsing
// to say it can be relit. The lamp stands in front of it, as it does in front of the stone it is set in.
export function drawGroundMarks(graphics: Graphics, state: State, clock: number) {
  const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
  for (const lamp of state.lamps) {
    if (lamp.lit) continue;
    graphics.ellipse(lamp.x, lamp.y, 26, 13).stroke({ width: 2, color: 0xffd27a, alpha: 0.35 + 0.4 * pulse });
  }
}

// Over everything, above the night tint so they stay readable: what hangs in the air or reads as a gauge. Shot trails,
// the puffs of a blow, a lamp's relight progress and a monster's snuff progress over their heads, and health pips.
export function drawMarks(graphics: Graphics, state: State) {
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
  for (const lamp of state.lamps)
    if (!lamp.lit && lamp.relight > 0)
      progressRing(graphics, lamp.x, lamp.y - 70, 9, lamp.relight / rules.relight, 0xffe6a0);
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
