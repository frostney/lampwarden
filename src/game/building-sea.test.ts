import { describe, expect, test } from "bun:test";
import { type Building, buildingSchema, type NextBuildingResponse } from "./building";
import { createBuildingSea } from "./building-sea";
import { createSea } from "./sea";

const building = (id: string): Building =>
  buildingSchema.parse({
    id,
    name: `Building ${id}`,
    brief: "a small marble shrine with two columns",
    anchorY: 0.8,
    bbox: [30, 20, 90, 106],
    extent: {
      hull: [
        [-30, -28],
        [30, -28],
        [30, 4],
        [-30, 4],
      ],
      solid: [
        [-30, -28],
        [30, -28],
        [30, 3],
        [-30, 3],
      ],
      band: 28,
      sprite: { left: -30, right: 30, top: -40, bottom: 4 },
    },
    score: 7,
    createdAt: "2026-10-25T09:00:00.000Z",
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A sea of buildings whose answers the test decides, with a clock that only moves when told. */
function fakeBuildingSea() {
  const questions: string[][] = [];
  const followed: string[] = [];
  const slept: number[] = [];
  const finish = new Map<string, (finished: Building | null) => void>();
  let answer: NextBuildingResponse | null = { kind: "none", reason: "unavailable" };
  const answers: Array<NextBuildingResponse | null> = [];
  const sea = createBuildingSea({
    askForBuilding: async (seen) => {
      questions.push([...seen]);
      return answers.shift() ?? answer;
    },
    waitForBuildingJob: (jobId) => {
      followed.push(jobId);
      return new Promise((resolve) => finish.set(jobId, resolve));
    },
    sleep: async (milliseconds) => {
      slept.push(milliseconds);
    },
  });
  return {
    sea,
    questions,
    followed,
    slept,
    finish: (jobId: string, finished: Building | null) => finish.get(jobId)?.(finished),
    answer: (next: NextBuildingResponse | null) => {
      answer = next;
    },
    answerOnce: (...next: Array<NextBuildingResponse | null>) => {
      answers.push(...next);
    },
  };
}

describe("the plaza's building, asked for like the creature", () => {
  test("a ready building is shown, and the same question again keeps it", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "ready", building: building("0000aaaa-shrine-aaaaaa") });
    world.sea.ask([]);
    await settle();
    expect(world.sea.get()).toEqual({ kind: "ready", building: building("0000aaaa-shrine-aaaaaa") });
    world.sea.ask([]);
    await settle();
    expect(world.questions).toEqual([[]]);
  });

  test("seeing it go up is a new question, and a job that outlives the night is kept", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "generating", jobId: "job-1" });
    world.sea.ask(["0000aaaa-shrine-aaaaaa"]);
    await settle();
    expect(world.sea.get()).toEqual({ kind: "generating", step: "queued" });
    world.sea.ask(["0000aaaa-shrine-aaaaaa"]); // the night ends: the same question
    await settle();
    expect(world.followed).toEqual(["job-1"]);
    world.finish("job-1", building("0000bbbb-granary-bbbbbb"));
    await settle();
    expect(world.sea.get()).toMatchObject({ kind: "ready", building: { id: "0000bbbb-granary-bbbbbb" } });
  });

  test("a failed job leaves the plaza as it was, and the next asking is a new one", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "generating", jobId: "job-1" });
    world.sea.ask([]);
    await settle();
    world.finish("job-1", null);
    await settle();
    expect(world.sea.get()).toEqual({ kind: "none" });
    world.sea.ask([]);
    await settle();
    expect(world.questions).toHaveLength(2);
  });

  test("a building whose sprite will not load is withdrawn", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "ready", building: building("0000aaaa-shrine-aaaaaa") });
    world.sea.ask([]);
    await settle();
    world.sea.withdraw("0000aaaa-shrine-aaaaaa");
    expect(world.sea.get()).toEqual({ kind: "none" });
    world.sea.ask([]); // a new asking, since the last one's answer was no good
    await settle();
    expect(world.questions).toHaveLength(2);
  });

  test("a busy slot is asked again after the delay it names, then answered", async () => {
    const world = fakeBuildingSea();
    world.answerOnce(
      { kind: "none", reason: "busy", retryAfterSeconds: 15 },
      { kind: "none", reason: "busy", retryAfterSeconds: 15 },
      { kind: "generating", jobId: "job-2" },
    );
    world.sea.ask([]);
    await settle();
    expect(world.slept).toEqual([15_000, 15_000]);
    expect(world.questions).toEqual([[], [], []]);
    expect(world.followed).toEqual(["job-2"]);
  });

  test("a delay of nothing is still a wait, so a server that names none is not asked in a tight loop", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "none", reason: "busy", retryAfterSeconds: 0 });
    world.sea.ask([]);
    await settle();
    expect(world.slept.every((milliseconds) => milliseconds >= 1000)).toBe(true);
    expect(world.slept).toHaveLength(300);
  });

  test("a limit is not asked again: a long delay is let go", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "none", reason: "rate-limited", retryAfterSeconds: 3000 });
    world.sea.ask([]);
    await settle();
    expect(world.slept).toEqual([]);
    expect(world.questions).toEqual([[]]);
  });

  test("a busy slot that stays busy is waited for as long as the longest job, then given up on", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "none", reason: "busy", retryAfterSeconds: 15 });
    world.sea.ask([]);
    await settle();
    expect(world.slept).toHaveLength(20); // 20 waits of 15 s: 300 s
    expect(world.questions).toHaveLength(21);
    expect(world.sea.get()).toEqual({ kind: "none" });
  });

  test("a page that goes while it waits for the slot stops asking", async () => {
    const world = fakeBuildingSea();
    world.answer({ kind: "none", reason: "busy", retryAfterSeconds: 15 });
    let release: () => void = () => {};
    const slowSea = createBuildingSea({
      askForBuilding: async (seen) => {
        world.questions.push([...seen]);
        return { kind: "none", reason: "busy", retryAfterSeconds: 15 };
      },
      waitForBuildingJob: async () => null,
      sleep: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    slowSea.ask([]);
    await settle();
    slowSea.dispose();
    release();
    await settle();
    expect(world.questions).toHaveLength(1);
  });
});

