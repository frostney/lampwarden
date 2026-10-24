import { afterEach, describe, expect, test } from "bun:test";
import { bindKeyboard, consumePresses, liveInput, newControls, release, shootAt } from "./controls";
import { newLegacy } from "./legacy";
import { type Play, Recorder } from "./recording";
import { legacyOf, Replayer, STEP } from "./replay";
import { newNight, type State, step } from "./sim";

// a stand-in for the browser's window: the keyboard handlers only need to add and remove listeners and get events
const keyEvent = (type: "keydown" | "keyup", key: string) =>
  Object.assign(new Event(type, { cancelable: true }), { key, repeat: false });

function fakeWindow() {
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: target, configurable: true, writable: true });
  return target;
}

describe("menu presses and focus loss", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("releasing lets go of keys, the stick and every press and aim still waiting for a step", () => {
    const controls = newControls();
    controls.keys.add("d");
    controls.stickX = 1;
    controls.melee = true;
    shootAt(controls, 100, 200);
    release(controls);
    expect(controls.keys.size).toBe(0);
    expect(controls.stickX).toBe(0);
    expect(controls.melee).toBe(false);
    expect(controls.ranged).toBe(false);
    expect(controls.aim).toBeNull();
  });

  test("a press made while no night is live is gone once the next night starts from a release", () => {
    const target = fakeWindow();
    const controls = newControls();
    const unbind = bindKeyboard(controls, () => false);
    target.dispatchEvent(keyEvent("keydown", "j"));
    target.dispatchEvent(keyEvent("keydown", "k"));
    expect(controls.melee).toBe(true);
    expect(controls.ranged).toBe(true);
    release(controls);
    expect(controls.melee).toBe(false);
    expect(controls.ranged).toBe(false);
    expect(controls.aim).toBeNull();
    unbind();
  });

  test("Space and the arrows are kept from the page only while a night is live", () => {
    const target = fakeWindow();
    let live = false;
    const unbind = bindKeyboard(newControls(), () => live);
    for (const key of [" ", "ArrowLeft"]) {
      const menu = keyEvent("keydown", key);
      target.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(false);
    }
    live = true;
    for (const key of [" ", "ArrowLeft"]) {
      const night = keyEvent("keydown", key);
      target.dispatchEvent(night);
      expect(night.defaultPrevented).toBe(true);
    }
    unbind();
  });

  test("keys held down are tracked until their key comes up", () => {
    const target = fakeWindow();
    const controls = newControls();
    const unbind = bindKeyboard(controls, () => true);
    target.dispatchEvent(keyEvent("keydown", "D"));
    expect(controls.keys.has("d")).toBe(true);
    target.dispatchEvent(keyEvent("keyup", "D"));
    expect(controls.keys.has("d")).toBe(false);
    unbind();
  });
});

// where every shot is after each step, to compare a live night with its replay
const shotTrace = (state: State) => state.shots.map((shot) => `${shot.x.toFixed(3)},${shot.y.toFixed(3)}`).join(" ");

describe("live input", () => {
  test("a shot aimed left of the stage replays the way it flew", () => {
    const legacy = newLegacy();
    const live = newNight(legacy, 11);
    const recorder = new Recorder(legacy, 11, "test", null);
    const controls = newControls();
    const liveTrace: string[] = [];
    let aimedOffStage = 0;
    for (let stepIndex = 0; stepIndex < 240 && !live.outcome; stepIndex++) {
      if (stepIndex % 20 === 0) {
        // as a pad's right stick aims: a point 260 px to the left, further than the warden is from the stage's edge
        controls.ranged = true;
        controls.aim = { x: Math.round(live.hero.x - 520), y: Math.round(live.hero.y - 40 - 90) };
        if (controls.aim.x < 0) aimedOffStage++;
      }
      const input = liveInput(controls, live.hero);
      recorder.input(stepIndex, input, live);
      step(live, STEP, input);
      consumePresses(controls);
      liveTrace.push(shotTrace(live));
    }
    expect(aimedOffStage).toBeGreaterThan(0);
    expect(liveTrace.some((trace) => trace !== "")).toBe(true);

    const play: Play = JSON.parse(JSON.stringify(recorder.finish(live)));
    const replayed = newNight(legacyOf(play), play.seed);
    const replayer = new Replayer(play);
    const replayTrace: string[] = [];
    for (let stepIndex = 0; stepIndex < liveTrace.length; stepIndex++) {
      step(replayed, STEP, replayer.input(stepIndex));
      replayTrace.push(shotTrace(replayed));
    }
    expect(replayTrace).toEqual(liveTrace);
    expect(replayed.hero.octant).toBe(live.hero.octant);
  });

  test("an aim left of the stage keeps its direction from the warden", () => {
    const controls = newControls();
    const hero = { x: 200, y: 300 };
    controls.aim = { x: -200, y: 160 }; // 400 left of the warden and 100 below his shot (which leaves at y 260)
    const aim = liveInput(controls, hero).aim;
    expect(aim).toEqual({ x: 0, y: 210 });
  });
});
