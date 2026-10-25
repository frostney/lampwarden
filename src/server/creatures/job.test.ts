import { describe, expect, test } from "bun:test";

import { creatureSchema, creatureStats, statsOf } from "@/game/creature";

import {
  briefJson,
  CLEAN_STATS,
  fakeClock,
  fakeFrameBatch,
  fakeModel,
  fakeRenderer,
  fenced,
  GOOD_CODE,
  spritePng,
  verdictJson,
} from "../../../pipeline/fakes";
import { decodePng } from "../../../tools/logo/png";
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

function jobWith(
  replies: Parameters<typeof fakeModel>[0],
  options: {
    render?: ReturnType<typeof fakeRenderer>;
    renderBatch?: ReturnType<typeof fakeFrameBatch>;
    candidates?: number;
  } = {},
) {
  const store = createMemoryStore();
  const clock = fakeClock();
  const model = fakeModel(replies);
  const renderer = options.render ?? fakeRenderer();
  const frameBatch = options.renderBatch ?? fakeFrameBatch();
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
    renderBatch: frameBatch.render,
    prompts: { creature: "CREATURE PROMPT", generator: "GENERATOR PROMPT", verifier: "VERIFIER PROMPT" },
    entropy: () => "abc123",
    budgetMilliseconds: 5000,
    candidates: options.candidates ?? 1,
    log: (event) => events.push(event),
  };
  return { deps, store, model, renderer, frameBatch, steps, events };
}

describe("a creature job", () => {
  test("goes through its steps, stores the sprite and the record, and ends done", async () => {
    const { deps, store, steps, renderer } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    const job = await runCreatureJob(deps, "job-one-aaaa");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "rendering", "done"]);
    expect(job.step).toBe("done");
    expect(renderer.requests).toHaveLength(1);

    const [id] = await store.listCreatureIds();
    expect(id).toBeDefined();
    if (!id) {
      return;
    }
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
    expect(steps).toEqual([
      "writing",
      "drawing",
      "rendering",
      "judging",
      "fixing",
      "rendering",
      "judging",
      "rendering",
      "done",
    ]);
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

  test("a model call in flight at the deadline sees the abort, and the job makes no further model call or render", async () => {
    const renderer = fakeRenderer();
    const { deps, model } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)], { render: renderer });
    const sawAbort: boolean[] = [];
    let releaseCall: () => void = () => {};
    let calls = 0;
    const realModel = deps.model;
    // the second call (the generator's) hangs until the test lets go, then goes on to the real client with the job's signal
    deps.model = {
      call: async (task, system, messages, session, logFields, maxTokens, signal) => {
        calls++;
        if (calls === 2) {
          await new Promise<void>((resolve) => {
            releaseCall = resolve;
          });
          sawAbort.push(signal?.aborted ?? false);
        }
        return realModel.call(task, system, messages, session, logFields, maxTokens, signal);
      },
    };
    deps.budgetMilliseconds = 30;
    const job = await runCreatureJob(deps, "job-abort-aaaa");
    expect(job).toMatchObject({ step: "failed", error: "timed out" });
    const sentAtDeadline = model.sent.length;
    releaseCall();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sawAbort).toEqual([true]);
    expect(model.sent).toHaveLength(sentAtDeadline);
    expect(renderer.requests).toEqual([]);
  });

  test("a render in flight at the deadline sees the abort, and no verifier call or frame batch follows it", async () => {
    const renderer = fakeRenderer();
    const sawAbort: boolean[] = [];
    let releaseRender: () => void = () => {};
    const inFlight = renderer.render;
    renderer.render = async (request, signal) => {
      await new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      sawAbort.push(signal?.aborted ?? false);
      return inFlight(request, signal);
    };
    const { deps, model, frameBatch } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)], {
      render: renderer,
    });
    deps.budgetMilliseconds = 30;
    const job = await runCreatureJob(deps, "job-abort-bbbb");
    expect(job).toMatchObject({ step: "failed", error: "timed out" });
    const sentAtDeadline = model.sent.length;
    releaseRender();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sawAbort).toEqual([true]);
    expect(model.sent).toHaveLength(sentAtDeadline);
    expect(frameBatch.batches).toEqual([]);
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
      if (job.step === "done" && written.at(-1) !== "failed") {
        throw new Error("blob hiccup");
      }
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

