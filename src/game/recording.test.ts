import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { replaysExactlyOn } from "./plays";
import {
  flushQueue,
  MAX_PLAY_CHARS,
  MAX_QUEUED_PLAYS,
  type PlayStorage,
  type QueuedPlay,
  queuedPlays,
  queuePlay,
  Recorder,
  unqueuePlay,
} from "./recording";
import { NO_INPUT, newNight } from "./sim";

const SIM = "0123456789ab";

describe("a recording and the sim it was played on", () => {
  test("carries the sim it was played on, and replays only there", () => {
    const play = JSON.parse(JSON.stringify(new Recorder(newLegacy(), 1, "", null, SIM).play));
    expect(play.sim).toBe(SIM);
    expect(replaysExactlyOn(play, SIM)).toBe(true);
    expect(replaysExactlyOn(play, "ba9876543210")).toBe(false);
  });

  test("a recording made where the sim is unknown names none and is refused later", () => {
    const play = JSON.parse(JSON.stringify(new Recorder(newLegacy(), 1, "").play));
    expect(play).not.toHaveProperty("sim");
    expect(replaysExactlyOn(play, SIM)).toBe(false);
  });
});

function memoryStorage(): PlayStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const queued = (id: string, size = 10): QueuedPlay => ({ id, body: "x".repeat(size) });
const ids = (storage: PlayStorage) => queuedPlays(storage).map((waiting) => waiting.id);

describe("the queue of plays that did not reach the server", () => {
  test("keeps plays oldest first, and a play queued again replaces its earlier self and goes to the end", () => {
    const storage = memoryStorage();
    queuePlay(storage, queued("a"));
    queuePlay(storage, queued("b"));
    queuePlay(storage, { id: "a", body: "the finished night" });
    expect(ids(storage)).toEqual(["b", "a"]);
    expect(queuedPlays(storage).at(-1)?.body).toBe("the finished night");
  });

  test("holds a few plays and drops the oldest past that", () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_QUEUED_PLAYS + 2; index++) queuePlay(storage, queued(`play-${index}`));
    expect(ids(storage)).toEqual(["play-2", "play-3", "play-4", "play-5", "play-6"]);
  });

  test("holds a byte cap and drops the oldest past that", () => {
    const storage = memoryStorage();
    const big = MAX_PLAY_CHARS - 1;
    queuePlay(storage, queued("first", big));
    queuePlay(storage, queued("second", big));
    expect(ids(storage)).toEqual(["first", "second"]);
    queuePlay(storage, queued("third", big));
    expect(ids(storage)).toEqual(["second", "third"]);
  });

  test("never queues a play the server would refuse for its size", () => {
    const storage = memoryStorage();
    queuePlay(storage, queued("kept"));
    queuePlay(storage, queued("huge", MAX_PLAY_CHARS + 1));
    expect(ids(storage)).toEqual(["kept"]);
  });

  test("forgets a play once it is sent, and ignores one it never held", () => {
    const storage = memoryStorage();
    queuePlay(storage, queued("a"));
    queuePlay(storage, queued("b"));
    unqueuePlay(storage, "a");
    unqueuePlay(storage, "nobody");
    expect(ids(storage)).toEqual(["b"]);
  });

  test("reads a damaged queue as empty", () => {
    const storage = memoryStorage();
    storage.setItem("lampwarden:unsent", "{not json");
    expect(queuedPlays(storage)).toEqual([]);
    storage.setItem("lampwarden:unsent", JSON.stringify([{ id: 4 }]));
    expect(queuedPlays(storage)).toEqual([]);
    queuePlay(storage, queued("a"));
    expect(ids(storage)).toEqual(["a"]);
  });

  test("a storage that refuses loses the play quietly", () => {
    const refusing: PlayStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => queuePlay(refusing, queued("a"))).not.toThrow();
  });
});

describe("sending the queue again", () => {
  test("sends oldest first and empties the queue", async () => {
    const storage = memoryStorage();
    for (const id of ["a", "b", "c"]) queuePlay(storage, queued(id));
    const order: string[] = [];
    await flushQueue(storage, async (waiting) => {
      order.push(waiting.id);
      return "sent";
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(ids(storage)).toEqual([]);
  });

  test("stops at the first play that must wait and keeps it and the ones behind it", async () => {
    const storage = memoryStorage();
    for (const id of ["a", "b", "c"]) queuePlay(storage, queued(id));
    const order: string[] = [];
    await flushQueue(storage, async (waiting) => {
      order.push(waiting.id);
      return waiting.id === "b" ? "retry" : "sent";
    });
    expect(order).toEqual(["a", "b"]);
    expect(ids(storage)).toEqual(["b", "c"]);
  });

  test("drops a play the server will never take and goes on", async () => {
    const storage = memoryStorage();
    for (const id of ["a", "b"]) queuePlay(storage, queued(id));
    const order: string[] = [];
    await flushQueue(storage, async (waiting) => {
      order.push(waiting.id);
      return waiting.id === "a" ? "rejected" : "sent";
    });
    expect(order).toEqual(["a", "b"]);
    expect(ids(storage)).toEqual([]);
  });

  test("leaves alone the plays on their way right now", async () => {
    const storage = memoryStorage();
    for (const id of ["a", "b"]) queuePlay(storage, queued(id));
    const order: string[] = [];
    await flushQueue(
      storage,
      async (waiting) => {
        order.push(waiting.id);
        return "sent";
      },
      new Set(["a"]),
    );
    expect(order).toEqual(["b"]);
    expect(ids(storage)).toEqual(["a"]);
  });
});

describe("a snapshot of a night that may go on", () => {
  test("keeps the id, says nothing twice for the same step, and gives way to the finished night", () => {
    const legacy = newLegacy();
    const state = newNight(legacy, 1);
    const recorder = new Recorder(legacy, 1, "");
    expect(recorder.snapshot(state)).toBeNull(); // nothing recorded yet
    recorder.input(0, NO_INPUT, state);
    const snapshot = recorder.snapshot(state);
    expect(snapshot?.id).toBe(recorder.play.id);
    expect(snapshot?.outcome).toBeNull();
    expect(recorder.snapshot(state)).toBeNull(); // a pagehide right after the hide
    recorder.input(1, NO_INPUT, state);
    expect(recorder.snapshot(state)?.steps).toBe(2); // the night went on after a restore
  });
});
