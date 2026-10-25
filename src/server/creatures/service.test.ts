import { describe, expect, test } from "bun:test";

import type { Creature } from "@/game/creature";

import { fakeClock } from "../../../pipeline/fakes";
import { readCreatureConfig } from "./config";
import { clientAddress, visitorKey } from "./limits";
import { nextCreature, readJob, type ServiceDeps } from "./service";
import { createMemoryStore } from "./store.memory";

const SALT = "a-long-enough-test-salt";
const GENERATING_ENV = { MUBIT_API_KEY: "key", VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1", CREATURE_RATE_SALT: SALT };
const PNG = new Uint8Array([137, 80, 78, 71]);

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

function service(env: Record<string, string> = GENERATING_ENV) {
  const store = createMemoryStore();
  const clock = fakeClock();
  const started: string[] = [];
  let counter = 0;
  const deps: ServiceDeps = {
    store,
    now: clock.now,
    config: readCreatureConfig(env),
    newJobId: () => `job-${++counter}-abcdef`,
    startJob: (jobId) => started.push(jobId),
    maxDurationSeconds: 300,
  };
  const ask = (address: string | null, seen: string[] = []) => nextCreature(deps, { seen, ip: address });
  /** What the running job would do on finishing: mark itself done so the slot frees. */
  const finishJob = async (jobId: string) =>
    store.putJob({ jobId, step: "done", updatedAt: clock.now().toISOString() });
  return { deps, store, clock, started, ask, finishJob };
}

describe("next: the gallery", () => {
  test("answers with the newest creature the player has not seen", async () => {
    const { store, ask } = service();
    for (const id of ["0000aaaa-old-aaaaaa", "0000bbbb-middle-bbbbbb", "0000cccc-new-cccccc"]) {
      await store.putCreature(creature(id), PNG, "code");
    }
    expect(await ask("1.1.1.1")).toMatchObject({ kind: "ready", creature: { id: "0000cccc-new-cccccc" } });
    expect(await ask("1.1.1.1", ["0000cccc-new-cccccc"])).toMatchObject({
      kind: "ready",
      creature: { id: "0000bbbb-middle-bbbbbb" },
    });
    expect(await ask("1.1.1.1", ["0000cccc-new-cccccc", "0000bbbb-middle-bbbbbb"])).toMatchObject({
      kind: "ready",
      creature: { id: "0000aaaa-old-aaaaaa" },
    });
  });

  test("serves the gallery without limits and without a job, even with nothing configured", async () => {
    const { store, ask, started } = service({});
    await store.putCreature(creature("0000aaaa-old-aaaaaa"), PNG, "code");
    for (let call = 0; call < 20; call++) {
      expect((await ask("1.1.1.1")).kind).toBe("ready");
    }
    expect(started).toEqual([]);
  });
});

describe("next: starting a job", () => {
  test("starts one when the player has met everything, and answers with its id", async () => {
    const { ask, started, store } = service();
    await store.putCreature(creature("0000aaaa-old-aaaaaa"), PNG, "code");
    const answer = await ask("1.1.1.1", ["0000aaaa-old-aaaaaa"]);
    expect(answer).toEqual({ kind: "generating", jobId: "job-1-abcdef" });
    expect(started).toEqual(["job-1-abcdef"]);
    expect(await store.getJob("job-1-abcdef")).toMatchObject({ step: "queued" });
  });

  test("starts nothing when generation is not configured", async () => {
    for (const env of [
      {},
      { ...GENERATING_ENV, MUBIT_API_KEY: "" },
      { ...GENERATING_ENV, CREATURE_RATE_SALT: "short" },
    ]) {
      const { ask, started } = service(env);
      expect(await ask("1.1.1.1")).toEqual({ kind: "none", reason: "unavailable" });
      expect(started).toEqual([]);
    }
  });

  test("never starts a second job while one runs: everyone shares it", async () => {
    const { ask, started } = service();
    const first = await ask("1.1.1.1");
    const second = await ask("2.2.2.2");
    const third = await ask("1.1.1.1");
    expect(first).toEqual({ kind: "generating", jobId: "job-1-abcdef" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(started).toEqual(["job-1-abcdef"]);
  });

  test("requests that arrive together start exactly one job", async () => {
    const { ask, started } = service();
    const answers = await Promise.all([ask("1.1.1.1"), ask("2.2.2.2"), ask("3.3.3.3"), ask("4.4.4.4")]);
    expect(started).toHaveLength(1);
    const jobIds = new Set(answers.map((answer) => (answer.kind === "generating" ? answer.jobId : answer.kind)));
    expect(jobIds.size).toBe(1);
    expect(jobIds.has(started[0] ?? "")).toBe(true);
  });

  test("a new job can start once the last one has finished", async () => {
    const { ask, started, finishJob } = service();
    await ask("1.1.1.1");
    await finishJob("job-1-abcdef");
    expect(await ask("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
    expect(started).toEqual(["job-1-abcdef", "job-2-abcdef"]);
  });

  test("a job that stopped moving no longer holds the slot", async () => {
    const { ask, started, clock } = service();
    await ask("1.1.1.1");
    clock.advance(301_000);
    expect(await ask("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
    expect(started).toEqual(["job-1-abcdef", "job-2-abcdef"]);
  });
});

describe("rate limits", () => {
  test("a visitor gets 12 starts an hour by default, then waits", async () => {
    const { ask, finishJob, clock } = service();
    for (let start = 1; start <= 12; start++) {
      expect(await ask("1.1.1.1")).toEqual({ kind: "generating", jobId: `job-${start}-abcdef` });
      await finishJob(`job-${start}-abcdef`);
      clock.advance(60_000);
    }
    expect(await ask("1.1.1.1")).toEqual({ kind: "none", reason: "rate-limited", retryAfterSeconds: 3600 - 12 * 60 });
    // another visitor is unaffected
    expect(await ask("2.2.2.2")).toEqual({ kind: "generating", jobId: "job-13-abcdef" });
  });

  test("a visitor's place frees an hour after their oldest start", async () => {
    const { ask, finishJob, clock } = service();
    for (let start = 1; start <= 12; start++) {
      await ask("1.1.1.1");
      await finishJob(`job-${start}-abcdef`);
      clock.advance(60_000);
    }
    clock.advance(3600_000 - 12 * 60_000 + 1000);
    expect(await ask("1.1.1.1")).toEqual({ kind: "generating", jobId: "job-13-abcdef" });
  });

  test("a rate-limited visitor can still follow a job that is already running", async () => {
    const { ask, finishJob } = service({ ...GENERATING_ENV, CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR: "1" });
    await ask("1.1.1.1");
    await finishJob("job-1-abcdef");
    await ask("2.2.2.2"); // job 2 starts
    expect(await ask("1.1.1.1")).toEqual({ kind: "generating", jobId: "job-2-abcdef" });
  });

  test("the whole site has a daily ceiling, and a new UTC day resets it", async () => {
    const { ask, finishJob, clock } = service({ ...GENERATING_ENV, CREATURE_MAX_STARTS_PER_DAY: "2" });
    await ask("1.1.1.1");
    await finishJob("job-1-abcdef");
    await ask("2.2.2.2");
    await finishJob("job-2-abcdef");
    const limited = await ask("3.3.3.3");
    expect(limited).toMatchObject({ kind: "none", reason: "rate-limited" });
    expect(limited.kind === "none" && limited.retryAfterSeconds).toBe(12 * 3600); // 12:00 to midnight
    clock.advance(12 * 3600_000 + 1000);
    expect(await ask("3.3.3.3")).toEqual({ kind: "generating", jobId: "job-3-abcdef" });
  });

  test("limits can be set from the environment, and a malformed value falls back to the default", () => {
    expect(readCreatureConfig({ ...GENERATING_ENV, CREATURE_MAX_STARTS_PER_DAY: "7" }).limits.perDay).toBe(7);
    expect(readCreatureConfig({ ...GENERATING_ENV, CREATURE_MAX_STARTS_PER_DAY: "lots" }).limits.perDay).toBe(40);
    expect(readCreatureConfig(GENERATING_ENV).limits).toEqual({ perVisitorPerHour: 12, perDay: 40 });
    expect(readCreatureConfig(GENERATING_ENV).candidates).toBe(3);
    expect(readCreatureConfig({ ...GENERATING_ENV, CREATURE_CANDIDATES: "1" }).candidates).toBe(1);
    expect(readCreatureConfig({ ...GENERATING_ENV, CREATURE_CANDIDATES: "50" }).candidates).toBe(5);
    expect(readCreatureConfig({ ...GENERATING_ENV, CREATURE_CANDIDATES: "many" }).candidates).toBe(3);
  });

  test("visitors are keyed by a salted hash; the address is never in the key", () => {
    const key = visitorKey("203.0.113.9", SALT);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(visitorKey("203.0.113.9", SALT)).toBe(key);
    expect(visitorKey("203.0.113.9", "another-long-enough-salt")).not.toBe(key);
    expect(visitorKey("203.0.113.10", SALT)).not.toBe(key);
  });

  test("the client address is the first x-forwarded-for entry", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe("jobs", () => {
  test("a job reads as it was stored while it is moving", async () => {
    const { deps, store, clock } = service();
    await store.putJob({ jobId: "job-1-abcdef", step: "rendering", updatedAt: clock.now().toISOString() });
    clock.advance(299_000);
    expect(await readJob(deps, "job-1-abcdef")).toMatchObject({ step: "rendering" });
  });

  test("a job whose status has not moved for longer than maxDuration reads as failed", async () => {
    const { deps, store, clock } = service();
    await store.putJob({ jobId: "job-1-abcdef", step: "rendering", updatedAt: clock.now().toISOString() });
    clock.advance(301_000);
    expect(await readJob(deps, "job-1-abcdef")).toMatchObject({ step: "failed", error: "timed out" });
  });

  test("a finished job never reads as stale", async () => {
    const { deps, store, clock } = service();
    await store.putJob({
      jobId: "job-1-abcdef",
      step: "done",
      creature: creature("0000aaaa-old-aaaaaa"),
      updatedAt: clock.now().toISOString(),
    });
    clock.advance(86_400_000);
    expect(await readJob(deps, "job-1-abcdef")).toMatchObject({ step: "done" });
  });

  test("an unknown job is null", async () => {
    expect(await readJob(service().deps, "job-9-abcdef")).toBeNull();
  });
});

describe("storage failures", () => {
  test("next answers unavailable instead of throwing", async () => {
    const { deps, ask } = service();
    deps.store.listCreatureIds = async () => {
      throw new Error("blob is down");
    };
    const original = console.error;
    console.error = () => {};
    try {
      expect(await ask("1.1.1.1")).toEqual({ kind: "none", reason: "unavailable" });
    } finally {
      console.error = original;
    }
  });
});
