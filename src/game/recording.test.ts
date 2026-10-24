import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { incomingPlay, replaysExactlyOn } from "./plays";
import { Recorder } from "./recording";
import { STEP, verifyPlay } from "./replay";
import { NO_INPUT, newNight, step } from "./sim";

const SIM = "0123456789ab";

describe("the real time a recording keeps", () => {
  test("is the seconds the night took, from a monotonic clock, and is optional so older plays still validate", async () => {
    const recorder = new Recorder(newLegacy(), 1, "");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const state = newNight(newLegacy(), 1);
    const play = JSON.parse(JSON.stringify(recorder.finish(state)));
    expect(play.wallSeconds).toBeGreaterThanOrEqual(0.1);
    expect(play.wallSeconds).toBeLessThan(5);
    const { wallSeconds: _kept, ...older } = play;
    expect(incomingPlay.safeParse(play).success).toBe(true);
    expect(incomingPlay.safeParse(older).success).toBe(true);
    expect(incomingPlay.safeParse({ ...play, wallSeconds: -1 }).success).toBe(false);
    expect(incomingPlay.safeParse({ ...play, wallSeconds: "long" }).success).toBe(false);
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
    delete withoutIt.wallSeconds;
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
