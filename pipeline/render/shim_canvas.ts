// The canvas module the kit imports as 'shotcup:canvas' (a name from the kit's first home; only what the kit uses).
// /out/* maps to $KIT_OUT.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUTPUT_DIRECTORY = process.env.KIT_OUT || "./out";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Maps `/out/<file>` to `$KIT_OUT/<file>` and makes sure the directory it lands in exists. */
function resolveOutputPath(path: string): string {
  const resolved = path.startsWith("/out/") ? `${OUTPUT_DIRECTORY}/${path.slice(5)}` : path;
  mkdirSync(resolved.slice(0, resolved.lastIndexOf("/")) || ".", { recursive: true });
  return resolved;
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const bigEndian32 = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const rowBytes = width * 4;
  // each scanline is a zero filter byte followed by its RGBA pixels
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (rowBytes + 1)] = 0;
    raw.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1);
  }
  const chunks: Uint8Array[] = [];
  const addChunk = (type: string, data: Uint8Array) => {
    const typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set([...type].map((character) => character.charCodeAt(0)));
    typeAndData.set(data, 4);
    chunks.push(new Uint8Array([...bigEndian32(data.length), ...typeAndData, ...bigEndian32(crc32(typeAndData))]));
  };
  addChunk("IHDR", new Uint8Array([...bigEndian32(width), ...bigEndian32(height), 8, 6, 0, 0, 0]));
  addChunk("IDAT", new Uint8Array(deflateSync(raw)));
  addChunk("IEND", new Uint8Array(0));
  const total = PNG_SIGNATURE.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  output.set(PNG_SIGNATURE, 0);
  let position = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

interface CanvasOptions {
  /** RGBA bytes to start from, `width * height * 4` of them (transparent black when omitted). */
  pixels?: Uint8Array;
}

class Canvas {
  width: number;
  height: number;
  data: Uint8Array;

  constructor(width: number, height: number, options?: CanvasOptions) {
    this.width = width;
    this.height = height;
    this.data = options?.pixels ? new Uint8Array(options.pixels) : new Uint8Array(width * height * 4);
  }

  toPNG(): Uint8Array {
    return encodePng(this.width, this.height, this.data);
  }

  save(path: string): void {
    writeFileSync(resolveOutputPath(path), this.toPNG());
  }
}

export function createCanvas(width: number, height: number, options?: CanvasOptions): Canvas {
  return new Canvas(width, height, options);
}
