// A player's evening, end to end but for the network: the game's side of asking (src/game/sea.ts) against the real
// service on the in-memory store, with a job that finishes when the test says so. The game asks as each night begins
// (for the NEXT night's creature) and as it ends, exactly as Game.tsx does.
import { describe, expect, test } from "bun:test";
import type { Creature } from "@/game/creature";
import { createSea } from "@/game/sea";
import { fakeClock } from "../../../pipeline/fakes";
import { readCreatureConfig } from "./config";
import { nextCreature, type ServiceDeps } from "./service";
import { createMemoryStore } from "./store.memory";

const PNG = new Uint8Array([137, 80, 78, 71]);
const ENV = {
  MUBIT_API_KEY: "key",
  VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1",
  CREATURE_RATE_SALT: "a-long-enough-test-salt",
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const creature = (id: string, createdAt: string): Creature => ({
  id,
  name: `Creature ${id}`,
  lore: "A line of lore for the test.",
  brief: "a creature of the deep sea",
  archetype: "brute",
  modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 7,
  createdAt,
});

function evening() {
  const store = createMemoryStore();
  const clock = fakeClock();
  const started: string[] = [];
  const waiting = new Map<string, (finished: Creature | null) => void>();
  let counter = 0;
  const deps: ServiceDeps = {
    store,
    now: clock.now,
    config: readCreatureConfig(ENV),
    newJobId: () => `job-${++counter}-abcdef`,
    startJob: (jobId) => started.push(jobId),
    maxDurationSeconds: 300,
  };
  const sea = createSea({
    askForCreature: (seen) => nextCreature(deps, { seen, ip: "1.1.1.1" }),
    waitForJob: (jobId) => new Promise((resolve) => waiting.set(jobId, resolve)),
  });

  /** The running job comes out with a creature: in the gallery, then told to whoever follows it. */
  async function finishJob(jobId: string) {
    const number = Number(jobId.split("-")[1]);
    const made = creature(`0000${String(number).padStart(4, "0")}-made-${number}`, clock.now().toISOString());
    await store.putCreature(made, PNG, "code");
    await store.putJob({ jobId, step: "done", creature: made, updatedAt: clock.now().toISOString() });
    waiting.get(jobId)?.(made);
    await settle();
  }

  // the line's bestiary and the two moments Game.tsx asks
  const met: string[] = [];
  const startNight = async () => {
    const tonight = sea.get();
    const joining = tonight.kind === "ready" ? tonight.creature : null;
    if (joining) met.push(joining.id);
    sea.ask(met); // the next night's creature, while this one is played
    await settle();
    return joining?.id ?? null;
  };
  const endNight = async () => {
    sea.ask(met);
    await settle();
  };
  const title = async () => {
    sea.ask(met);
    await settle();
  };
  return { store, started, finishJob, startNight, endNight, title };
}

describe("a run of nights", () => {
  test("each night after the first meets a creature the line has not met, made while the night before was played", async () => {
    const world = evening();
    await world.title();
    const nights: Array<string | null> = [];
    for (let night = 1; night <= 6; night++) {
      nights.push(await world.startNight());
      // the job asked for as this night began runs through the night and is finished by dawn
      await world.finishJob(world.started.at(-1) ?? "");
      await world.endNight();
    }
    expect(nights[0]).toBeNull(); // nothing was ready when the first night began
    const creatures = nights.slice(1);
    expect(creatures.every((id) => id !== null)).toBe(true);
    expect(new Set(creatures).size).toBe(creatures.length);
    expect(world.started).toHaveLength(6); // one job a night, never two at once
  });

  test("a job still running when the night begins is not dropped: it finishes during the night and comes the night after", async () => {
    const world = evening();
    await world.title();
    expect(await world.startNight()).toBeNull(); // job-1 is still being made
    await world.endNight();
    expect(await world.startNight()).toBeNull(); // still the same job, not a second one
    expect(world.started).toEqual(["job-1-abcdef"]);
    await world.finishJob("job-1-abcdef");
    await world.endNight();
    expect(await world.startNight()).toBe("00000001-made-1");
    expect(world.started).toEqual(["job-1-abcdef", "job-2-abcdef"]);
  });

  test("creatures other players made are met first, a night each, before a job is started", async () => {
    const world = evening();
    for (const number of [1, 2, 3]) {
      await world.store.putCreature(
        creature(`0000${String(number).padStart(4, "0")}-gallery-${number}`, "2026-10-24T12:00:00.000Z"),
        PNG,
        "code",
      );
    }
    await world.title();
    const nights = [await world.startNight(), await world.startNight()];
    expect(world.started).toEqual([]);
    nights.push(await world.startNight()); // the last of the gallery is met: only now is there something to make
    expect(nights).toEqual(["00000003-gallery-3", "00000002-gallery-2", "00000001-gallery-1"]);
    expect(world.started).toEqual(["job-1-abcdef"]);
  });

  test("12 jobs an hour carry a long evening, then nothing new is asked for until the hour is up", async () => {
    const world = evening();
    await world.title();
    const nights: Array<string | null> = [];
    for (let night = 1; night <= 14; night++) {
      nights.push(await world.startNight());
      if (world.started.length <= 12) await world.finishJob(world.started.at(-1) ?? "");
      await world.endNight();
    }
    expect(nights.slice(1, 13).every((id) => id !== null)).toBe(true);
    expect(new Set(nights.slice(1, 13)).size).toBe(12);
    expect(world.started).toHaveLength(12);
    expect(nights[13]).toBeNull(); // the 13th start is rate limited
  });
});