describe("a job with several candidates", () => {
  const variant = (index: number) => fenced(`// candidate ${index}\n${GOOD_CODE}`);

  /** Answers by content: the brief, the Nth generator call, a verifier call by the candidate it shows, a fix. */
  function scripted(scores: Record<number, number>, fixScore = 0) {
    let generated = 0;
    return (request: { system: string; messages: unknown[] }): string | null => {
      const text = JSON.stringify(request.messages);
      if (request.system.startsWith("CREATURE")) {
        return briefJson();
      }
      if (request.system.startsWith("GENERATOR")) {
        return request.messages.length === 1 ? variant(generated++) : variant(9);
      }
      const candidate = /candidate (\d)/.exec(text)?.[1];
      return verdictJson(candidate === "9" ? fixScore : (scores[Number(candidate)] ?? 0));
    };
  }

  test("draws them side by side, keeps the best, and skips the fix turn when it passes", async () => {
    const { deps, store, steps, model, renderer } = jobWith(scripted({ 0: 4, 1: 8, 2: 5 }), { candidates: 3 });
    const job = await runCreatureJob(deps, "job-cand-aaaa");
    expect(job.step).toBe("done");
    expect(job.creature?.score).toBe(8);
    expect(renderer.requests).toHaveLength(3);
    expect(model.sent).toHaveLength(7); // brief, 3 generators, 3 verifiers
    // each stage is reported once, not once per candidate
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "rendering", "done"]);
    const [id] = await store.listCreatureIds();
    expect(store.codes.get(id ?? "")).toContain("// candidate 1");
  });

  test("a fix turn goes to the best candidate only, and carries that candidate's own code", async () => {
    const { deps, model, steps } = jobWith(scripted({ 0: 3, 1: 5, 2: 4 }, 7.5), { candidates: 3 });
    const job = await runCreatureJob(deps, "job-cand-bbbb");
    expect(job.step).toBe("done");
    expect(job.creature?.score).toBe(7.5);
    expect(model.sent).toHaveLength(9); // brief, 3 generators, 3 verifiers, 1 fix, 1 verifier
    const fixRequest = JSON.stringify(model.sent.find((request) => request.messages.length === 3)?.messages);
    expect(fixRequest).toContain("// candidate 1");
    expect(fixRequest).not.toContain("// candidate 0");
    expect(fixRequest).not.toContain("// candidate 2");
    expect(steps).toEqual([
      "writing",
      "drawing",
      "rendering",
      "judging",
      "fixing",
      "rendering",
      "judging",
      "rendering",
      "done",
    ]);
  });

  test("a best candidate that is accepted without a verifier pass gets no fix turn", async () => {
    const { deps, model, steps } = jobWith(scripted({ 0: 4, 1: 6, 2: 5 }), { candidates: 3 });
    const job = await runCreatureJob(deps, "job-cand-eeee");
    expect(job.creature?.score).toBe(6);
    expect(model.sent).toHaveLength(8); // brief, 3 generators, 3 verifiers, the borderline 6 verified twice: no fix
    expect(steps).not.toContain("fixing");
  });

  test("an engine-flagged candidate gets no verifier call and cannot win", async () => {
    const flaggedFirst = fakeRenderer((request) => ({
      ok: true,
      stats: request.code.includes("candidate 0") ? { ...CLEAN_STATS, flags: "too_small" } : CLEAN_STATS,
      png: spritePng(),
    }));
    const { deps, model, store } = jobWith(scripted({ 0: 9, 1: 8 }), { candidates: 2, render: flaggedFirst });
    const job = await runCreatureJob(deps, "job-cand-cccc");
    expect(job.step).toBe("done");
    expect(model.sent).toHaveLength(4); // brief, 2 generators, 1 verifier
    const [id] = await store.listCreatureIds();
    expect(store.codes.get(id ?? "")).toContain("// candidate 1");
  });

  test("candidates that fail to draw are dropped; the job fails when none is left", async () => {
    const { deps } = jobWith([briefJson(), null, null, null, null], { candidates: 2 });
    const job = await runCreatureJob(deps, "job-cand-dddd");
    expect(job).toMatchObject({ step: "failed", error: "no sprite could be drawn" });
  });
});

