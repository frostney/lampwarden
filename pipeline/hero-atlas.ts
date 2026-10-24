// The hero atlas: every frame of a warden, from the five drawn directions, as 128 px cells in one picture
// (public/sprites/hero/<sex>.png; the layout is src/scene/assets.ts's heroAtlasCell). Packing is pure code, so the same
// frames always make the same file.
import { HERO_ATLAS_SIZE, HERO_FRAME_SIZE, heroFrames, type Sex } from "../src/scene/assets";
import { PixelImage } from "../tools/logo/image";
import { encodePng } from "../tools/logo/png";

const rowBytes = HERO_FRAME_SIZE * 4;

// the RGBA pixels of one cell of an atlas
export function atlasCellPixels(atlas: PixelImage, x: number, y: number): Uint8Array {
  const pixels = new Uint8Array(HERO_FRAME_SIZE * rowBytes);
  for (let row = 0; row < HERO_FRAME_SIZE; row++) {
    const start = ((y + row) * atlas.width + x) * 4;
    pixels.set(atlas.data.subarray(start, start + rowBytes), row * rowBytes);
  }
  return pixels;
}

// packs a sex's frames, each the RGBA pixels of one 128 px render keyed as the scene keys it (`hero/male_idle1_s`)
export function packHeroAtlas(sex: Sex, rendered: ReadonlyMap<string, Uint8Array>): Buffer {
  const atlas = new PixelImage(HERO_ATLAS_SIZE.width, HERO_ATLAS_SIZE.height);
  for (const { key, x, y } of heroFrames(sex)) {
    const pixels = rendered.get(key);
    if (!pixels || pixels.length !== HERO_FRAME_SIZE * rowBytes)
      throw new Error(`${key}: no ${HERO_FRAME_SIZE} px render`);
    for (let row = 0; row < HERO_FRAME_SIZE; row++)
      atlas.data.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), ((y + row) * atlas.width + x) * 4);
  }
  return encodePng(atlas);
}
