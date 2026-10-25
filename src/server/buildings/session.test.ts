// A player's evening with both a creature and a building to be made, against the real service on the in-memory store and a
// virtual clock: the nights are as long as the sim makes them (28 s and rising), a creature job takes about 50 s and a
// building job about 40 s (the live runs, docs/LIVE_GENERATION.md), and the game asks the way Game.tsx does: for the creature,
// then for the building once the creature's question has settled, as each night begins and as it ends.
import { describe, expect, test } from "bun:test";
import { type Building, buildingSchema } from "@/game/building";
import { createBuildingSea } from "@/game/building-sea";
import type { Creature } from "@/game/creature";
import { createSea } from "@/game/sea";
import { nightLength } from "@/game/sim";
import { readCreatureConfig } from "../creatures/config";
import { nextBuilding, nextCreature, type ServiceDeps } from "../creatures/service";
import { createMemoryStore } from "../creatures/store.memory";

const PNG = new Uint8Array([137, 80, 78, 71]);
const ENV = {
  MUBIT_API_KEY: "key",
  VERCEL_SANDBOX_SNAPSHOT_ID: "snap_1",
  CREATURE_RATE_SALT: "a-long-enough-test-salt",
};
const CREATURE_JOB_SECONDS = 50;
const BUILDING_JOB_SECONDS = 40;
const DAWN_SECONDS = 25; // the dawn panel: the report, the shop, the choice of heir
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const creature = (number: number, createdAt: string): Creature => ({
  id: `0000${String(number).padStart(4, "0")}-made-${number}`,
  name: `Creature ${number}`,
  lore: "A line of lore for the test.",
  brief: "a creature of the deep sea",
  archetype: "brute",
  modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 7,
  createdAt,
});

const building = (number: number, createdAt: string): Building =>
  buildingSchema.parse({
    id: `0000${String(number).padStart(4, "0")}-built-${number}`,
    name: `Building ${number}`,
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
    createdAt,
  });

