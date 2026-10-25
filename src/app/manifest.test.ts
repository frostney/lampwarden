import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import manifest from "./manifest";

const publicDirectory = join(import.meta.dir, "../../public");

// a PNG's width and height are the two big-endian 32-bit integers after its 8-byte signature and the IHDR chunk header
const sizeOf = (path: string) => {
  const bytes = readFileSync(path);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};

test("the manifest has 192 and 512 px icons, each as any and as maskable, and they are the generated files", () => {
  const icons = manifest().icons ?? [];
  const wanted = ["192x192", "512x512"].flatMap((sizes) => ["any", "maskable"].map((purpose) => `${sizes} ${purpose}`));
  expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(wanted.sort());
  // each declared size is the file's real size (tools/logo/build.ts --check keeps the files themselves current)
  for (const icon of icons) {
    expect(sizeOf(join(publicDirectory, icon.src))).toBe(`${icon.sizes}`);
  }
});
