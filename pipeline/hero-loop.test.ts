import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { compareCodeUnits } from "../src/lib/compare";
import { CLEAN_STATS, fakeModel, fakeRenderer, fenced, spritePng, verdictJson } from "./fakes";
import { attemptVerdict, judgeHeroCode, runHeroLoop } from "./hero-loop";
import type { LoopCore } from "./loop";
import type { RenderRequest, RenderResult } from "./render-types";

const GENERATOR_PROMPT = "GENERATOR PROMPT";
const VERIFIER_PROMPT = "VERIFIER PROMPT";

const heroCode = (marker: string) =>
  `function build(k) {\n  // ${marker}\n  hero(k, { sex: 'male', melee: 'xiphos', ranged: 'bow', pose: POSE || 'idle', facing: FACING, cape: true });\n}`;
const SIMPLE = heroCode("simple");
const CONTRAST = heroCode("contrast");
const PLAIN = heroCode("plain");
const FIXED = heroCode("fixed");
// the weapon is wrong: a sword where the brief says xiphos
const WRONG_WEAPON = PLAIN.replace("'xiphos'", "'sword'");

function core(model: LoopCore["model"], render: LoopCore["render"]): LoopCore {
  return {
    model,
    render,
    pose: "",
    generatorPrompt: GENERATOR_PROMPT,
    verifierPrompt: VERIFIER_PROMPT,
    store: { logCall: () => {}, saveAttemptCode: () => {}, saveAttemptPng: () => {} },
    print: () => {},
  };
}

const firstMessageSchema = z.object({
  content: z.union([z.string(), z.array(z.object({ text: z.string().optional() }))]),
});
// a verifier call carries blocks (text and the image); a generator call is a plain string
const firstContent = (messages: unknown[]) => firstMessageSchema.parse(messages[0]).content;
const isVerifier = (messages: unknown[]) => Array.isArray(firstContent(messages));
const firstText = (messages: unknown[]) => {
  const content = firstContent(messages);
  return typeof content === "string" ? content : (content[0]?.text ?? "");
};

// answers a generator call from the candidate's nudge, a fix from the code in the follow-up turn, a verifier call with a score
function scripted(
  codes: { plain: string; simple: string; contrast: string; fixed: string },
  score: (code: string) => number,
) {
  return fakeModel(({ messages }) => {
    if (isVerifier(messages)) {
      const shown = firstText(messages);
      const code = [codes.fixed, codes.plain, codes.simple, codes.contrast].find((candidate) =>
        shown.includes(candidate),
      );
      return verdictJson(score(code ?? ""));
    }
    if (messages.length === 3) {
      return fenced(codes.fixed);
    }
    const brief = firstText(messages);
    if (brief.includes("as simple as possible")) {
      return fenced(codes.simple);
    }
    if (brief.includes("strong, contrasting")) {
      return fenced(codes.contrast);
    }
    return fenced(codes.plain);
  });
}

const alwaysAccepted: (attempt: { accepted: boolean }) => boolean = (attempt) => attempt.accepted;

describe("judging a hero's code", () => {
  test("renders each representative frame as its pose and direction, and judges all four", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, () => 8);
    const renderer = fakeRenderer();
    const attempt = await judgeHeroCode(
      core(model.client, renderer.render),
      "male",
      { kind: "model", code: PLAIN },
      "hero-male-x",
      "session",
      {},
    );
    expect(renderer.requests.map((request) => request.pose).sort(compareCodeUnits)).toEqual([
      "idle1",
      "melee3",
      "ranged3",
      "walk2",
    ]);
    for (const request of renderer.requests) {
      expect(request.code).toMatch(/^const FACING = -?\d+;/);
      expect(request.code).toContain("k.noScale = true;");
      expect(request.name).toMatch(/^hero-male-x-(idle1-s|walk2-se|melee3-se|ranged3-se)$/);
    }
    expect(attempt.frames).toHaveLength(4);
    expect(attempt.score).toBe(8);
    expect(attempt.accepted).toBe(true);
    // the verifier is told which frame and which weapon, after the brief
    const verifierTexts = model.sent.map((body) => JSON.stringify(body.messages));
    expect(verifierTexts.some((text) => text.includes("the xiphos must be in his hand"))).toBe(true);
    expect(model.sent.every((body) => JSON.stringify(body.system).includes(VERIFIER_PROMPT))).toBe(true);
  });

  test("a code that breaks the contract is refused before any render or verifier call", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, () => 8);
    const renderer = fakeRenderer();
    const attempt = await judgeHeroCode(
      core(model.client, renderer.render),
      "male",
      { kind: "model", code: WRONG_WEAPON },
      "hero-male-x",
      "session",
      {},
    );
    expect(renderer.requests).toHaveLength(0);
    expect(model.sent).toHaveLength(0);
    expect(attempt.accepted).toBe(false);
    expect(attempt.score).toBe(0);
    expect(attemptVerdict(attempt).issues[0]).toContain("xiphos");
  });

  test("is not accepted when one frame fails the job's rule, even if the others score well", async () => {
    const model = fakeModel(({ messages }) => (isVerifier(messages) ? verdictJson(8) : fenced(PLAIN)));
    const renderer = fakeRenderer(
      (request): RenderResult =>
        request.pose === "ranged3"
          ? { ok: true, stats: { ...CLEAN_STATS, flags: "clipped_at_edge" }, png: spritePng() }
          : { ok: true, stats: CLEAN_STATS, png: spritePng() },
    );
    const attempt = await judgeHeroCode(
      core(model.client, renderer.render),
      "male",
      { kind: "model", code: PLAIN },
      "hero-male-x",
      "session",
      {},
    );
    expect(attempt.frames.map((frame) => frame.accepted)).toEqual([true, true, true, false]);
    expect(attempt.accepted).toBe(false);
    expect(attempt.score).toBe(6);
  });
});

