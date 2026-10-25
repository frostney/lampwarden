import { describe, expect, test } from "bun:test";
import { type PlayUploadDeps, savePlay } from "./service";
import { createMemoryPlayStore } from "./store.memory";

const SALT = "a-long-enough-test-salt-0123456789";
const NOW = new Date("2026-10-24T18:00:00.000Z");
const playWithId = (count: number) => ({ id: `2026-10-24-16-11-4${count}-aaaaaaa${count}`, seed: count });

function setup(overrides: Partial<PlayUploadDeps> = {}) {
  const store = createMemoryPlayStore();
  const deps: PlayUploadDeps = {
    store,
    now: () => NOW,
    rateSalt: SALT,
    limits: { perVisitorPerHour: 3, perDay: 5 },
    build: "abc1234",
    ...overrides,
  };
  return { store, deps };
}

describe("an uploaded play", () => {
  test("is stored with the build and the time it arrived", async () => {
    const { store, deps } = setup();
    expect(await savePlay(deps, { play: playWithId(0), ip: "203.0.113.7" })).toEqual({ kind: "stored" });
    expect(JSON.parse(store.plays.get(playWithId(0).id) ?? "null")).toEqual({
      ...playWithId(0),
      build: "abc1234",
      receivedAt: NOW.toISOString(),
    });
  });

  describe("under an id already stored", () => {
    const address = "203.0.113.7";
    const night = (steps: number, outcome: string | null, seed = 1) => ({ id: playWithId(0).id, seed, steps, outcome });
    const storedSteps = (store: { plays: Map<string, string> }) =>
      JSON.parse(store.plays.get(playWithId(0).id) ?? "null")?.steps;

    test("a snapshot, then the finished night, keeps the finished night", async () => {
      const { store, deps } = setup();
      expect(await savePlay(deps, { play: night(300, null), ip: address })).toEqual({ kind: "stored" });
      expect(await savePlay(deps, { play: night(900, "dawn"), ip: address })).toEqual({ kind: "replaced" });
      expect(storedSteps(store)).toBe(900);
      expect(JSON.parse(store.plays.get(playWithId(0).id) ?? "null").outcome).toBe("dawn");
    });

    test("the finished night, then a stale snapshot, keeps the finished night", async () => {
      const { store, deps } = setup();
      await savePlay(deps, { play: night(900, "dawn"), ip: address });
      const before = store.plays.get(playWithId(0).id);
      expect(await savePlay(deps, { play: night(300, null), ip: address })).toEqual({ kind: "exists" });
      // even a snapshot that got further than the finished night is not the finished night
      expect(await savePlay(deps, { play: night(1200, null), ip: address })).toEqual({ kind: "exists" });
      expect(store.plays.get(playWithId(0).id)).toBe(before);
    });

    test("an identical resend is a no-op", async () => {
      const { store, deps } = setup();
      await savePlay(deps, { play: night(900, "dawn"), ip: address });
      const before = store.plays.get(playWithId(0).id);
      expect(await savePlay(deps, { play: night(900, "dawn"), ip: address })).toEqual({ kind: "exists" });
      expect(store.plays.get(playWithId(0).id)).toBe(before);
    });

    test("a longer snapshot replaces a shorter one, and a shorter one does not replace a longer", async () => {
      const { store, deps } = setup();
      await savePlay(deps, { play: night(300, null), ip: address });
      expect(await savePlay(deps, { play: night(600, null), ip: address })).toEqual({ kind: "replaced" });
      expect(await savePlay(deps, { play: night(300, null), ip: address })).toEqual({ kind: "exists" });
      expect(storedSteps(store)).toBe(600);
    });

    test("the night that ended at the step of its snapshot replaces the snapshot", async () => {
      const { store, deps } = setup();
      await savePlay(deps, { play: night(300, null), ip: address });
      expect(await savePlay(deps, { play: night(300, "fallen"), ip: address })).toEqual({ kind: "replaced" });
      expect(JSON.parse(store.plays.get(playWithId(0).id) ?? "null").outcome).toBe("fallen");
    });

    test("a stored play that cannot be read gives way", async () => {
      const { store, deps } = setup();
      store.plays.set(playWithId(0).id, "not json");
      expect(await savePlay(deps, { play: night(10, null), ip: address })).toEqual({ kind: "replaced" });
    });

    test("loses a race with another write by reading again", async () => {
      const { store, deps } = setup();
      await savePlay(deps, { play: night(300, null), ip: address });
      const replace = store.replace;
      let raced = false;
      store.replace = async (playId, json, version) => {
        if (!raced) {
          raced = true;
          await savePlay(deps, { play: night(1000, "dawn"), ip: address }); // the finished night lands first
        }
        return replace(playId, json, version);
      };
      expect(await savePlay(deps, { play: night(600, null), ip: address })).toEqual({ kind: "exists" });
      expect(storedSteps(store)).toBe(1000);
    });

    test("past the limit, the finished night of a stored snapshot still lands, and nothing else does", async () => {
      const { store, deps } = setup(); // three an hour
      await savePlay(deps, { play: night(300, null), ip: address });
      for (let count = 1; count < 3; count++) await savePlay(deps, { play: playWithId(count), ip: address });
      expect((await savePlay(deps, { play: playWithId(3), ip: address })).kind).toBe("limited");
      expect((await savePlay(deps, { play: night(600, null), ip: address })).kind).toBe("limited");
      expect(await savePlay(deps, { play: night(900, "dawn"), ip: address })).toEqual({ kind: "replaced" });
      expect(storedSteps(store)).toBe(900);
      expect((await savePlay(deps, { play: night(1000, "dawn"), ip: address })).kind).toBe("limited");
    });

    test("only the first write counts against the visitor", async () => {
      const { deps } = setup(); // three an hour
      for (let count = 0; count < 10; count++) {
        await savePlay(deps, { play: night(300 + count, null), ip: address });
        await savePlay(deps, { play: night(900, "dawn"), ip: address });
      }
      expect(await savePlay(deps, { play: playWithId(1), ip: address })).toEqual({ kind: "stored" });
    });
  });
});