/** Virtual time: `sleep` waits for `advance` to reach it, timers firing in order with the promises they release settled. */
function virtualClock() {
  let now = 0;
  const timers: Array<{ at: number; run: () => void }> = [];
  return {
    seconds: () => now,
    after: (seconds: number, run: () => void) => timers.push({ at: now + seconds, run }),
    sleep: (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timers.push({ at: now + milliseconds / 1000, run: resolve });
      }),
    async advance(seconds: number) {
      const end = now + seconds;
      for (;;) {
        timers.sort((first, second) => first.at - second.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.run();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

function evening(withBuildings = true) {
  const store = createMemoryStore();
  const clock = virtualClock();
  const date = () => new Date(Date.parse("2026-10-25T12:00:00.000Z") + clock.seconds() * 1000);
  const started: Array<{ kind: string; at: number; ends: number }> = [];
  const creatureWaits = new Map<string, (made: Creature | null) => void>();
  const buildingWaits = new Map<string, (made: Building | null) => void>();
  let counter = 0;
  let mostAlive = 0;
  const alive = new Set<string>();
  const deps: ServiceDeps = {
    store,
    now: date,
    config: readCreatureConfig(ENV),
    newJobId: () => `job-${++counter}-abcdef`,
    maxDurationSeconds: 300,
    startJob: (jobId, kind) => {
      const duration = kind === "creature" ? CREATURE_JOB_SECONDS : BUILDING_JOB_SECONDS;
      started.push({ kind, at: clock.seconds(), ends: clock.seconds() + duration });
      alive.add(jobId);
      mostAlive = Math.max(mostAlive, alive.size);
      clock.after(duration, () => {
        void (async () => {
          const stamp = date().toISOString();
          if (kind === "creature") {
            const made = creature(counter * 10 + started.length, stamp);
            await store.putCreature(made, PNG, "code");
            await store.putJob({ jobId, step: "done", creature: made, updatedAt: stamp });
            creatureWaits.get(jobId)?.(made);
          } else {
            const made = building(counter * 10 + started.length, stamp);
            await store.putBuilding(made, PNG, "code");
            await store.putJob({ jobId, kind: "building", step: "done", building: made, updatedAt: stamp });
            buildingWaits.get(jobId)?.(made);
          }
          alive.delete(jobId);
        })();
      });
    },
  };
  const creatures = createSea({
    askForCreature: (seen) => nextCreature(deps, { seen, ip: "1.1.1.1" }),
    waitForJob: (jobId) => new Promise((resolve) => creatureWaits.set(jobId, resolve)),
    sleep: clock.sleep,
  });
  const buildings = createBuildingSea({
    askForBuilding: async (seen) => nextBuilding(deps, { seen, ip: "1.1.1.1" }),
    waitForBuildingJob: (jobId) => new Promise((resolve) => buildingWaits.set(jobId, resolve)),
    sleep: clock.sleep,
  });

  const met: string[] = [];
  const raised: string[] = [];
  // Game.tsx's askSea: the creature, then the building once the creature's question has settled
  const askSea = () => {
    creatures.ask(met);
    if (withBuildings) buildings.ask(raised, creatures.settled());
  };
  askSea(); // the title, before night 1

  /** One night as the player has it: what joined it, then the night, then the dawn panel (asking as each ends). */
  async function night(number: number) {
    await settle();
    const tonightCreature = creatures.get();
    const tonightBuilding = buildings.get();
    const joined = {
      night: number,
      second: Math.round(clock.seconds()),
      creature: tonightCreature.kind === "ready" ? tonightCreature.creature.id : null,
      building: tonightBuilding.kind === "ready" ? tonightBuilding.building.id : null,
      creatureStep: tonightCreature.kind === "generating" ? tonightCreature.step : null,
    };
    if (joined.creature) met.push(joined.creature);
    if (joined.building) raised.push(joined.building.toString());
    askSea(); // the next night's, while this one is played
    await clock.advance(nightLength(number));
    askSea(); // dawn
    await clock.advance(DAWN_SECONDS);
    return joined;
  }
  return { night, started, mostAlive: () => mostAlive, clock };
}

describe("an evening of short nights with a creature and a building to make", () => {
  test("never runs two jobs at once, whatever order they are asked in", async () => {
    const world = evening();
    for (let number = 1; number <= 14; number++) await world.night(number);
    expect(world.mostAlive()).toBe(1);
    // the jobs run one after another: each starts when the one before has ended
    for (const [index, job] of world.started.entries()) {
      const before = world.started[index - 1];
      if (before) expect(job.at).toBeGreaterThanOrEqual(before.ends);
    }
  });

  test("the creature goes first and the building follows it, on the nights a one-minute job does not outlast", async () => {
    const world = evening();
    const nights = [];
    for (let number = 1; number <= 14; number++) nights.push(await world.night(number));
    // nothing is ready for the first night: a night begins at 0 s, 28 + 25 s, ... and the first job takes 50 s
    expect(nights.slice(0, 1).every((joined) => joined.creature === null && joined.building === null)).toBe(true);
    expect(world.started[0]?.kind).toBe("creature");
    expect(world.started[1]?.kind).toBe("building");
    // a night without its creature still began with the question for it open (the job carries on through the night)
    expect(nights[0]?.creatureStep).not.toBeNull();
    // every creature and building that joined a night was a different one
    const joinedCreatures = nights.flatMap((joined) => (joined.creature ? [joined.creature] : []));
    const joinedBuildings = nights.flatMap((joined) => (joined.building ? [joined.building] : []));
    expect(new Set(joinedCreatures).size).toBe(joinedCreatures.length);
    expect(new Set(joinedBuildings).size).toBe(joinedBuildings.length);
    // both kinds keep coming: neither is starved by the other
    expect(joinedCreatures.length).toBeGreaterThanOrEqual(3);
    expect(joinedBuildings.length).toBeGreaterThanOrEqual(3);
  });

  test("what the buildings cost the creatures when nobody else has made any: the empty gallery, one visitor, the worst case", async () => {
    const counts = [];
    for (const withBuildings of [false, true]) {
      const world = evening(withBuildings);
      const nights = [];
      for (let number = 1; number <= 14; number++) nights.push(await world.night(number));
      counts.push({
        withBuildings,
        creatures: nights.filter((joined) => joined.creature !== null).length,
        buildings: nights.filter((joined) => joined.building !== null).length,
      });
    }
    const [without, withBuildings] = counts;
    // the buildings take the slot between a creature's jobs, never ahead of one: the creatures come as often with them as without
    expect(withBuildings?.creatures).toBeGreaterThanOrEqual(without?.creatures ?? 0);
    expect(withBuildings?.buildings).toBeGreaterThanOrEqual(3);
    expect(without?.buildings).toBe(0);
  });
});
