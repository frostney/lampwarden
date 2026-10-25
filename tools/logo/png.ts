// Minimal PNG (8-bit RGBA) encoder and decoder, and an ICO container that embeds PNG frames.
import { deflateSync, inflateSync } from "node:zlib";

import { PixelImage } from "./image";

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

function crc32(bytes: Uint8Array): number {
  let value = -1;
  for (const byte of bytes) {
    value = (crcTable[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
  }
  return (value ^ -1) >>> 0;
}

function chunk(type: string, contents: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(contents.length);
  const typeAndContents = Buffer.concat([Buffer.from(type), contents]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndContents));
  return Buffer.concat([length, typeAndContents, checksum]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng(image: PixelImage): Buffer {
  const stride = image.width * 4;
  const filtered = Buffer.alloc((stride + 1) * image.height); // filter byte 0 (none) on every row
  for (let y = 0; y < image.height; y++) {
    filtered.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The byte a scanline's filter adds back: none, left, above, their average, or Paeth's pick of the three. */
function predictorFor(filter: number | undefined, left: number, above: number, aboveLeft: number): number {
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return above;
  }
  if (filter === 3) {
    return (left + above) >> 1;
  }
  if (filter === 4) {
    const estimate = left + above - aboveLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceAbove = Math.abs(estimate - above);
    const distanceAboveLeft = Math.abs(estimate - aboveLeft);
    if (distanceLeft <= distanceAbove && distanceLeft <= distanceAboveLeft) {
      return left;
    }
    return distanceAbove <= distanceAboveLeft ? above : aboveLeft;
  }
  return 0;
}

/** A PNG's size from its header and its compressed image data, from its chunks. */
function readChunks(bytes: Buffer): { width: number; height: number; compressed: Buffer[] } {
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  for (let position = 8; position < bytes.length; ) {
    const length = bytes.readUInt32BE(position);
    const type = bytes.toString("ascii", position + 4, position + 8);
    const contents = bytes.subarray(position + 8, position + 8 + length);
    position += 12 + length;
    if (type === "IHDR") {
      width = contents.readUInt32BE(0);
      height = contents.readUInt32BE(4);
      if (contents[8] !== 8 || contents[9] !== 6 || contents[12] !== 0) {
        throw new Error("Only non-interlaced 8-bit RGBA PNGs are supported");
      }
    } else if (type === "IDAT") {
      compressed.push(contents);
    }
  }
  return { width, height, compressed };
}

/** Decodes a non-interlaced 8-bit RGBA PNG, the only kind this generator writes. */
export function decodePng(bytes: Buffer): PixelImage {
  const { width, height, compressed } = readChunks(bytes);
  const filtered = inflateSync(Buffer.concat(compressed));
  const image = new PixelImage(width, height);
  const stride = width * 4;
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    const row = filtered.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let index = 0; index < stride; index++) {
      const left = index >= 4 ? (current[index - 4] ?? 0) : 0;
      const above = previous[index] ?? 0;
      const aboveLeft = index >= 4 ? (previous[index - 4] ?? 0) : 0;
      current[index] = ((row[index] ?? 0) + predictorFor(filter, left, above, aboveLeft)) & 255;
    }
    image.data.set(current, y * stride);
    previous.set(current);
  }
  return image;
}

/** An ICO file whose frames are square PNGs (size < 256). */
export function encodeIco(frames: readonly PixelImage[]): Buffer {
  const encoded = frames.map((frame) => ({ frame, png: encodePng(frame) }));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  encoded.forEach(({ frame, png }, index) => {
    const entry = 6 + 16 * index;
    header[entry] = frame.width;
    header[entry + 1] = frame.height;
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...encoded.map(({ png }) => png)]);
}

export function decodeIco(bytes: Buffer): PixelImage[] {
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + 16 * index;
    const offset = bytes.readUInt32LE(entry + 12);
    return decodePng(bytes.subarray(offset, offset + bytes.readUInt32LE(entry + 8)));
  });
}
