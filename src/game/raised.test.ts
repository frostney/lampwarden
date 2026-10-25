import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { clearRaised, loadRaised, raise, saveRaised } from "./raised";

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

describe("the buildings a line has seen go up", () => {
  test("a building joins once, oldest first", () => {
    expect(raise([], "a")).toEqual(["a"]);
    expect(raise(["a"], "b")).toEqual(["a", "b"]);
    expect(raise(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  test("the oldest drop off past the 500 the gallery takes", () => {
    const many = Array.from({ length: 500 }, (_, index) => `building-${index}`);
    const next = raise(many, "newest");
    expect(next).toHaveLength(500);
    expect(next[0]).toBe("building-1");
    expect(next.at(-1)).toBe("newest");
  });

  test("is saved and loaded, and a new line starts with none", () => {
    expect(loadRaised()).toEqual([]);
    saveRaised(["a", "b"]);
    expect(loadRaised()).toEqual(["a", "b"]);
    clearRaised();
    expect(loadRaised()).toEqual([]);
  });

  test("a corrupt save is nothing raised, not a crash", () => {
    storage.set("lampwarden:raised:v1", "{nope");
    expect(loadRaised()).toEqual([]);
    storage.set("lampwarden:raised:v1", JSON.stringify({ not: "a list" }));
    expect(loadRaised()).toEqual([]);
    storage.set("lampwarden:raised:v1", JSON.stringify(["a", "a", "b"]));
    expect(loadRaised()).toEqual(["a", "b"]);
  });
});