describe("the building's question goes after the creature's", () => {
  test("it is held back until the creature's question has settled, whether it ended ready or with a job done", async () => {
    const finishCreature: { run: (() => void) | null } = { run: null };
    const creatureSea = createSea({
      askForCreature: async () => ({ kind: "generating", jobId: "job-creature" }),
      waitForJob: () =>
        new Promise((resolve) => {
          finishCreature.run = () => resolve(null);
        }),
    });
    const world = fakeBuildingSea();
    world.answer({ kind: "generating", jobId: "job-building" });
    creatureSea.ask([]);
    world.sea.ask([], creatureSea.settled());
    await settle();
    expect(world.questions).toEqual([]); // the creature's job is still being made
    finishCreature.run?.();
    await settle();
    expect(world.questions).toEqual([[]]);
    expect(world.followed).toEqual(["job-building"]);
  });

  test("with no creature question to wait for, it asks at once", async () => {
    const creatureSea = createSea({ askForCreature: async () => null, waitForJob: async () => null });
    const world = fakeBuildingSea();
    world.sea.ask([], creatureSea.settled());
    await settle();
    expect(world.questions).toEqual([[]]);
  });

  test("a question held back is dropped if a newer one has replaced it", async () => {
    const world = fakeBuildingSea();
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    world.sea.ask(["a"], gate);
    world.sea.ask(["a", "b"]);
    await settle();
    expect(world.questions).toEqual([["a", "b"]]);
    open();
    await settle();
    expect(world.questions).toEqual([["a", "b"]]);
  });
});
