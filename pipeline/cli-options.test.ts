import { describe, expect, test } from "bun:test";
import { countOption } from "./cli-options";

describe("a count on the command line", () => {
  test("is the fallback when it is not given, and the number when it is", () => {
    expect(countOption("concurrency", undefined, 4)).toBe(4);
    expect(countOption("concurrency", "2", 4)).toBe(2);
    expect(countOption("candidates", "5", 1, 5)).toBe(5);
  });

  test("stops the script when it would run nothing, is not written in digits, or is past its maximum", () => {
    for (const value of ["0", "-1", "1.5", "four", "", "0x10", "1e3", " 2"])
      expect(() => countOption("concurrency", value, 4)).toThrow("--concurrency takes a whole number of at least 1");
    expect(() => countOption("candidates", "6", 1, 5)).toThrow("--candidates takes a whole number from 1 to 5");
  });
});