describe("the hero loop", () => {
  test("keeps the best of three candidates and skips the fix when it is good enough", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, (code) =>
      code === CONTRAST ? 8 : 6,
    );
    const outcome = await runHeroLoop(core(model.client, fakeRenderer().render), "male", 3, alwaysAccepted);
    expect(outcome?.winner.code).toBe(CONTRAST);
    expect(outcome?.which).toBe("first");
    expect(outcome?.candidateScores).toEqual([6, 6, 8]);
    expect(outcome?.fixRequestId).toBeNull();
    expect(outcome?.generatorRequestIds).toHaveLength(3);
    // three generator calls, then four verdicts for each candidate (a 6 is borderline and is judged twice)
    const generatorCalls = model.sent.filter((body) => JSON.stringify(body.system).includes(GENERATOR_PROMPT));
    expect(generatorCalls).toHaveLength(3);
    expect(model.urls.every((url) => url === "https://api.mubit.ai/anthropic/v1/messages")).toBe(true);
    expect(model.sent.every((body) => body.temperature === undefined)).toBe(true);
  });

  test("sends one fix turn with the failing frames' issues when no candidate is good enough, and keeps the better", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, (code) =>
      code === FIXED ? 8 : 4,
    );
    const outcome = await runHeroLoop(core(model.client, fakeRenderer().render), "male", 3, alwaysAccepted);
    expect(outcome?.which).toBe("fixed");
    expect(outcome?.winner.code).toBe(FIXED);
    expect(outcome?.fixedScore).toBe(8);
    expect(outcome?.fixRequestId).not.toBeNull();
    const fix = model.sent.find((body) => body.messages.length === 3);
    expect(fix).toBeDefined();
    const correction = JSON.stringify(fix?.messages.at(-1));
    expect(correction).toContain("Your sprite was rendered and rejected");
    expect(correction).toContain("idle1 from the s");
  });

  test("keeps the first when the fix does not score higher", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, () => 4);
    const outcome = await runHeroLoop(core(model.client, fakeRenderer().render), "male", 3, alwaysAccepted);
    expect(outcome?.which).toBe("first");
    expect(outcome?.winner.accepted).toBe(false);
  });

  test("a candidate that is accepted but does not beat the bar still gets the fix turn", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, (code) =>
      code === FIXED ? 9 : 7,
    );
    const outcome = await runHeroLoop(
      core(model.client, fakeRenderer().render),
      "male",
      3,
      (attempt) => attempt.score > 7.5,
    );
    expect(outcome?.which).toBe("fixed");
    expect(outcome?.winner.score).toBe(9);
  });

  test("draws one candidate for each nudge and no more, however many are asked for", async () => {
    const model = scripted({ plain: PLAIN, simple: SIMPLE, contrast: CONTRAST, fixed: FIXED }, () => 8);
    const outcome = await runHeroLoop(core(model.client, fakeRenderer().render), "male", 5, alwaysAccepted);
    expect(outcome?.generatorRequestIds).toHaveLength(3);
  });

  test("returns null when no generator call answers", async () => {
    const model = fakeModel(() => null);
    const requests: RenderRequest[] = [];
    const outcome = await runHeroLoop(
      core(model.client, async (request) => {
        requests.push(request);
        return { ok: false, error: "none" };
      }),
      "male",
      3,
      alwaysAccepted,
    );
    expect(outcome).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
