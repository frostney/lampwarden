import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { type Building, buildingSchema } from "./building";
import { askForBuilding, waitForBuildingJob } from "./building-api";
import type { JobStep } from "./creature";

const building: Building = buildingSchema.parse({
  id: "0000aaaa-stoa-abc123",
  name: "Stoa of the net-menders",
  brief: "long Ionic marble colonnade with a terracotta tiled roof",
  anchorY: 0.83,
  bbox: [34, 70, 93, 109],
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
  score: 7.5,
  createdAt: "2026-10-25T09:00:00.000Z",
});

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
  updatedAt: "2026-10-25T09:00:00.000Z",
  ...extra,
});
const options = (steps: JobStep[] = []) => ({
  onStep: (step: JobStep) => steps.push(step),
  isCurrent: () => true,
  pollInterval: 1,
});

describe("asking for a building", () => {
  test("posts the ids the line has seen and reads each kind of answer, a busy slot with its delay", async () => {
    answers(
      { kind: "ready", building },
      { kind: "generating", jobId: "job-1" },
      { kind: "none", reason: "rate-limited" },
      { kind: "none", reason: "busy", retryAfterSeconds: 15 },
    );
    expect(await askForBuilding(["old-one-1"])).toEqual({ kind: "ready", building });
    expect(await askForBuilding([])).toEqual({ kind: "generating", jobId: "job-1" });
    expect(await askForBuilding([])).toEqual({ kind: "none", reason: "rate-limited" });
    expect(await askForBuilding([])).toEqual({ kind: "none", reason: "busy", retryAfterSeconds: 15 });
    const [url, init] = fetching.mock.calls[0] ?? [];
    expect(url).toBe("/api/buildings/next");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ seen: ["old-one-1"] });
  });

  test("an answer that is not one, or a network error, is nothing", async () => {
    answers(
      { kind: "ready", building: { ...building, anchorY: 9 } },
      { kind: "ready", building: { ...building, extent: { ...building.extent, hull: [] } } },
      { kind: "generating", jobId: "../escape" },
      { kind: "none", reason: "busy", retryAfterSeconds: -4 },
      { error: "oops" },
    );
    for (let call = 0; call < 5; call++) expect(await askForBuilding([])).toBeNull();
    fetching.mockImplementationOnce(
      standIn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await askForBuilding([])).toBeNull();
  });
});

describe("following a building job", () => {
  test("reports each step and returns the building when it is done", async () => {
    answers(job("drawing"), job("judging"), job("done", { building }));
    const steps: JobStep[] = [];
    expect(await waitForBuildingJob("job-1", options(steps))).toEqual(building);
    expect(steps).toEqual(["drawing", "judging"]);
    expect(fetching.mock.calls.map(([url]) => url)).toEqual(Array(3).fill("/api/buildings/jobs/job-1"));
  });

  test("a failed job gives nothing", async () => {
    answers(job("writing"), job("failed", { error: "the verifier gave up" }));
    expect(await waitForBuildingJob("job-1", options())).toBeNull();
  });

  test("a job whose answers keep failing is let go", async () => {
    answers({ nonsense: true }, { nonsense: true }, { nonsense: true }, job("done", { building }));
    expect(await waitForBuildingJob("job-1", options())).toBeNull();
    expect(fetching).toHaveBeenCalledTimes(3);
  });

  test("it stops looking once the night has begun", async () => {
    let current = true;
    answers(job("drawing"), job("rendering"), job("done", { building }));
    const result = await waitForBuildingJob("job-1", {
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
