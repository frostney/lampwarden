import { describe, expect, test } from "bun:test";
import { creatureSchema, creatureStats, statsOf } from "@/game/creature";
import { sha256Hex } from "@/game/creature-build";
import { generateSigningKeys, signBuild, verifyBuild } from "@/game/creature-signing";
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
import { renderInQuickJsWorker } from "../../../pipeline/render-quickjs";
import { PixelImage } from "../../../tools/logo/image";
import { decodePng, encodePng } from "../../../tools/logo/png";
import { anchorYFromBbox, buildHashes, creatureId, isAccepted, type JobDeps, runCreatureJob } from "./job";
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
  options: { render?: ReturnType<typeof fakeRenderer>; candidates?: number } = {},
) {
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
    rendererName: "quickjs",
    prompts: { creature: "CREATURE PROMPT", generator: "GENERATOR PROMPT", verifier: "VERIFIER PROMPT" },
    entropy: () => "abc123",
    budgetMilliseconds: 5000,
    candidates: options.candidates ?? 1,
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
    expect(store.codes.get(id)).toBe(GOOD_CODE);
    expect(store.sprites.size).toBe(0); // the PNG is judged and dropped: the browser draws the creature from its code
    // the record pins the code as stored and the pixels the verifier judged
    expect(creature?.build).toEqual({
      codeSha256: await sha256Hex(GOOD_CODE),
      pixelsSha256: await sha256Hex(decodePng(Buffer.from(spritePng())).data),
    });
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

describe("a job with several candidates", () => {
  const variant = (index: number) => fenced(`// candidate ${index}\n${GOOD_CODE}`);

  /** Answers by content: the brief, the Nth generator call, a verifier call by the candidate it shows, a fix. */
  function scripted(scores: Record<number, number>, fixScore = 0) {
    let generated = 0;
    return (request: { system: string; messages: unknown[] }): string | null => {
      const text = JSON.stringify(request.messages);
      if (request.system.startsWith("CREATURE")) return briefJson();
      if (request.system.startsWith("GENERATOR"))
        return request.messages.length === 1 ? variant(generated++) : variant(9);
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
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "done"]);
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
    expect(steps).toEqual(["writing", "drawing", "rendering", "judging", "fixing", "rendering", "judging", "done"]);
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

describe("the hashes of a creature", () => {
  test("are of the code as text and of the decoded pixels, not of the PNG's bytes", async () => {
    const hashes = await buildHashes("function build(k) {}", spritePng());
    expect(hashes.codeSha256).toBe(await sha256Hex("function build(k) {}"));
    expect(hashes.pixelsSha256).toBe(await sha256Hex(decodePng(Buffer.from(spritePng())).data));
    expect(hashes.pixelsSha256).not.toBe(await sha256Hex(spritePng()));
  });
});

describe("a job that renders with QuickJS, as the deployed route does", () => {
  test("judges a real render, and the stored code draws exactly the pixels the record names", async () => {
    const { deps, store } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    deps.render = renderInQuickJsWorker;
    const job = await runCreatureJob(deps, "job-quickjs-aaaa");
    expect(job.step).toBe("done");
    const [id] = await store.listCreatureIds();
    const creature = await store.getCreature(id ?? "");
    const code = await store.getCode(id ?? "");
    expect(code).toBe(GOOD_CODE);
    // what a browser does: run the stored code again, anywhere, and the pixels are the judged ones
    const again = await renderInQuickJsWorker({ code: code ?? "", name: "again", pose: "" });
    if (!again.ok) throw new Error(again.error);
    expect(await sha256Hex(decodePng(Buffer.from(again.png)).data)).toBe(creature?.build?.pixelsSha256 ?? "");
    expect(await sha256Hex(code ?? "")).toBe(creature?.build?.codeSha256 ?? "");
  });
});

describe("a job whose judge renderer is not the one the browser uses", () => {
  const otherPng = () => {
    const sprite = new PixelImage(8, 8);
    sprite.set(1, 1, [1, 2, 3, 255]);
    return encodePng(sprite);
  };

  test("is stored when QuickJS draws the very pixels that were judged", async () => {
    const { deps, store } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    deps.drawCheck = fakeRenderer().render; // draws the same 8 x 8 sprite as the judge render
    const job = await runCreatureJob(deps, "job-check-aaaa");
    expect(job.step).toBe("done");
    expect(await store.listCreatureIds()).toHaveLength(1);
  });

  test("fails, and stores nothing, when QuickJS would draw other pixels or fail", async () => {
    for (const check of [
      fakeRenderer(() => ({ ok: true, stats: CLEAN_STATS, png: otherPng() })).render,
      fakeRenderer(() => ({ ok: false, error: "quickjs: Error: boom" })).render,
    ]) {
      const { deps, store } = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
      deps.drawCheck = check;
      const job = await runCreatureJob(deps, "job-check-bbbb");
      expect(job).toMatchObject({ step: "failed", error: "the sprite would not draw the same in the browser" });
      expect(await store.listCreatureIds()).toEqual([]);
      expect(store.codes.size).toBe(0);
    }
  });
});

describe("a job with a signing key (the option E experiment)", () => {
  test("signs the id and both hashes of the creature it stores, and a job without a key stores no signature", async () => {
    const keys = await generateSigningKeys();
    const signed = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    signed.deps.sign = (id, build) => signBuild(keys.privateKey, id, build);
    expect((await runCreatureJob(signed.deps, "job-signed-aaaa")).step).toBe("done");
    const [id] = await signed.store.listCreatureIds();
    const build = (await signed.store.getCreature(id ?? ""))?.build;
    expect(build?.signature).toBeString();
    expect(
      await verifyBuild(keys.publicKey, id ?? "", build ?? { codeSha256: "", pixelsSha256: "" }, build?.signature),
    ).toBe(true);

    const unsigned = jobWith([briefJson(), fenced(GOOD_CODE), verdictJson(8)]);
    expect((await runCreatureJob(unsigned.deps, "job-unsigned-aaaa")).step).toBe("done");
    const [otherId] = await unsigned.store.listCreatureIds();
    expect((await unsigned.store.getCreature(otherId ?? ""))?.build?.signature).toBeUndefined();
  });
});
