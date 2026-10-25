import { describe, expect, test } from "bun:test";
import { type Building, buildingSchema } from "@/game/building";
import type { Creature } from "@/game/creature";
import { fakeClock } from "../../../pipeline/fakes";
import { readCreatureConfig } from "../creatures/config";
import { nextBuilding, nextCreature, readBuildingJob, readJob, type ServiceDeps } from "../creatures/service";
import type { JobKind } from "../creatures/store";
import { createMemoryStore } from "../creatures/store.memory";

const GENERATING_ENV = {
  MUBIT_API_KEY: "key",
  VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1",
  CREATURE_RATE_SALT: "a-long-enough-test-salt",
};
const PNG = new Uint8Array([137, 80, 78, 71]);

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

const creature = (id: string): Creature => ({
  id,
  name: `Creature ${id}`,
  lore: "A line of lore for the test.",
  brief: "a creature of the deep sea",
  archetype: "brute",
  modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 7,
  createdAt: "2026-10-25T09:00:00.000Z",
});

function service(env: Record<string, string> = GENERATING_ENV) {
  const store = createMemoryStore();
  const clock = fakeClock();
  const started: Array<{ jobId: string; kind: JobKind }> = [];
  let counter = 0;
  const deps: ServiceDeps = {
    store,
    now: clock.now,
    config: readCreatureConfig(env),
    newJobId: () => `job-${++counter}-abcdef`,
    startJob: (jobId, kind) => started.push({ jobId, kind }),
    maxDurationSeconds: 300,
  };
  const askBuilding = (address: string | null, seen: string[] = []) => nextBuilding(deps, { seen, ip: address });
  const askCreature = (address: string | null, seen: string[] = []) => nextCreature(deps, { seen, ip: address });
  /** What the running job would do on finishing: mark itself done so the slot frees. */
  const finishJob = async (jobId: string) => {
    const stored = await store.getJob(jobId);
    await store.putJob({ ...stored, jobId, step: "done", updatedAt: clock.now().toISOString() });
  };
  return { deps, store, clock, started, askBuilding, askCreature, finishJob };
}

describe("buildings: the gallery", () => {
  test("answers with the newest building the player has not seen", async () => {
    const { store, askBuilding } = service();
    for (const id of ["0000aaaa-old-aaaaaa", "0000bbbb-middle-bbbbbb", "0000cccc-new-cccccc"]) {
      await store.putBuilding(building(id), PNG, "code");
    }
    expect(await askBuilding("1.1.1.1")).toMatchObject({ kind: "ready", building: { id: "0000cccc-new-cccccc" } });
    expect(await askBuilding("1.1.1.1", ["0000cccc-new-cccccc"])).toMatchObject({
      kind: "ready",
      building: { id: "0000bbbb-middle-bbbbbb" },
    });
  });

  test("the creatures' gallery and the buildings' are apart", async () => {
    const { store, askBuilding, askCreature } = service();
    await store.putCreature(creature("0000aaaa-old-aaaaaa"), PNG, "code");
    await store.putBuilding(building("0000bbbb-shrine-bbbbbb"), PNG, "code");
    expect(await askCreature("1.1.1.1")).toMatchObject({ kind: "ready", creature: { id: "0000aaaa-old-aaaaaa" } });
    expect(await askBuilding("1.1.1.1")).toMatchObject({ kind: "ready", building: { id: "0000bbbb-shrine-bbbbbb" } });
  });

  test("serves the gallery without limits and without a job, even with nothing configured", async () => {
    const { store, askBuilding, started } = service({});
    await store.putBuilding(building("0000aaaa-old-aaaaaa"), PNG, "code");
    for (let call = 0; call < 30; call++) expect((await askBuilding("1.1.1.1")).kind).toBe("ready");
    expect(started).toEqual([]);
  });
});

