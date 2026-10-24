import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { incomingPlay, replaysExactlyOn } from "./plays";
import { Recorder } from "./recording";
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
      expect(incomingPlay.safeParse(play).success).toBe(true);
      expect(incomingPlay.safeParse(older).success).toBe(true);
      expect(incomingPlay.safeParse({ ...play, hiddenSeconds: -1 }).success).toBe(false);
      expect(incomingPlay.safeParse({ ...play, hiddenSeconds: "long" }).success).toBe(false);
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
