import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { holdGamepad, newGamepadMemory, pollGamepadForMenu } from "./gamepad";

// a standard-mapping pad whose A button (index 0) is up or down, and whose left stick points down or rests
let aDown = false;
let stickDown = false;
const pad = () => ({
  connected: true,
  axes: [0, stickDown ? 1 : 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 0 && aDown, touched: false, value: 0 })),
});
const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads: () => [pad()] } });
afterEach(() => {
  aDown = false;
  stickDown = false;
});
afterAll(() => {
  if (original) {
    Object.defineProperty(globalThis, "navigator", original);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

describe("a pad's presses in the menus", () => {
  test("a press of A confirms once", () => {
    const memory = newGamepadMemory();
    aDown = true;
    expect(pollGamepadForMenu(memory, 0)).toBe("confirm");
    expect(pollGamepadForMenu(memory, 16)).toBeNull();
  });

  test("a button already held while the poll was not acting is not a press when it acts again", () => {
    const memory = newGamepadMemory();
    aDown = true;
    holdGamepad(memory); // e.g. the night pauses while A is down
    expect(pollGamepadForMenu(memory, 0)).toBeNull();
    aDown = false;
    holdGamepad(memory);
    aDown = true;
    expect(pollGamepadForMenu(memory, 16)).toBe("confirm");
  });

  test("a direction held as the menus come back moves the focus only once it is let go and pushed again", () => {
    const memory = newGamepadMemory();
    stickDown = true;
    holdGamepad(memory); // e.g. the warden was walking when the night paused
    expect(pollGamepadForMenu(memory, 1000)).toBeNull();
    stickDown = false;
    expect(pollGamepadForMenu(memory, 1016)).toBeNull();
    stickDown = true;
    expect(pollGamepadForMenu(memory, 1032)).toBe("next");
  });
});