describe("a job animates what it accepts", () => {
  const staticCode = `// STATIC\n${GOOD_CODE}`;

  test("renders the accepted code in every pose in one batch and stores the atlas with the record", async () => {
    const { deps, store, frameBatch, steps } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    const job = await runCreatureJob(deps, "job-anim-aaaa");
    expect(job.step).toBe("done");
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "rendering", "done"]);
    // one batch: idle 4, walk 6, attack 5, each named and posed alike, from the code that was judged
    expect(frameBatch.batches).toHaveLength(1);
    const [batch] = frameBatch.batches;
    expect(batch?.map((request) => request.pose)).toEqual([
      "idle1",
      "idle2",
      "idle3",
      "idle4",
      "walk1",
      "walk2",
      "walk3",
      "walk4",
      "walk5",
      "walk6",
      "attack1",
      "attack2",
      "attack3",
      "attack4",
      "attack5",
    ]);
    expect(batch?.every((request) => request.code === GOOD_CODE && request.name === request.pose)).toBe(true);
    const [id] = await store.listCreatureIds();
    const record = await store.getCreature(id ?? "");
    expect(record?.frames).toEqual({ idle: 4, walk: 6, attack: 5 });
    const atlas = store.atlases.get(id ?? "");
    expect(atlas).toBeDefined();
    const picture = decodePng(Buffer.from(atlas ?? new Uint8Array()));
    expect([picture.width, picture.height]).toEqual([768, 384]);
    expect(await store.getAtlas(id ?? "")).not.toBeNull();
  });

  test("refuses a builder that ignores its pose, and animates the next best accepted candidate instead", async () => {
    let generated = 0;
    const model = (request: { system: string; messages: unknown[] }): string | null => {
      if (request.system.startsWith("CREATURE")) {
        return briefJson();
      }
      if (request.system.startsWith("GENERATOR")) {
        return fenced(generated++ === 0 ? `// candidate 0\n${GOOD_CODE}` : `// candidate 1 ${staticCode}`);
      }
      return verdictJson(JSON.stringify(request.messages).includes("candidate 1") ? 8 : 7);
    };
    const { deps, store, frameBatch, events } = jobWith(model, { candidates: 2 });
    const job = await runCreatureJob(deps, "job-anim-bbbb");
    expect(job.step).toBe("done");
    expect(job.creature?.score).toBe(7);
    expect(frameBatch.batches).toHaveLength(2);
    const [id] = await store.listCreatureIds();
    expect(store.codes.get(id ?? "")).toContain("// candidate 0");
    expect(store.atlases.has(id ?? "")).toBe(true);
    expect(events.find((event) => event.event === "creature-job-frames")).toMatchObject({
      animated: true,
      refused: ["static"],
    });
  });

  test("fails, storing nothing, when no accepted candidate can be animated", async () => {
    const { deps, store } = jobWith([briefJson(), fenced(staticCode), verdictJson(8)]);
    const job = await runCreatureJob(deps, "job-anim-cccc");
    expect(job).toMatchObject({ step: "failed", error: "it could not be animated" });
    expect(await store.listCreatureIds()).toEqual([]);
    expect(store.sprites.size).toBe(0);
    expect(store.atlases.size).toBe(0);
  });

  test("fails when a pose does not render, and logs only the kind of refusal", async () => {
    const { deps, events } = jobWith([briefJson(), fenced(`// BROKEN\n${GOOD_CODE}`), verdictJson(8)]);
    const job = await runCreatureJob(deps, "job-anim-dddd");
    expect(job).toMatchObject({ step: "failed", error: "it could not be animated" });
    expect(JSON.stringify(events)).not.toContain("boom");
    expect(events.find((event) => event.event === "creature-job-frames")).toMatchObject({
      animated: false,
      refused: ["render"],
    });
  });
});
