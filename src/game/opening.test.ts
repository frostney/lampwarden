import { describe, expect, test } from "bun:test";

import { newOpening, OPENING_LINES, stageOpening } from "./opening";
import { STEP } from "./replay";
import { litCount, step } from "./sim";

// plays the opening to its end, as the scene's fixed step does, noting what the plaza went through
function playOpening(sex: "male" | "female") {
  const opening = newOpening(sex);
  const lines: { line: number; at: number }[] = [];
  let fewestLit = litCount(opening.state);
  while (!opening.ended && opening.state.elapsed < 60) {
    step(opening.state, STEP, stageOpening(opening));
    if (lines.at(-1)?.line !== opening.line) {
      lines.push({ line: opening.line, at: opening.state.elapsed });
    }
    fewestLit = Math.min(fewestLit, litCount(opening.state));
  }
  return { opening, lines, fewestLit };
}

describe("the opening scene", () => {
  for (const sex of ["male", "female"] as const) {
    test(`tells its lines in order and ends on a quiet plaza (${sex})`, () => {
      const { opening, lines, fewestLit } = playOpening(sex);
      expect(opening.ended).toBe(true);
      expect(lines.map(({ line }) => line)).toEqual(OPENING_LINES.map((_, index) => index));
      // short enough to sit through, long enough to read every line
      expect(opening.state.elapsed).toBeLessThan(24);
      for (const [index, { at: began }] of lines.entries()) {
        const next = lines[index + 1]?.at ?? opening.state.elapsed;
        expect(next - began).toBeGreaterThanOrEqual(2.5);
      }
      // the sea puts a lamp out, and the warden fights the creatures off and lights it again
      expect(fewestLit).toBeLessThan(opening.state.lamps.length);
      expect(opening.state.stats.kills).toBe(2);
      expect(opening.state.monsters).toHaveLength(0);
      expect(litCount(opening.state)).toBe(opening.state.lamps.length);
      expect(opening.state.outcome).toBeNull();
    });
  }

  test("plays the same every time: the plaza and what happens on it come from a fixed seed", () => {
    const first = playOpening("male");
    const second = playOpening("male");
    expect(second.lines).toEqual(first.lines);
    expect(second.opening.state.hero).toEqual(first.opening.state.hero);
  });
});
