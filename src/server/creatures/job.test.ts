import { describe, expect, test } from "bun:test";
import { creatureSchema, creatureStats, statsOf } from "@/game/creature";
import {
  briefJson,
  CLEAN_STATS,
  fakeClock,
  fakeModel,
  fakeRenderer,
  fenced,
  GOOD_CODE,
  spritePng,
  verdictJson,
} from "../../../pipeline/fakes";
import { anchorYFromBbox, creatureId, isAccepted, type JobDeps, runCreatureJob } from "./job";
import { createMemoryStore } from "./store.memory";

const verdict = (score: number | null, pass: boolean) => ({ pass, score, issues: [], fix: "", lesson: "" });

describe("acceptance", () => {
  test("a verifier pass is accepted", () => {
    expect(isAccepted({ verdict: verdict(7.5, true), stats: CLEAN_STATS })).toBe(true);
  });
  test("a score of 6 or more with no engine flags is accepted without a pass", () => {
    expect(isAccepted({ verdict: verdict(6, false), stats: CLEAN_STATS })).toBe(true);
    expect(isAccepted({ verdict: verdict(6.5, false), stats: CLEAN_STATS })).toBe(true);
  });
  test("a score under 6 is not accepted", () => {
    expect(isAccepted({ verdict: verdict(5.9, false), stats: CLEAN_STATS })).toBe(false);
    expect(isAccepted({ verdict: verdict(null, false), stats: CLEAN_STATS })).toBe(false);
  });
  test("a score of 6 or more with an engine flag is not accepted", () => {
    expect(isAccepted({ verdict: verdict(6.5, false), stats: { ...CLEAN_STATS, flags: "too_small" } })).toBe(false);
  });
});

describe("anchor", () => {
  test("follows the lowest row of the bbox, less the shadow, as a fraction of the frame", () => {
    expect(anchorYFromBbox("42,27,88,105")).toBe(0.8); // the satyr: hand-tuned at 0.8
    expect(anchorYFromBbox("20,41,107,108")).toBe(0.82);
  });
  test("stays within the contract's range and survives a bad bbox", () => {
    expect(anchorYFromBbox("0,0,10,10")).toBe(0.5);
    expect(anchorYFromBbox("0,0,10,127")).toBe(0.97);
    expect(anchorYFromBbox("nonsense")).toBe(0.85);
  });
});

describe("ids", () => {
  test("start with their creation time, so sorting sorts by age, and fit the contract", () => {
    const earlier = creatureId(new Date("2026-10-24T12:00:00Z"), "Brine hound", "abc123");
    const later = creatureId(new Date("2026-10-24T12:00:01Z"), "Zeus's Wrath!", "def456");
    expect(earlier < later).toBe(true);
    expect(later).toMatch(/^[a-z0-9-]{8,80}$/);
    expect(creatureId(new Date(0), "", "abc123")).toMatch(/^[a-z0-9-]{8,80}$/);
  });
});

function jobWith(replies: Array<string | null>, options: { render?: ReturnType<typeof fakeRenderer> } = {}) {
  const store = createMemoryStore();
  const clock = fakeClock();
  const model = fakeModel(replies);
  const renderer = options.render ?? fakeRenderer();
  const steps: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const originalPut = store.putJob;
  store.putJob = async (job) => {
    steps.push(job.step);
    await originalPut(job);
  };
  const deps: JobDeps = {
    store,
    now: clock.now,
    model: model.client,
    render: renderer.render,
    prompts: { creature: "CREATURE PROMPT", generator: "GENERATOR PROMPT", verifier: "VERIFIER PROMPT" },
    entropy: () => "abc123",
    budgetMilliseconds: 5000,
    log: (event) => events.push(event),
  };
  return { deps, store, model, renderer, steps, events };
}

