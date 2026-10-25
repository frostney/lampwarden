import { describe, expect, test } from "bun:test";
import { newLegacy } from "./legacy";
import { LESSONS, type Lesson, newPractice, stagePractice } from "./practice";
import { STEP } from "./replay";
import { type Input, litCount, NO_INPUT, type State, step } from "./sim";
import { wardenAutopilot } from "./staged";

// Plays the practice with `player` choosing each step's input, as the scene does: the lesson's staging first, then the
// step. Returns each lesson as it began and the state at the end.
function practise(seed: number, player: (state: State, lesson: Lesson) => Input, seconds: number) {
  const practice = newPractice(newLegacy(), seed);
  const lessons: Lesson[] = [practice.lesson];
  while (practice.lesson !== "done" && practice.state.elapsed < seconds) {
    stagePractice(practice);
    if (lessons.at(-1) !== practice.lesson) lessons.push(practice.lesson);
    step(practice.state, STEP, player(practice.state, practice.lesson));
  }
  return { practice, lessons };
}

// walks east for the first lesson, then fights and relights like the opening's warden
const learner = (state: State, lesson: Lesson): Input =>
  lesson === "move" ? { ...NO_INPUT, moveX: 1 } : (wardenAutopilot(state) ?? NO_INPUT);

describe("the practice night", () => {
  for (const seed of [1, 7, 4242])
    test(`a player who does each lesson learns them all, in order (seed ${seed})`, () => {
      const { practice, lessons } = practise(seed, learner, 120);
      expect(lessons).toEqual([...LESSONS, "done"]);
      expect(practice.state.outcome).toBeNull();
    });

  test("a lesson waits for the player: standing still never moves past the first", () => {
    const { practice } = practise(1, () => NO_INPUT, 30);
    expect(practice.lesson).toBe("move");
    expect(practice.state.monsters).toHaveLength(0);
  });

  test("it cannot be lost: a player who stops after walking is clawed and the lamps put out, but the night goes on", () => {
    let walked = false;
    const { practice } = practise(
      3,
      (_state, lesson) => {
        if (lesson !== "move") walked = true;
        return walked ? NO_INPUT : { ...NO_INPUT, moveX: 1 };
      },
      300,
    );
    expect(practice.lesson).toBe("strike");
    expect(practice.state.outcome).toBeNull();
    expect(practice.state.hero.health).toBeGreaterThan(0);
    expect(litCount(practice.state)).toBeGreaterThanOrEqual(2);
    expect(practice.state.stats.lampsLost).toBeGreaterThan(0);
  });

  test("the relight lesson is about a lamp that is dark, and is learned when it burns again", () => {
    const practice = newPractice(newLegacy(), 5);
    practice.lesson = "relight";
    stagePractice(practice);
    const lamp = practice.lamp;
    expect(lamp?.lit).toBe(false);
    if (!lamp) return;
    practice.state.hero.x = lamp.x;
    practice.state.hero.y = lamp.y;
    while (practice.lesson === "relight" && practice.state.elapsed < 5) {
      step(practice.state, STEP, NO_INPUT);
      stagePractice(practice);
    }
    expect<Lesson>(practice.lesson).toBe("hold"); // the loop's condition narrowed it to "relight"
    expect(lamp.lit).toBe(true);
  });
});

describe("the relight lesson's lamp", () => {
  test("is a walk away, even when the sea has put out the lamp the warden stands by", () => {
    const practice = newPractice(newLegacy(), 5);
    const { state } = practice;
    const [near] = state.lamps;
    if (!near) throw new Error("no lamp");
    near.lit = false;
    state.hero.x = near.x;
    state.hero.y = near.y;
    practice.lesson = "relight";
    stagePractice(practice);
    expect(practice.lamp).not.toBe(near);
    expect(practice.lamp?.lit).toBe(false);
  });
});