describe("the upload limits", () => {
  test("stop a visitor past the hourly allowance, with when to come back, and nobody else", async () => {
    const { store, deps } = setup();
    for (let count = 0; count < 3; count++)
      expect(await savePlay(deps, { play: playWithId(count), ip: "203.0.113.7" })).toEqual({ kind: "stored" });
    const refused = await savePlay(deps, { play: playWithId(3), ip: "203.0.113.7" });
    expect(refused).toEqual({ kind: "limited", retryAfterSeconds: 3600 });
    expect(store.plays.has(playWithId(3).id)).toBe(false);
    expect(await savePlay(deps, { play: playWithId(3), ip: "198.51.100.2" })).toEqual({ kind: "stored" });
  });

  test("see one visitor in every address of an IPv6 /64", async () => {
    const { deps } = setup();
    for (let count = 0; count < 3; count++)
      await savePlay(deps, { play: playWithId(count), ip: `2001:db8:1:2:${count}::${count + 1}` });
    const refused = await savePlay(deps, { play: playWithId(3), ip: "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
    expect(refused.kind).toBe("limited");
  });

  test("stop the whole site at the day's cap", async () => {
    const { deps } = setup();
    for (let count = 0; count < 5; count++)
      expect(await savePlay(deps, { play: playWithId(count), ip: `192.0.2.${count}` })).toEqual({ kind: "stored" });
    const refused = await savePlay(deps, { play: playWithId(5), ip: "192.0.2.99" });
    expect(refused.kind).toBe("limited");
  });

  test("are off without a salt, as in local development", async () => {
    const { deps } = setup({ rateSalt: null });
    for (let count = 0; count < 9; count++)
      expect(await savePlay(deps, { play: playWithId(count), ip: "203.0.113.7" })).toEqual({ kind: "stored" });
  });
});
