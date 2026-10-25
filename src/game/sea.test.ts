import { describe, expect, test } from "bun:test";

import type { Creature, NextCreatureResponse } from "./creature";
import { createSea } from "./sea";

const creature = (id: string): Creature => ({
  id,
  name: `Creature ${id}`,
  lore: "A line of lore for the test.",
  brief: "a creature of the deep sea",
  archetype: "brute",
  modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 7,
  createdAt: "2026-10-24T12:00:00.000Z",
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A sea whose answers the test decides: what the gallery says, and when each job finishes. */
function fakeSea() {
  const questions: string[][] = [];
  const followed: string[] = [];
  const finish = new Map<string, (finished: Creature | null) => void>();
  let answer: NextCreatureResponse | null = { kind: "none", reason: "unavailable" };
  const sea = createSea({
    askForCreature: async (seen) => {
      questions.push([...seen]);
      return answer;
    },
    waitForJob: (jobId) => {
      followed.push(jobId);
      return new Promise((resolve) => finish.set(jobId, resolve));
    },
  });
  return {
    sea,
    questions,
    followed,
    finish: (jobId: string, finished: Creature | null) => finish.get(jobId)?.(finished),
    answer: (next: NextCreatureResponse | null) => {
      answer = next;
    },
  };
}

describe("asking the sea", () => {
  test("the same question while a job is being made keeps that job", async () => {
    const world = fakeSea();
    world.answer({ kind: "generating", jobId: "job-1" });
    world.sea.ask([]);
    await settle();
    expect(world.sea.get().kind).toBe("generating");
    world.sea.ask([]); // a night begins with nothing new met
    world.sea.ask([]); // and ends
    await settle();
    expect(world.questions).toEqual([[]]);
    expect(world.followed).toEqual(["job-1"]);
    world.finish("job-1", creature("brine-hound"));
    await settle();
    expect(world.sea.get()).toEqual({ kind: "ready", creature: creature("brine-hound") });
    world.sea.ask([]); // dawn: the answer stays
    expect(world.sea.get().kind).toBe("ready");
    expect(world.questions).toEqual([[]]);
  });

  test("meeting a creature is a new question, whatever order the ids come in", async () => {
    const world = fakeSea();
    world.answer({ kind: "ready", creature: creature("first-one") });
    world.sea.ask([]);
    await settle();
    world.answer({ kind: "generating", jobId: "job-2" });
    world.sea.ask(["first-one"]);
    expect(world.sea.get()).toEqual({ kind: "none" });
    await settle();
    expect(world.questions).toEqual([[], ["first-one"]]);
    world.sea.ask(["first-one"]);
    world.sea.ask(["first-one"]);
    expect(world.questions).toHaveLength(2);
    world.answer({ kind: "none", reason: "rate-limited", retryAfterSeconds: 60 });
    world.sea.ask(["second-one", "first-one"]);
    await settle();
    world.sea.ask(["first-one", "second-one"]);
    await settle();
    expect(world.questions).toHaveLength(4); // the second order is the same question, but nothing was coming: asked again
  });

  test("an answer with nothing coming is asked again, and so is a failure", async () => {
    const world = fakeSea();
    world.answer({ kind: "none", reason: "rate-limited", retryAfterSeconds: 60 });
    world.sea.ask([]);
    await settle();
    world.sea.ask([]);
    await settle();
    expect(world.questions).toEqual([[], []]);

    world.answer(null); // the network failed
    world.sea.ask([]);
    await settle();
    world.answer({ kind: "generating", jobId: "job-1" });
    world.sea.ask([]);
    await settle();
    world.finish("job-1", null); // the job failed
    await settle();
    expect(world.sea.get()).toEqual({ kind: "none" });
    world.sea.ask([]);
    await settle();
    expect(world.questions).toHaveLength(5);
  });

  test("a creature whose sprite will not load is withdrawn, and the next asking is a new one", async () => {
    const world = fakeSea();
    world.answer({ kind: "ready", creature: creature("broken-one") });
    world.sea.ask([]);
    await settle();
    world.sea.withdraw("someone-else"); // another creature's sprite: nothing changes
    expect(world.sea.get().kind).toBe("ready");
    world.sea.withdraw("broken-one");
    expect(world.sea.get()).toEqual({ kind: "none" });
    world.sea.ask([]);
    await settle();
    expect(world.questions).toEqual([[], []]);
  });

  test("an asking whose calls throw ends, and the next asking is a new one", async () => {
    let calls = 0;
    const sea = createSea({
      askForCreature: async () => {
        calls++;
        throw new Error("the network is gone");
      },
      waitForJob: async () => null,
    });
    sea.ask([]);
    await settle();
    expect(sea.get()).toEqual({ kind: "none" });
    sea.ask([]);
    await settle();
    expect(calls).toBe(2);
  });

  test("a page that goes drops the job it was following", async () => {
    const world = fakeSea();
    world.answer({ kind: "generating", jobId: "job-1" });
    world.sea.ask([]);
    await settle();
    world.sea.dispose();
    world.finish("job-1", creature("too-late"));
    await settle();
    expect(world.sea.get().kind).toBe("generating");
  });

  test("a creature told to wait for the slot a building holds asks again after the short delay it was given", async () => {
    const slept: number[] = [];
    const replies: Array<NextCreatureResponse | null> = [
      { kind: "none", reason: "rate-limited", retryAfterSeconds: 15 },
      { kind: "ready", creature: creature("after-the-wait") },
    ];
    const questions: string[][] = [];
    const sea = createSea({
      askForCreature: async (seen) => {
        questions.push([...seen]);
        return replies.shift() ?? null;
      },
      waitForJob: async () => null,
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
      },
    });
    sea.ask([]);
    await settle();
    expect(slept).toEqual([15_000]);
    expect(questions).toEqual([[], []]);
    expect(sea.get()).toEqual({ kind: "ready", creature: creature("after-the-wait") });
  });
});
