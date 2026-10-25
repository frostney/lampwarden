import { describe, expect, test } from "bun:test";

import { buildingSchema } from "@/game/building";
import { measureSprite } from "@/scene/extent";

import {
  BUILDING_STATS,
  buildingBriefJson,
  buildingPng,
  fakeClock,
  fakeModel,
  fakeRenderer,
  fenced,
  GOOD_CODE,
  spritePng,
  verdictJson,
} from "../../../pipeline/fakes";
import { decodePng } from "../../../tools/logo/png";
import { createMemoryStore } from "../creatures/store.memory";
import { type BuildingJobDeps, buildingId, runBuildingJob } from "./job";

const BUILDING_CODE = "function build(k) {\n  temple(k, { cols: 2, depth: 10 });\n}";

const renderedBuilding = () => fakeRenderer(() => ({ ok: true, stats: BUILDING_STATS, png: buildingPng() }));

function jobWith(
  replies: Parameters<typeof fakeModel>[0],
  options: { render?: ReturnType<typeof fakeRenderer>; candidates?: number } = {},
) {
  const store = createMemoryStore();
  const clock = fakeClock();
  const model = fakeModel(replies);
  const renderer = options.render ?? renderedBuilding();
  const steps: string[] = [];
  const events: Record<string, unknown>[] = [];
  const originalPut = store.putJob;
  store.putJob = async (job) => {
    steps.push(job.step);
    await originalPut(job);
  };
  const deps: BuildingJobDeps = {
    store,
    now: clock.now,
    model: model.client,
    render: renderer.render,
    prompts: { building: "BUILDING PROMPT", generator: "GENERATOR PROMPT", verifier: "VERIFIER PROMPT" },
    entropy: () => "abc123",
    budgetMilliseconds: 5000,
    candidates: options.candidates ?? 1,
    log: (event) => events.push(event),
  };
  return { deps, store, model, renderer, steps, events };
}

describe("ids", () => {
  test("start with their creation time, so sorting sorts by age, and fit the contract", () => {
    const earlier = buildingId(new Date("2026-10-25T12:00:00Z"), "Granary", "abc123");
    const later = buildingId(new Date("2026-10-25T12:00:01Z"), "Zeus's Stoa!", "def456");
    expect(earlier < later).toBe(true);
    expect(later).toMatch(/^[a-z0-9-]{8,80}$/);
    expect(buildingId(new Date(0), "", "abc123")).toMatch(/^[a-z0-9-]{8,80}$/);
  });
});

