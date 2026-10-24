import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { replaysExactlyOn } from "./plays";
import { Recorder } from "./recording";

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