describe("buildings: starting a job", () => {
  test("starts one when the player has seen everything, as a building's job", async () => {
    const { askBuilding, started, store } = service();
    await store.putBuilding(building("0000aaaa-old-aaaaaa"), PNG, "code");
    expect(await askBuilding("1.1.1.1", ["0000aaaa-old-aaaaaa"])).toEqual({
      kind: "generating",
      jobId: "job-1-abcdef",
    });
    expect(started).toEqual([{ jobId: "job-1-abcdef", kind: "building" }]);
    expect(await store.getJob("job-1-abcdef")).toMatchObject({ step: "queued", kind: "building" });
  });

  test("starts nothing when generation is not configured", async () => {
    for (const env of [
      {},
      { ...GENERATING_ENV, MUBIT_API_KEY: "" },
      { ...GENERATING_ENV, CREATURE_RATE_SALT: "short" },
    ]) {
      const { askBuilding, started } = service(env);
      expect(await askBuilding("1.1.1.1")).toEqual({ kind: "none", reason: "unavailable" });
      expect(started).toEqual([]);
    }
  });

  test("everyone asking while a building job runs shares it", async () => {
    const { askBuilding, started } = service();
    const first = await askBuilding("1.1.1.1");
    expect(await askBuilding("2.2.2.2")).toEqual(first);
    expect(await askBuilding("1.1.1.1")).toEqual(first);
    expect(started).toHaveLength(1);
  });

  test("requests that arrive together start exactly one job", async () => {
    const { askBuilding, started } = service();
    await Promise.all([askBuilding("1.1.1.1"), askBuilding("2.2.2.2"), askBuilding("3.3.3.3"), askBuilding("4.4.4.4")]);
    expect(started).toHaveLength(1);
  });

  test("a building job that stopped moving no longer holds the slot", async () => {
    const { askBuilding, started, clock } = service();
    await askBuilding("1.1.1.1");
    clock.advance(301_000);
    expect(await askBuilding("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
    expect(started).toHaveLength(2);
  });
});

describe("buildings: the limits", () => {
  test("default to 12 starts a visitor an hour, 20 a day for the whole site, and a prefix of their own", () => {
    const config = readCreatureConfig(GENERATING_ENV);
    expect(config.buildingLimits).toEqual({ perVisitorPerHour: 12, perDay: 20 });
    expect(config.buildingBlobPrefix).toBe("buildings");
    // the creatures' are untouched
    expect(config.limits).toEqual({ perVisitorPerHour: 12, perDay: 40 });
    expect(config.blobPrefix).toBe("creatures");
  });

  test("come from the environment, and a malformed value falls back to the default", () => {
    const set = readCreatureConfig({
      ...GENERATING_ENV,
      BUILDING_MAX_STARTS_PER_VISITOR_PER_HOUR: "4",
      BUILDING_MAX_STARTS_PER_DAY: "7",
      BUILDING_BLOB_PREFIX: "buildings-dev",
    });
    expect(set.buildingLimits).toEqual({ perVisitorPerHour: 4, perDay: 7 });
    expect(set.buildingBlobPrefix).toBe("buildings-dev");
    const malformed = readCreatureConfig({
      ...GENERATING_ENV,
      BUILDING_MAX_STARTS_PER_VISITOR_PER_HOUR: "many",
      BUILDING_MAX_STARTS_PER_DAY: "-3",
      BUILDING_BLOB_PREFIX: "Not A Prefix!",
    });
    expect(malformed.buildingLimits).toEqual({ perVisitorPerHour: 12, perDay: 20 });
    expect(malformed.buildingBlobPrefix).toBe("buildings");
  });

  test("the building gallery follows a creature prefix set to keep a run apart, and is never the same prefix", () => {
    const apart = readCreatureConfig({ ...GENERATING_ENV, CREATURE_BLOB_PREFIX: "creatures-dev" });
    expect(apart.blobPrefix).toBe("creatures-dev");
    expect(apart.buildingBlobPrefix).toBe("creatures-dev-buildings");
    // set on its own, it is what was set
    expect(
      readCreatureConfig({
        ...GENERATING_ENV,
        CREATURE_BLOB_PREFIX: "creatures-dev",
        BUILDING_BLOB_PREFIX: "buildings-dev",
      }).buildingBlobPrefix,
    ).toBe("buildings-dev");
    // one prefix for both would mix their records
    const same = readCreatureConfig({
      ...GENERATING_ENV,
      CREATURE_BLOB_PREFIX: "gallery",
      BUILDING_BLOB_PREFIX: "gallery",
    });
    expect(same.buildingBlobPrefix).not.toBe(same.blobPrefix);
  });

  test("a visitor gets 12 starts an hour, then waits for the oldest to age out", async () => {
    const { askBuilding, finishJob, clock } = service();
    for (let start = 1; start <= 12; start++) {
      expect(await askBuilding("1.1.1.1")).toEqual({ kind: "generating", jobId: `job-${start}-abcdef` });
      await finishJob(`job-${start}-abcdef`);
      clock.advance(60_000);
    }
    expect(await askBuilding("1.1.1.1")).toEqual({
      kind: "none",
      reason: "rate-limited",
      retryAfterSeconds: 3600 - 12 * 60,
    });
    // another visitor is unaffected
    expect(await askBuilding("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-13-abcdef" });
  });

  test("the whole site has a daily cap of 20, and a new UTC day resets it", async () => {
    const { askBuilding, finishJob, clock } = service();
    for (let start = 1; start <= 20; start++) {
      // a different visitor each time, so only the site's cap can refuse
      expect(await askBuilding(`10.0.0.${start}`)).toEqual({ kind: "generating", jobId: `job-${start}-abcdef` });
      await finishJob(`job-${start}-abcdef`);
    }
    const limited = await askBuilding("10.0.1.1");
    expect(limited).toMatchObject({ kind: "none", reason: "rate-limited" });
    expect(limited.kind === "none" && limited.retryAfterSeconds).toBe(12 * 3600); // 12:00 to midnight
    clock.advance(12 * 3600_000 + 1000);
    expect(await askBuilding("10.0.1.1")).toEqual({ kind: "generating", jobId: "job-21-abcdef" });
  });

  test("the buildings' count and the creatures' do not touch: 20 buildings leave the creatures' 40 whole", async () => {
    const { askBuilding, askCreature, finishJob } = service({ ...GENERATING_ENV, BUILDING_MAX_STARTS_PER_DAY: "2" });
    await askBuilding("1.1.1.1");
    await finishJob("job-1-abcdef");
    await askBuilding("2.2.2.2");
    await finishJob("job-2-abcdef");
    expect(await askBuilding("3.3.3.3")).toMatchObject({ kind: "none", reason: "rate-limited" });
    // the creatures' ceiling is still 40, and none of it was used
    expect(await askCreature("3.3.3.3")).toEqual({ kind: "generating", jobId: "job-3-abcdef" });
  });

  test("a visitor who hit their hourly limit can still follow a building job that is already running", async () => {
    const { askBuilding, finishJob } = service({ ...GENERATING_ENV, BUILDING_MAX_STARTS_PER_VISITOR_PER_HOUR: "1" });
    await askBuilding("1.1.1.1");
    await finishJob("job-1-abcdef");
    await askBuilding("2.2.2.2"); // job 2 starts
    expect(await askBuilding("1.1.1.1")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
  });
});

describe("one slot for buildings and creatures", () => {
  test("a creature asking while a building job runs does not start a job: it is told to ask again soon", async () => {
    const { askBuilding, askCreature, started } = service();
    await askBuilding("1.1.1.1");
    // the contract has no "busy" for creatures; a short retry delay is what it can say
    expect(await askCreature("2.2.2.2")).toEqual({ kind: "none", reason: "rate-limited", retryAfterSeconds: 15 });
    expect(started).toEqual([{ jobId: "job-1-abcdef", kind: "building" }]);
  });

  test("a building asking while a creature job runs does not start a job: it is told it is busy", async () => {
    const { askBuilding, askCreature, started } = service();
    await askCreature("1.1.1.1");
    expect(await askBuilding("2.2.2.2")).toEqual({ kind: "none", reason: "busy", retryAfterSeconds: 15 });
    expect(started).toEqual([{ jobId: "job-1-abcdef", kind: "creature" }]);
  });

  test("a creature that waited gets the slot before any building: no building starts while its wait is fresh", async () => {
    const { askBuilding, askCreature, finishJob, clock, started } = service();
    await askBuilding("1.1.1.1"); // job 1, a building
    await askCreature("2.2.2.2"); // told to wait; noted
    await finishJob("job-1-abcdef");
    clock.advance(5000);
    // a building asks in the gap, before the creature has asked again
    expect(await askBuilding("1.1.1.1")).toEqual({ kind: "none", reason: "busy", retryAfterSeconds: 15 });
    expect(await askCreature("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
    expect(started.map((start) => start.kind)).toEqual(["building", "creature"]);
  });

  test("a creature that never came back stops holding buildings off after 30 seconds", async () => {
    const { askBuilding, askCreature, finishJob, clock } = service();
    await askBuilding("1.1.1.1");
    await askCreature("2.2.2.2");
    await finishJob("job-1-abcdef");
    clock.advance(31_000);
    expect(await askBuilding("1.1.1.1")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
  });

  test("a creature and a building asking together start exactly one job between them", async () => {
    for (const order of [0, 1]) {
      const { askBuilding, askCreature, started } = service();
      const asks = [() => askBuilding("1.1.1.1"), () => askCreature("2.2.2.2")];
      if (order === 1) asks.reverse();
      await Promise.all(asks.map((ask) => ask()));
      expect(started).toHaveLength(1);
    }
  });

  test("a job of one kind is not read as the other's", async () => {
    const { deps, askBuilding } = service();
    await askBuilding("1.1.1.1");
    expect(await readJob(deps, "job-1-abcdef")).toBeNull();
    expect(await readBuildingJob(deps, "job-1-abcdef")).toMatchObject({ jobId: "job-1-abcdef", step: "queued" });
    const finished = service();
    await finished.askCreature("1.1.1.1");
    expect(await readBuildingJob(finished.deps, "job-1-abcdef")).toBeNull();
    expect(await readJob(finished.deps, "job-1-abcdef")).toMatchObject({ step: "queued" });
  });

  test("a building job reads as it was stored, carries its building when done, and reads as failed when stale", async () => {
    const { deps, store, clock } = service();
    const made = building("0000aaaa-shrine-aaaaaa");
    await store.putJob({
      jobId: "job-1-abcdef",
      kind: "building",
      step: "done",
      building: made,
      updatedAt: clock.now().toISOString(),
    });
    expect(await readBuildingJob(deps, "job-1-abcdef")).toEqual({
      jobId: "job-1-abcdef",
      step: "done",
      building: made,
      updatedAt: clock.now().toISOString(),
    });
    await store.putJob({
      jobId: "job-2-abcdef",
      kind: "building",
      step: "rendering",
      updatedAt: clock.now().toISOString(),
    });
    clock.advance(301_000);
    expect(await readBuildingJob(deps, "job-2-abcdef")).toMatchObject({ step: "failed", error: "timed out" });
  });

  // Whatever order creatures and buildings ask in, and whenever jobs finish or die, there is never a moment with two
  // unfinished jobs: that is one model job and one sandbox run at a time.
  test("over many random evenings, two jobs are never alive at once", async () => {
    let seed = 20261025;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let evening = 0; evening < 60; evening++) {
      const { store, clock, started, askBuilding, askCreature, finishJob } = service({
        ...GENERATING_ENV,
        BUILDING_MAX_STARTS_PER_VISITOR_PER_HOUR: "1000",
        CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR: "1000",
        BUILDING_MAX_STARTS_PER_DAY: "1000",
        CREATURE_MAX_STARTS_PER_DAY: "1000",
      });
      for (let moment = 0; moment < 40; moment++) {
        const visitor = `10.0.0.${Math.floor(random() * 5)}`;
        const roll = random();
        if (roll < 0.35) await askBuilding(visitor);
        else if (roll < 0.7) await askCreature(visitor);
        else if (roll < 0.8) await Promise.all([askBuilding(visitor), askCreature(visitor), askBuilding(visitor)]);
        else if (roll < 0.9) {
          const last = started.at(-1);
          if (last) await finishJob(last.jobId);
        } else clock.advance(Math.floor(random() * 40_000));
        const alive = [];
        for (const job of started) {
          const stored = await store.getJob(job.jobId);
          const stale = stored && clock.now().getTime() - Date.parse(stored.updatedAt) > 300_000;
          if (stored && stored.step !== "done" && stored.step !== "failed" && !stale) alive.push(job.jobId);
        }
        expect(alive.length).toBeLessThanOrEqual(1);
      }
    }
  });
});
