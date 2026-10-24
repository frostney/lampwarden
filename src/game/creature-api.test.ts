import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Creature, JobStep } from "./creature";
import { askForCreature, waitForJob } from "./creature-api";

const creature: Creature = {
  id: "brine-hound-1",
  name: "Brine hound",
  lore: "It follows the smell of lamp oil up the quay.",
  brief: "a hound of grey sea foam with a lantern jaw",
  archetype: "skulker",
  modifiers: { speed: 1, toughness: 0, bite: 0, snuffing: -1 },
  anchorY: 0.8,
  score: 8,
  createdAt: "2026-10-24T01:00:00.000Z",
};

const fetching = spyOn(globalThis, "fetch");
afterEach(() => fetching.mockReset());
afterAll(() => fetching.mockRestore());

// a stand-in for fetch (bun's typing wants its preconnect too)
const standIn = (respond: () => Promise<Response>): typeof fetch => Object.assign(respond, { preconnect: () => {} });
const answers = (...bodies: unknown[]) => {
  for (const body of bodies) fetching.mockImplementationOnce(standIn(async () => Response.json(body)));
};
const job = (step: JobStep, extra: object = {}) => ({
  jobId: "job-1",
  step,
  updatedAt: "2026-10-24T01:00:00.000Z",
  ...extra,
});
const options = (steps: JobStep[] = []) => ({
  onStep: (step: JobStep) => steps.push(step),
  isCurrent: () => true,
  pollInterval: 1,
});

describe("asking the sea", () => {
  test("posts the ids the line has met and reads each kind of answer", async () => {
    answers(
      { kind: "ready", creature },
      { kind: "generating", jobId: "job-1" },
      { kind: "none", reason: "rate-limited" },
    );
    expect(await askForCreature(["old-one-1"])).toEqual({ kind: "ready", creature });
    expect(await askForCreature([])).toEqual({ kind: "generating", jobId: "job-1" });
    expect(await askForCreature([])).toEqual({ kind: "none", reason: "rate-limited" });
    const [url, init] = fetching.mock.calls[0] ?? [];
    expect(url).toBe("/api/creatures/next");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ seen: ["old-one-1"] });
  });

  test("an answer that is not one, or a network error, is nothing", async () => {
    answers(
      { kind: "ready", creature: { ...creature, anchorY: 9 } },
      { kind: "generating", jobId: "../escape" },
      { error: "oops" },
    );
    expect(await askForCreature([])).toBeNull();
    expect(await askForCreature([])).toBeNull();
    expect(await askForCreature([])).toBeNull();
    fetching.mockImplementationOnce(
      standIn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await askForCreature([])).toBeNull();
  });
});

describe("following a job", () => {
  test("reports each step and returns the creature when it is done", async () => {
    answers(job("drawing"), job("judging"), job("done", { creature }));
    const steps: JobStep[] = [];
    expect(await waitForJob("job-1", options(steps))).toEqual(creature);
    expect(steps).toEqual(["drawing", "judging"]);
    expect(fetching.mock.calls.map(([url]) => url)).toEqual(Array(3).fill("/api/creatures/jobs/job-1"));
  });

  test("a failed job gives nothing", async () => {
    answers(job("writing"), job("failed", { error: "the verifier gave up" }));
    expect(await waitForJob("job-1", options())).toBeNull();
  });

  test("a job whose answers keep failing is let go", async () => {
    answers({ nonsense: true }, { nonsense: true }, { nonsense: true }, job("done", { creature }));
    expect(await waitForJob("job-1", options())).toBeNull();
    expect(fetching).toHaveBeenCalledTimes(3);
  });

  test("it stops looking once the night has begun", async () => {
    let current = true;
    answers(job("drawing"), job("rendering"), job("done", { creature }));
    const result = await waitForJob("job-1", {
      ...options(),
      isCurrent: () => current,
      onStep: () => {
        current = false;
      },
    });
    expect(result).toBeNull();
    expect(fetching).toHaveBeenCalledTimes(1);
  });
});
