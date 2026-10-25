import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { isNewLine, loadWelcome, markWelcome } from "./welcome";

const storage = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
afterEach(() => storage.clear());
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("what a new player has been shown", () => {
  test("nothing at first, and each one once marked, across a reload", () => {
    expect(loadWelcome()).toEqual({ opening: false, practice: false });
    markWelcome(loadWelcome(), "opening");
    expect(loadWelcome()).toEqual({ opening: true, practice: false });
    markWelcome(loadWelcome(), "practice");
    expect(loadWelcome()).toEqual({ opening: true, practice: true });
  });

  test("a damaged store shows the welcome again rather than failing", () => {
    storage.set("lampwarden:welcome:v1", "{not json");
    expect(loadWelcome()).toEqual({ opening: false, practice: false });
    storage.set("lampwarden:welcome:v1", JSON.stringify({ opening: "yes" }));
    expect(loadWelcome()).toEqual({ opening: false, practice: false });
  });

  test("only a line that has never played a night is new", () => {
    expect(isNewLine(newLegacy())).toBe(true);
    expect(isNewLine({ ...newLegacy(), night: 2, bestNight: 1 })).toBe(false);
    expect(isNewLine({ ...newLegacy(), generation: 2 })).toBe(false);
  });
});
