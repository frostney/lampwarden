// Turns what a QuickJS run handed back (a stats JSON string and a pixel buffer, both written by code that may be hostile)
// into the RenderResult every renderer promises, with the sprite encoded as a PNG for the verifier. Server and Node/Bun
// only (node:zlib); the browser keeps the raw pixels.
import { deflateSync } from "node:zlib";
import { MAXIMUM_STATS_CHARACTERS, SPRITE_PIXEL_BYTES, SPRITE_SIZE } from "./quickjs-core";
import { type RenderResult, type RenderStats, renderStatsSchema } from "./render-types";

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, contents: Uint8Array): Buffer {
  const typeAndContents = Buffer.concat([Buffer.from(type, "latin1"), contents]);
  const framed = Buffer.alloc(typeAndContents.length + 8);
  framed.writeUInt32BE(contents.length, 0);
  framed.set(typeAndContents, 4);
  framed.writeUInt32BE(crc32(typeAndContents), typeAndContents.length + 4);
  return framed;
}

/** The 128 px RGBA sprite as PNG bytes, encoded the way `render/shim_canvas.ts` does (no row filter, default deflate). */
export function encodeSpritePng(pixels: Uint8Array): Buffer {
  if (pixels.length !== SPRITE_PIXEL_BYTES) throw new Error(`expected ${SPRITE_PIXEL_BYTES} pixel bytes`);
  const stride = SPRITE_SIZE * 4;
  const rows = Buffer.alloc((stride + 1) * SPRITE_SIZE);
  for (let row = 0; row < SPRITE_SIZE; row++)
    rows.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SPRITE_SIZE, 0);
  header.writeUInt32BE(SPRITE_SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Turns what a runner handed back (a stats JSON string and a pixel buffer, both written by code that may be hostile)
 * into a RenderResult. Checks the sizes first so a build cannot make the host copy or parse something large.
 */
export function finishRender(name: string, milliseconds: number, statsJson: unknown, pixels: unknown): RenderResult {
  if (typeof statsJson !== "string" || statsJson.length > MAXIMUM_STATS_CHARACTERS)
    return { ok: false, error: "render returned no usable stats" };
  if (!(pixels instanceof Uint8Array) || pixels.length !== SPRITE_PIXEL_BYTES)
    return { ok: false, error: "render returned no usable pixels" };
  let stats: RenderStats;
  try {
    stats = renderStatsSchema.parse({ ...JSON.parse(statsJson), name, ms: Math.round(milliseconds) });
  } catch {
    return { ok: false, error: "render returned malformed stats" };
  }
  return { ok: true, stats, png: encodeSpritePng(pixels) };
}