describe("a building job", () => {
  test("goes through its steps, measures the sprite, stores it with everything the placer needs, and ends done", async () => {
    const { deps, store, steps, renderer } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)]);
    const job = await runBuildingJob(deps, "job-one-aaaa");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "done"]);
    expect(job.step).toBe("done");
    expect(renderer.requests).toHaveLength(1);
    expect(renderer.requests[0]?.pose).toBe(""); // a still: a building has no animation

    const [id] = await store.listBuildingIds();
    expect(id).toBeDefined();
    if (!id) {
      return;
    }
    const building = await store.getBuilding(id);
    expect(building).toEqual(job.building ?? null);
    expect(buildingSchema.safeParse(building).success).toBe(true);
    expect(building).toMatchObject({
      name: "Stoa of the net-menders",
      score: 8,
      bbox: [34, 70, 93, 109],
      anchorY: 0.83, // the lowest row of the bbox (109), one more, less the shadow's 4 rows, over 128
    });
    // the base extent is measured from the picture the same way the committed sprites' are (src/scene/extent.ts)
    expect(building?.extent).toEqual(measureSprite(decodePng(Buffer.from(buildingPng())).data, 0.83));
    expect(building?.extent.hull.length).toBeGreaterThanOrEqual(3);
    expect(store.buildingSprites.get(id)).toEqual(buildingPng());
    expect(store.buildingCodes.get(id)).toBe(BUILDING_CODE);
    // it is in the buildings' gallery, not the creatures'
    expect(await store.listCreatureIds()).toEqual([]);
  });

  test("marks its job as a building's, which a creature's job never is", async () => {
    const { deps, store } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)]);
    await runBuildingJob(deps, "job-two-bbbb");
    expect((await store.getJob("job-two-bbbb"))?.kind).toBe("building");
  });

  test("asks the model under a task of its own, with a prompt of its own, and tags the sprite as a building", async () => {
    const { deps, model, events } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)]);
    await runBuildingJob(deps, "job-three-cccc");
    const systems = model.sent.map((request) => JSON.stringify(request.system));
    expect(systems[0]).toContain("BUILDING PROMPT");
    expect(systems[1]).toContain("GENERATOR PROMPT");
    expect(systems[2]).toContain("VERIFIER PROMPT");
    const tasks = events.filter((event) => event.event === "mubit-call").map((event) => event.task);
    expect(tasks).toEqual(["building-brief", "gen", "verify"]);
  });

  test("a fix turn adds the fixing step, and the better attempt is stored", async () => {
    const { deps, store, steps } = jobWith([
      buildingBriefJson(),
      fenced(BUILDING_CODE),
      verdictJson(4),
      fenced(BUILDING_CODE),
      verdictJson(7.5),
    ]);
    const job = await runBuildingJob(deps, "job-four-dddd");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "fixing", "rendering", "judging", "done"]);
    expect(job.building?.score).toBe(7.5);
    expect(await store.listBuildingIds()).toHaveLength(1);
  });

  test("a score of 6 with a clean engine report is accepted without a verifier pass, as for creatures", async () => {
    const six = verdictJson(6);
    const { deps, store } = jobWith([
      buildingBriefJson(),
      fenced(BUILDING_CODE),
      six,
      six,
      fenced(BUILDING_CODE),
      six,
      six,
    ]);
    const job = await runBuildingJob(deps, "job-five-eeee");
    expect(job.step).toBe("done");
    expect(await store.listBuildingIds()).toHaveLength(1);
  });

  test("a sprite that scores under 6 after the fix fails the job and stores nothing", async () => {
    const { deps, store } = jobWith([
      buildingBriefJson(),
      fenced(BUILDING_CODE),
      verdictJson(4),
      fenced(BUILDING_CODE),
      verdictJson(5),
    ]);
    const job = await runBuildingJob(deps, "job-six-ffff");
    expect(job).toMatchObject({ step: "failed", error: "the sprite was not good enough" });
    expect(job.building).toBeUndefined();
    expect(await store.listBuildingIds()).toEqual([]);
    expect(store.buildingSprites.size).toBe(0);
  });

  test("a sprite the engine flags fails without a verifier call", async () => {
    const flagged = fakeRenderer(() => ({
      ok: true,
      stats: { ...BUILDING_STATS, flags: "clipped_at_edge", edge: 3 },
      png: buildingPng(),
    }));
    const { deps, store, model } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), fenced(BUILDING_CODE)], {
      render: flagged,
    });
    const job = await runBuildingJob(deps, "job-seven-gggg");
    expect(job).toMatchObject({ step: "failed", error: "the sprite was not good enough" });
    expect(model.sent).toHaveLength(3); // brief, generator, fix: the verifier never saw a flagged sprite
    expect(await store.listBuildingIds()).toEqual([]);
  });

  test("an accepted sprite whose size cannot be measured fails the job and stores nothing", async () => {
    // an 8 px picture is not a sprite frame, and a bbox that is not four numbers is not a render's
    for (const render of [
      fakeRenderer(() => ({ ok: true, stats: BUILDING_STATS, png: spritePng() })),
      fakeRenderer(() => ({ ok: true, stats: { ...BUILDING_STATS, bbox: "none" }, png: buildingPng() })),
    ]) {
      const { deps, store } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)], { render });
      const job = await runBuildingJob(deps, "job-eight-hhhh");
      expect(job).toMatchObject({ step: "failed", error: "its size could not be measured" });
      expect(await store.listBuildingIds()).toEqual([]);
    }
  });

  test("an invalid brief fails the job after one more try, with a short fixed reason", async () => {
    const { deps, store, model, renderer } = jobWith(["not json at all", buildingBriefJson({ name: "x" })]);
    const job = await runBuildingJob(deps, "job-nine-iiii");
    expect(job).toMatchObject({ step: "failed", error: "no building was written" });
    expect(model.sent).toHaveLength(2);
    expect(renderer.requests).toEqual([]);
    expect(await store.listBuildingIds()).toEqual([]);
  });

  test("code that fails the tripwire never reaches the renderer", async () => {
    const { deps, renderer } = jobWith([
      buildingBriefJson(),
      fenced("function build(k) { process.exit(1) }"),
      fenced("function build(k) { fetch('x') }"),
    ]);
    const job = await runBuildingJob(deps, "job-ten-jjjj");
    expect(renderer.requests).toEqual([]);
    expect(job.step).toBe("failed");
  });

  test("a job that runs past its budget fails as timed out, and a late render does not put a building in the gallery", async () => {
    let releaseRender: () => void = () => {};
    const slow = renderedBuilding();
    const slowRender = slow.render;
    slow.render = async (request) => {
      await new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      return slowRender(request);
    };
    const { deps, store, steps } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)], {
      render: slow,
    });
    deps.budgetMilliseconds = 30;
    const job = await runBuildingJob(deps, "job-eleven-kkkk");
    expect(job).toMatchObject({ step: "failed", error: "timed out" });
    releaseRender();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(steps.at(-1)).toBe("failed");
    expect(await store.listBuildingIds()).toEqual([]);
  });

  test("a job that runs past its budget while its building is being stored stays failed: a late done does not undo it", async () => {
    const { deps, store } = jobWith([buildingBriefJson(), fenced(BUILDING_CODE), verdictJson(8)]);
    deps.budgetMilliseconds = 60;
    const put = store.putBuilding;
    store.putBuilding = async (...stored) => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // the deadline passes while the blob is written
      await put(...stored);
    };
    const job = await runBuildingJob(deps, "job-late-done-aaaa");
    expect(job).toMatchObject({ step: "failed", error: "timed out" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await store.getJob("job-late-done-aaaa"))?.step).toBe("failed");
  });

  test("a failure never puts model output or a stack trace in the job or the log", async () => {
    const secretText = "SECRET-MODEL-WORDS";
    const { deps, events } = jobWith([buildingBriefJson({ name: secretText })]);
    deps.store.putJob = async () => {
      throw new Error(`boom ${secretText}`);
    };
    const job = await runBuildingJob(deps, "job-twelve-llll");
    expect(JSON.stringify(job)).not.toContain(secretText);
    expect(JSON.stringify(events)).not.toContain(secretText);
  });

  test("no log event carries model text", async () => {
    const { deps, events } = jobWith([
      buildingBriefJson({ name: "SECRET-BUILDING-NAME" }),
      fenced(BUILDING_CODE),
      verdictJson(8),
    ]);
    await runBuildingJob(deps, "job-thirteen-mmmm");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("SECRET-BUILDING-NAME");
    expect(JSON.stringify(events)).not.toContain("too plain");
  });

  test("avoids the names of the newest buildings in the gallery", async () => {
    const { deps, store, model } = jobWith([buildingBriefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    await store.putBuilding(
      buildingSchema.parse({
        id: "0000aaaa-granary-abc123",
        name: "Granary of Lychnos",
        brief: "windowless limestone granary with a tiled roof",
        anchorY: 0.8,
        bbox: [30, 20, 90, 106],
        extent: measureSprite(decodePng(Buffer.from(buildingPng())).data, 0.8),
        score: 7,
        createdAt: "2026-10-25T08:00:00.000Z",
      }),
      buildingPng(),
      GOOD_CODE,
    );
    await runBuildingJob(deps, "job-fourteen-nnnn");
    expect(JSON.stringify(model.sent[0]?.messages)).toContain("Granary of Lychnos");
  });
});
