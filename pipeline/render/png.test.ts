// The encoder's bytes are the contract (a sandbox render must equal the committed PNG byte for byte), so the test pins
// them: the committed lamp-lit sprite, decoded and encoded again, comes back identical.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodePng } from "../../tools/logo/png";
import { encodePng } from "./png";

const committedLamp = readFileSync(join(import.meta.dir, "..", "..", "public", "sprites", "lamp-lit.png"));

describe("the PNG encoder", () => {
  test("writes the PNG signature and an IHDR chunk with the image's size", () => {
    const encoded = encodePng(3, 2, new Uint8Array(3 * 2 * 4));
    expect([...encoded.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(encoded.buffer, encoded.byteOffset);
    expect(String.fromCharCode(...encoded.subarray(12, 16))).toBe("IHDR");
    expect(header.getUint32(16)).toBe(3);
    expect(header.getUint32(20)).toBe(2);
  });

  test("reproduces the committed sprite byte for byte", () => {
    const lamp = decodePng(committedLamp);
    const encoded = encodePng(lamp.width, lamp.height, new Uint8Array(lamp.data));
    expect(Buffer.from(encoded).equals(committedLamp)).toBe(true);
  });
});
