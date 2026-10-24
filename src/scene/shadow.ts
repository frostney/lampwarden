// The shadows characters cast on the ground, as pixel art: a tapering lozenge lying along the ground away from a light,
// hard pixels with a dithered edge, in a dark night blue. One texture per direction and length, painted on first use and
// cached; a character's shadow is a sprite that picks one and is made fainter or darker with its alpha.

import type { LightPiece } from "./light";
import { SHADOW_ANGLES, SHADOW_LENGTHS } from "./lighting";
import { bayerThreshold, bufferTexture, type Rgb } from "./paint";

const SHADOW_COLOUR: Rgb = [8, 10, 30];
const FOOT_RADIUS = 13; // ground pixels: about the width of a pair of feet; on the screen that is 13 by 6.5
const TAPER = 0.5; // how much narrower the far end is than the feet
const EDGE = 0.4; // the share of the radius the dither takes at the edge

export interface ShadowPixels {
  pixels: Uint8Array;
  width: number;
  height: number;
  originX: number; // the pixel the character's feet stand on
  originY: number;
}

// The shadow of a character at the origin, `length` ground pixels long towards `angle` (radians on the ground, whose y is
// drawn at half height): every pixel within a radius of the line, the radius shrinking along it, dithered at the rim.
export function paintShadow(angle: number, length: number): ShadowPixels {
  const reachX = Math.ceil(length * Math.abs(Math.cos(angle)) + FOOT_RADIUS) + 1;
  const reachY = Math.ceil((length * Math.abs(Math.sin(angle)) + FOOT_RADIUS) / 2) + 1;
  const width = reachX * 2 + 1;
  const height = reachY * 2 + 1;
  const pixels = new Uint8Array(width * height * 4);
  const endX = Math.cos(angle) * length;
  const endY = Math.sin(angle) * length;
  const lengthSquared = endX * endX + endY * endY;
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const groundX = column - reachX;
      const groundY = (row - reachY) * 2;
      const along =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (groundX * endX + groundY * endY) / lengthSquared));
      const radius = FOOT_RADIUS * (1 - TAPER * along);
      const distance = Math.hypot(groundX - endX * along, groundY - endY * along);
      const cover = Math.min(1, (radius - distance) / (radius * EDGE));
      if (cover <= 0 || (cover < 1 && cover <= bayerThreshold(column, row))) continue;
      const index = (row * width + column) * 4;
      pixels[index] = SHADOW_COLOUR[0];
      pixels[index + 1] = SHADOW_COLOUR[1];
      pixels[index + 2] = SHADOW_COLOUR[2];
      pixels[index + 3] = 255;
    }
  return { pixels, width, height, originX: reachX, originY: reachY };
}

const pieces = new Map<number, LightPiece>();
// the shadow texture for a direction (an index of SHADOW_ANGLES) and a length (an index of SHADOW_LENGTHS), placed by the
// offset of its top-left pixel from the character's feet
export function shadowPiece(angleIndex: number, lengthStep: number): LightPiece {
  const key = angleIndex * SHADOW_LENGTHS.length + lengthStep;
  let piece = pieces.get(key);
  if (!piece) {
    const painted = paintShadow((angleIndex * 2 * Math.PI) / SHADOW_ANGLES, SHADOW_LENGTHS[lengthStep] ?? 0);
    piece = {
      texture: bufferTexture(painted.pixels, painted.width, painted.height),
      offsetX: -painted.originX,
      offsetY: -painted.originY,
    };
    pieces.set(key, piece);
  }
  return piece;
}
