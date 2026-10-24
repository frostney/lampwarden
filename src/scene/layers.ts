// What the scene looks like, in plain Pixi: textures, the ground, props, the night tint and the strokes redrawn every
// frame (the lights are in light.ts). src/components/Scene.tsx puts these on screen with @pixi/react and keeps them in step
// with the sim.
import { Assets, type Graphics, Texture } from "pixi.js";
import {
  CENTRE_X,
  CENTRE_Y,
  MONSTER,
  type MonsterKind,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  type Puff,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type State,
  SWING_HALF_ARC,
} from "../game/sim";
import { anchorYFor, assetList, FRAMES, FRAMES_PER_SECOND, type HeroAnimation } from "./assets";

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
      texture.source.scaleMode = "nearest";
      textures[asset.alias] = texture;
    }
    for (const kind of Object.keys(MONSTER)) {
      const base = textures[kind];
      const white = base && silhouette(base);
      if (white) textures[flashKey(kind)] = white;
    }
    return textures;
  })();
  return textureCache;
}

// the white copy of a monster's sprite that shows for the first frames after a blow
export const flashKey = (kind: MonsterKind | string) => `flash/${kind}`;

// A texture with the same alpha as `texture` and every pixel white. Made at load by drawing the sprite to a canvas, so
// the flash stays hard-edged pixel art (a tint cannot go brighter than the sprite, and a filter would blur).
function silhouette(texture: Texture): Texture | null {
  const resource = texture.source.resource;
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

export function drawGround(graphics: Graphics) {
  graphics.rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill(0x1e5f8a); // sea
  for (let band = 0; band < 12; band++)
    graphics.rect(0, 40 + band * 52, STAGE_WIDTH, 3).fill({ color: 0x2b78a6, alpha: 0.6 });
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
      CENTRE_Y + PLAZA_HALF_HEIGHT + 14,
      CENTRE_X - PLAZA_HALF_WIDTH,
      CENTRE_Y + 14,
    ])
    .fill(0x8a7048);
  graphics
    .poly([
      CENTRE_X + PLAZA_HALF_WIDTH,
      CENTRE_Y,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT,
      CENTRE_X,
      CENTRE_Y + PLAZA_HALF_HEIGHT + 14,
      CENTRE_X + PLAZA_HALF_WIDTH,
      CENTRE_Y + 14,
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

// the white sheet the night tint is multiplied through
export function drawSheet(graphics: Graphics) {
  graphics.clear();
  graphics.rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill(0xffffff);
}

const interpolate = (start: number, end: number, amount: number) => start + (end - start) * amount;
function mixColours(fromColour: number, toColour: number, amount: number) {
  const red = interpolate((fromColour >> 16) & 255, (toColour >> 16) & 255, amount);
  const green = interpolate((fromColour >> 8) & 255, (toColour >> 8) & 255, amount);
  const blue = interpolate(fromColour & 255, toColour & 255, amount);
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}
// night tint (multiplied over the scene): deep blue, warming to dawn over the last fifth of the night
export function nightTint(progress: number) {
  if (progress < 0.8) return 0x46559a;
  const dawning = (progress - 0.8) / 0.2;
  return dawning < 0.6
    ? mixColours(0x46559a, 0xd08a7a, dawning / 0.6)
    : mixColours(0xd08a7a, 0xffffff, (dawning - 0.6) / 0.4);
}
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

// where a sprite's base touches the ground, as a Pixi anchor (one object per key, so React props stay equal)
const anchors = new Map<string, { x: number; y: number }>();
export function anchor(key: string) {
  let spriteAnchor = anchors.get(key);
  if (!spriteAnchor) {
    spriteAnchor = { x: 0.5, y: anchorYFor(key) };
    anchors.set(key, spriteAnchor);
  }
  return spriteAnchor;
}

// how far a monster's sprite bobs off its ground position (the harpy hovers higher and flaps more)
export const monsterBob = (kind: MonsterKind, age: number) =>
  Math.sin(age * (MONSTER[kind].fly ? 7 : 5)) * (MONSTER[kind].fly ? 6 : 2) - (MONSTER[kind].fly ? 22 : 0);

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
  const facing = Math.atan2(hero.directionY, hero.directionX);
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
const PUFF_COLOURS = { snuff: 0x9aa0b0, hurt: 0xff5050, light: 0xffe6a0, kill: 0xf2c14e };

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

// The impact burst of a blow, pixel squares only: a white four-armed flash for the first three frames, then sparks
// that fly along the blow, shrink and cool from white to gold.
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
  const size = progress < 0.4 ? 4 : progress < 0.75 ? 3 : 2;
  const colour =
    SPARK_COLOURS[Math.min(SPARK_COLOURS.length - 1, Math.floor(progress * SPARK_COLOURS.length))] ?? 0xffffff;
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
    if (puff.kind === "hit") {
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
    const done = monster.snuff / (MONSTER[monster.kind].snuff * rules.snuffMultiplier);
    progressRing(graphics, monster.x, monster.y - 74, 8, done, 0xff5a4a);
  }
  for (const monster of state.monsters) {
    if (MONSTER[monster.kind].health <= 1) continue;
    for (let pip = 0; pip < monster.health; pip++)
      graphics.rect(monster.x - 8 + pip * 6, monster.y - 84, 4, 3).fill(0xff5a4a);
  }
}
