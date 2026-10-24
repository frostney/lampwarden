import { describe, expect, test } from "bun:test";
import type { Creature } from "./creature";
import { CREATURE_PIXEL_BYTES, type CreatureCodeSource, drawCreature, sha256Hex } from "./creature-build";

const CODE = "function build(k) { humanoid(k, {}); }";
const PIXELS = new Uint8Array(CREATURE_PIXEL_BYTES).map((_, index) => (index * 7) % 256);

async function recordFor(code: string, pixels: Uint8Array): Promise<Pick<Creature, "id" | "build">> {
  return {
    id: "brine-hound-aaaa",
    build: { codeSha256: await sha256Hex(code), pixelsSha256: await sha256Hex(pixels) },
  };
}

function source(overrides: Partial<CreatureCodeSource> = {}) {
  const drawn: string[] = [];
  const fake: CreatureCodeSource = {
    fetchCode: async () => CODE,
    draw: async (code) => {
      drawn.push(code);
      return new Uint8Array(PIXELS);
    },
    ...overrides,
  };
  return { fake, drawn };
}

describe("sha256Hex", () => {
  test("is SHA-256 in lowercase hex, of a string's UTF-8 bytes or of bytes", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
    expect(await sha256Hex("é")).toBe(await sha256Hex(new Uint8Array([0xc3, 0xa9])));
  });
});

describe("drawing a creature from its code", () => {
  test("returns the pixels when the code and the pixels are the ones the record names", async () => {
    const { fake, drawn } = source();
    const pixels = await drawCreature(await recordFor(CODE, PIXELS), fake);
    expect(pixels).toEqual(PIXELS);
    expect(drawn).toEqual([CODE]);
  });

  test("a creature without a build has nothing to draw (it has a PNG), and nothing is fetched", async () => {
    let fetched = 0;
    const { fake } = source({
      fetchCode: async () => {
        fetched++;
        return CODE;
      },
    });
    expect(await drawCreature({ id: "old-one-aaaa" }, fake)).toBeNull();
    expect(fetched).toBe(0);
  });

  test("code that is not the record's is never run: a stale or swapped blob is no creature", async () => {
    const { fake, drawn } = source({ fetchCode: async () => `${CODE} // swapped` });
    expect(await drawCreature(await recordFor(CODE, PIXELS), fake)).toBeNull();
    expect(drawn).toEqual([]);
  });

  test("a bad copy of the code from the HTTP cache is replaced by one fresh fetch, and a second bad one is no creature", async () => {
    const record = await recordFor(CODE, PIXELS);
    const asked: boolean[] = [];
    const healed = source({
      fetchCode: async (_id, fresh = false) => {
        asked.push(fresh);
        return fresh ? CODE : "function build(k) { /* truncated";
      },
    });
    expect(await drawCreature(record, healed.fake)).toEqual(PIXELS);
    expect(healed.drawn).toEqual([CODE]);
    expect(asked).toEqual([false, true]);

    const asked2: boolean[] = [];
    const broken = source({
      fetchCode: async (_id, fresh = false) => {
        asked2.push(fresh);
        return `${CODE} // swapped`;
      },
    });
    expect(await drawCreature(record, broken.fake)).toBeNull();
    expect(broken.drawn).toEqual([]);
    expect(asked2).toEqual([false, true]);
  });

  test("pixels that are not the record's are not returned: a kit that has moved on is no creature", async () => {
    const other = new Uint8Array(PIXELS);
    other[1234] = (other[1234] ?? 0) ^ 1; // one bit in one pixel
    const { fake } = source({ draw: async () => other });
    expect(await drawCreature(await recordFor(CODE, PIXELS), fake)).toBeNull();
  });

  test("a record whose hashes are of something else matches nothing", async () => {
    const record = await recordFor("function build(k) {}", new Uint8Array(CREATURE_PIXEL_BYTES));
    expect(await drawCreature(record, source().fake)).toBeNull();
  });

  test("a code fetch that fails or finds nothing, a render that fails and pixels of the wrong size are no creature", async () => {
    const record = await recordFor(CODE, PIXELS);
    expect(await drawCreature(record, source({ fetchCode: async () => null }).fake)).toBeNull();
    expect(
      await drawCreature(
        record,
        source({
          fetchCode: async () => {
            throw new Error("network");
          },
        }).fake,
      ),
    ).toBeNull();
    expect(await drawCreature(record, source({ draw: async () => null }).fake)).toBeNull();
    expect(
      await drawCreature(
        record,
        source({
          draw: async () => {
            throw new Error("worker");
          },
        }).fake,
      ),
    ).toBeNull();
    const short = PIXELS.slice(0, 100);
    expect(
      await drawCreature(await recordFor(CODE, short), source({ draw: async () => new Uint8Array(short) }).fake),
    ).toBeNull();
  });
});