describe("a creature job", () => {
  test("goes through its steps, stores the sprite and the record, and ends done", async () => {
    const { deps, store, steps, renderer } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    const job = await runCreatureJob(deps, "job-one-aaaa");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "done"]);
    expect(job.step).toBe("done");
    expect(renderer.requests).toHaveLength(1);

    const [id] = await store.listCreatureIds();
    expect(id).toBeDefined();
    if (!id) return;
    const creature = await store.getCreature(id);
    expect(creature).toEqual(job.creature ?? null);
    expect(creatureSchema.safeParse(creature).success).toBe(true);
    expect(creature).toMatchObject({
      name: "Brine hound",
      archetype: "skulker",
      modifiers: { speed: 1, toughness: -1, bite: 0, snuffing: 0 },
      score: 8,
      anchorY: 0.8,
    });
    expect(store.sprites.get(id)).toEqual(spritePng());
    expect(store.codes.get(id)).toBe(GOOD_CODE);
    // stats are derived from the archetype and modifiers, never taken from the model
    expect(creature && statsOf(creature)).toEqual(
      creatureStats("skulker", { speed: 1, toughness: -1, bite: 0, snuffing: 0 }),
    );
  });

  test("a fix turn adds the fixing step, and the better attempt is stored", async () => {
    const { deps, store, steps } = jobWith([
      briefJson(),
      fenced(GOOD_CODE),
      verdictJson(4),
      fenced(GOOD_CODE),
      verdictJson(7.5),
    ]);
    const job = await runCreatureJob(deps, "job-two-bbbb");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "fixing", "rendering", "judging", "done"]);
    expect(job.creature?.score).toBe(7.5);
    expect(await store.listCreatureIds()).toHaveLength(1);
  });

  test("a sprite that scores under 6 after the fix fails the job and stores nothing", async () => {
    const { deps, store, steps } = jobWith([
      briefJson(),
      fenced(GOOD_CODE),
      verdictJson(4),
      fenced(GOOD_CODE),
      verdictJson(5),
    ]);
    const job = await runCreatureJob(deps, "job-three-cccc");
    expect(steps.at(-1)).toBe("failed");
    expect(job).toMatchObject({ step: "failed", error: "the sprite was not good enough" });
    expect(job.creature).toBeUndefined();
    expect(await store.listCreatureIds()).toEqual([]);
    expect(store.sprites.size).toBe(0);
  });

  test("a score of 6 with a clean engine report is accepted without a verifier pass", async () => {
    // a 6 is borderline, so each verdict is taken twice; the fix does no better, and the tie goes to the first attempt
    const six = verdictJson(6);
    const { deps, store } = jobWith([briefJson(), fenced(GOOD_CODE), six, six, fenced(GOOD_CODE), six, six]);
    const job = await runCreatureJob(deps, "job-four-dddd");
    expect(job.step).toBe("done");
    expect(await store.listCreatureIds()).toHaveLength(1);
  });

  test("a sprite the engine flags fails without a verifier call, then gets its fix", async () => {
    const flagged = fakeRenderer(() => ({
      ok: true,
      stats: { ...CLEAN_STATS, flags: "clipped_at_edge", edge: 3 },
      png: spritePng(),
    }));
    const { deps, store, model } = jobWith([briefJson(), fenced(GOOD_CODE), fenced(GOOD_CODE)], { render: flagged });
    const job = await runCreatureJob(deps, "job-five-eeee");
    expect(job).toMatchObject({ step: "failed", error: "the sprite was not good enough" });
    expect(model.sent).toHaveLength(3); // brief, generator, fix: the verifier never saw a flagged sprite
    expect(await store.listCreatureIds()).toEqual([]);
  });

  test("an invalid brief fails the job after one more try, with a short fixed reason", async () => {
    const { deps, store, model, renderer } = jobWith(["not json at all", briefJson({ archetype: "dragon" })]);
    const job = await runCreatureJob(deps, "job-six-ffff");
    expect(job).toMatchObject({ step: "failed", error: "no creature was written" });
    expect(model.sent).toHaveLength(2);
    expect(renderer.requests).toEqual([]);
    expect(await store.listCreatureIds()).toEqual([]);
  });

  test("code that fails the tripwire never reaches the renderer", async () => {
    const { deps, renderer } = jobWith([
      briefJson(),
      fenced("function build(k) { process.exit(1) }"),
      fenced("function build(k) { fetch('x') }"),
    ]);
    const job = await runCreatureJob(deps, "job-seven-gggg");
    expect(renderer.requests).toEqual([]);
    expect(job.step).toBe("failed");
  });

  test("a job that runs past its budget fails as timed out and later steps do not overwrite that", async () => {
    let releaseRender: () => void = () => {};
    const slow = fakeRenderer(() => ({ ok: true, stats: CLEAN_STATS, png: spritePng() }));
    const slowRender = slow.render;
    slow.render = async (request) => {
      await new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      return slowRender(request);
    };
    const { deps, store, steps } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)], { render: slow });
    deps.budgetMilliseconds = 30;
    const job = await runCreatureJob(deps, "job-eight-hhhh");
    expect(job).toMatchObject({ step: "failed", error: "timed out" });
    releaseRender();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(steps.at(-1)).toBe("failed");
    expect((await store.getJob("job-eight-hhhh"))?.step).toBe("failed");
    expect(await store.listCreatureIds()).toEqual([]);
  });

  test("a failure never puts model output or a stack trace in the job or the log", async () => {
    const secretText = "SECRET-MODEL-WORDS";
    const { deps, events } = jobWith([briefJson({ lore: secretText, modifiers: { speed: 9 } })]);
    deps.store.putJob = async () => {
      throw new Error(`boom ${secretText}`);
    };
    const job = await runCreatureJob(deps, "job-nine-iiii");
    expect(JSON.stringify(job)).not.toContain(secretText);
    expect(JSON.stringify(events)).not.toContain(secretText);
  });

  test("if writing the final state fails, the job is still marked failed rather than left looking busy", async () => {
    const { deps, store } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    const written: string[] = [];
    store.putJob = async (job) => {
      if (job.step === "done" && written.at(-1) !== "failed") throw new Error("blob hiccup");
      written.push(job.step);
    };
    const job = await runCreatureJob(deps, "job-eleven-kkkk");
    expect(written.at(-1)).toBe("failed");
    expect(job).toMatchObject({ step: "failed", error: "something went wrong" });
  });

  test("no log event carries model text", async () => {
    const { deps, events } = jobWith([briefJson({ lore: "SECRET-LORE-LINE" }), fenced(GOOD_CODE), verdictJson(8)]);
    await runCreatureJob(deps, "job-ten-jjjj");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("SECRET-LORE-LINE");
    expect(JSON.stringify(events)).not.toContain("too plain");
  });
});
