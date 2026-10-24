import { afterEach, describe, expect, test } from "bun:test";
import { bindKeyboard, newControls, release, shootAt } from "./controls";

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
