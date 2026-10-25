import { describe, expect, test } from "bun:test";

import { newLegacy } from "./legacy";
import { playSchema, replaysExactlyOn } from "./plays";
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
import { STEP, verifyPlay } from "./replay";
import { NO_INPUT, newNight, step } from "./sim";

const SIM = "0123456789ab";

describe("the hidden time a recording keeps", () => {
  // bun has no document: a stand-in with the one event and the one property the recorder reads
  const withDocument = async (run: (page: EventTarget & { visibilityState: string }) => Promise<void>) => {
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    Reflect.set(globalThis, "document", page);
    try {
      await run(page);
    } finally {
      Reflect.deleteProperty(globalThis, "document");
    }
  };
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  test("is the seconds the tab was hidden during the night, and is optional so older plays still validate", async () => {
    await withDocument(async (page) => {
      const recorder = new Recorder(newLegacy(), 1, "");
      await wait(30);
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      await wait(150);
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      await wait(30);
      const play = JSON.parse(JSON.stringify(recorder.finish(newNight(newLegacy(), 1))));
      expect(play.hiddenSeconds).toBeGreaterThanOrEqual(0.1);
      expect(play.hiddenSeconds).toBeLessThan(1);
      const { hiddenSeconds: _kept, ...older } = play;
      expect(playSchema.safeParse(play).success).toBe(true);
      expect(playSchema.safeParse(older).success).toBe(true);
      expect(playSchema.safeParse({ ...play, hiddenSeconds: -1 }).success).toBe(false);
      expect(playSchema.safeParse({ ...play, hiddenSeconds: "long" }).success).toBe(false);
    });
  });

  test("a night that ends with the tab still hidden counts the time up to its end, and a visible one counts none", async () => {
    await withDocument(async (page) => {
      const recorder = new Recorder(newLegacy(), 1, "");
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      await wait(120);
      expect(recorder.finish(newNight(newLegacy(), 1)).hiddenSeconds).toBeGreaterThanOrEqual(0.1);
      const steady = new Recorder(newLegacy(), 1, "");
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      await wait(50);
      expect(steady.finish(newNight(newLegacy(), 1)).hiddenSeconds).toBe(0);
    });
  });

  test("a recorder that has finished stops listening", async () => {
    await withDocument(async (page) => {
      const recorder = new Recorder(newLegacy(), 1, "");
      const play = recorder.finish(newNight(newLegacy(), 1));
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      await wait(100);
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      expect(play.hiddenSeconds).toBe(0);
    });
  });

  test("changes nothing about how the night plays: the same night replays exactly with and without it", () => {
    const legacy = newLegacy();
    const state = newNight(legacy, 5);
    const recorder = new Recorder(legacy, 5, "");
    for (let stepIndex = 0; stepIndex < 600; stepIndex++) {
      recorder.input(stepIndex, NO_INPUT, state);
      step(state, STEP, NO_INPUT);
    }
    const play = JSON.parse(JSON.stringify(recorder.finish(state)));
    const withoutIt = { ...play };
    delete withoutIt.hiddenSeconds;
    expect(verifyPlay(play).state.stats).toEqual(verifyPlay(withoutIt).state.stats);
  });
});

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
    for (let index = 0; index < MAX_QUEUED_PLAYS + 2; index++) {
      queuePlay(storage, queued(`play-${index}`));
    }
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
    for (const id of ["a", "b", "c"]) {
      queuePlay(storage, queued(id));
    }
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
    for (const id of ["a", "b", "c"]) {
      queuePlay(storage, queued(id));
    }
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
    for (const id of ["a", "b"]) {
      queuePlay(storage, queued(id));
    }
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
    for (const id of ["a", "b"]) {
      queuePlay(storage, queued(id));
    }
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

  test("leaves the recorder counting hidden time, so a night that goes on keeps it", async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    Reflect.set(globalThis, "document", page);
    try {
      const legacy = newLegacy();
      const state = newNight(legacy, 1);
      const recorder = new Recorder(legacy, 1, "");
      recorder.input(0, NO_INPUT, state);
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(recorder.snapshot(state)?.hiddenSeconds).toBeGreaterThanOrEqual(0.1); // still hidden: the open stretch counts
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      expect(recorder.finish(state).hiddenSeconds).toBeGreaterThanOrEqual(0.1);
    } finally {
      Reflect.deleteProperty(globalThis, "document");
    }
  });
});
