// Projectile pixel art, drawn by code: an arrow (the bow) in sixteen directions and a sling stone. Pixels are placed
// one by one on a small canvas and outlined like the game's sprites, so the shots stay on the pixel grid instead of
// being rotated and resampled.
import { Texture } from "pixi.js";
import type { Sex } from "./assets";

export type ProjectileKind = "arrow" | "stone";
export const projectileFor = (sex: Sex): ProjectileKind => (sex === "male" ? "arrow" : "stone");

const DIRECTION_COUNT = 16;
const CANVAS_SIZE = 21;
const CENTRE = 10;

const OUTLINE = "#1b1410";
const ARROW_COLOURS = {
  shaft: "#a0703c",
  head: "#e4e8ee",
  headShade: "#8e98a8",
  feather: "#d8433a",
  featherLight: "#fff6d8",
};
const STONE_PIXELS = [".KKK.", "KWSsK", "KSSsK", "KsssK", ".KKK."];
const STONE_COLOURS: Record<string, string> = { K: OUTLINE, W: "#e8e4dc", S: "#a8a29a", s: "#6e6a64" };

type PixelMap = Map<string, string>;
const NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const pixelKey = (column: number, row: number) => `${column},${row}`;

function setPixel(pixels: PixelMap, column: number, row: number, colour: string) {
  pixels.set(pixelKey(Math.round(column), Math.round(row)), colour);
}

// a one-pixel outline on every transparent neighbour (left, right, up, down) of a drawn pixel
function outline(pixels: PixelMap) {
  const drawn = [...pixels.keys()].map((key) => key.split(",").map(Number));
  for (const [column = 0, row = 0] of drawn) {
    for (const [stepColumn, stepRow] of NEIGHBOUR_STEPS) {
      const neighbour = pixelKey(column + stepColumn, row + stepRow);
      if (!pixels.has(neighbour)) pixels.set(neighbour, OUTLINE);
    }
  }
}

function toTexture(pixels: PixelMap): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (context) {
    for (const [key, colour] of pixels) {
      const [column = 0, row = 0] = key.split(",").map(Number);
      context.fillStyle = colour;
      context.fillRect(column, row, 1, 1);
    }
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

// An arrow pointing along `angle` (radians, screen space): the tip at +7 pixels from the centre, the nock at -6.
function arrowPixels(angle: number): PixelMap {
  const pixels: PixelMap = new Map();
  const alongX = Math.cos(angle),
    alongY = Math.sin(angle);
  const acrossX = -alongY,
    acrossY = alongX;
  const pointAt = (along: number, across: number): [number, number] => [
    CENTRE + alongX * along + acrossX * across,
    CENTRE + alongY * along + acrossY * across,
  ];
  for (let along = -6; along <= 4; along += 0.5) setPixel(pixels, ...pointAt(along, 0), ARROW_COLOURS.shaft);
  // a broad leaf-shaped head: two pixels of point, then a barb on each side
  for (const along of [5, 6, 7]) setPixel(pixels, ...pointAt(along, 0), ARROW_COLOURS.head);
  for (const side of [1, -1]) {
    setPixel(pixels, ...pointAt(5, side), ARROW_COLOURS.head);
    setPixel(pixels, ...pointAt(4, side), ARROW_COLOURS.headShade);
  }
  for (const along of [-5, -6]) {
    setPixel(pixels, ...pointAt(along, 1), along === -5 ? ARROW_COLOURS.feather : ARROW_COLOURS.featherLight);
    setPixel(pixels, ...pointAt(along, -1), along === -5 ? ARROW_COLOURS.feather : ARROW_COLOURS.featherLight);
  }
  outline(pixels);
  return pixels;
}

function stonePixels(): PixelMap {
  const pixels: PixelMap = new Map();
  STONE_PIXELS.forEach((line, row) => {
    [...line].forEach((symbol, column) => {
      const colour = STONE_COLOURS[symbol];
      if (colour) setPixel(pixels, CENTRE - 2 + column, CENTRE - 2 + row, colour);
    });
  });
  return pixels;
}

export interface ProjectileTextures {
  arrow: Texture[];
  stone: Texture;
}

export function createProjectileTextures(): ProjectileTextures {
  const arrow = Array.from({ length: DIRECTION_COUNT }, (_, direction) =>
    toTexture(arrowPixels((direction / DIRECTION_COUNT) * Math.PI * 2)),
  );
  return { arrow, stone: toTexture(stonePixels()) };
}

// the pre-drawn arrow whose direction is closest to the flight direction
export function arrowTextureFor(textures: ProjectileTextures, velocityX: number, velocityY: number): Texture {
  const turn = Math.atan2(velocityY, velocityX) / (Math.PI * 2);
  const direction = ((Math.round(turn * DIRECTION_COUNT) % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT;
  return textures.arrow[direction] ?? textures.stone;
}
