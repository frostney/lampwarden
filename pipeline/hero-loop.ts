// The loop for one warden: the generator writes the hero's build code (three candidates), each candidate is rendered in
// four representative frames (standing, walking, the melee strike, the ranged draw) and every frame is judged by the
// verifier, then one fix turn on the best candidate unless it already wins, and best-of between it and its fix. It is
// loop.ts's own steps (`generate`, `renderAndVerify`, `correctionMessage`) with the system prompts untouched, so the
// calls land in the same Mubit tasks as every other sprite. Model, renderer and store are injected; this module touches
// no file and imports nothing from node:fs.
import { bestIndexBy } from "../src/lib/best";
import type { Sex } from "../src/scene/assets";
import {
  heroBrief,
  heroCodeIssues,
  heroModelFrameCode,
  poseOf,
  REPRESENTATIVE_FRAMES,
  type RepresentativeFrame,
} from "./hero-model";
import {
  type Attempt,
  CANDIDATE_HINTS,
  correctionMessage,
  extractCode,
  FIX_MAX_TOKENS,
  GENERATOR_MAX_TOKENS,
  generate,
  isAccepted,
  type LoopCore,
  renderAndVerify,
  type Verdict,
} from "./loop";
import type { ModelMessage } from "./mubit";
import { RENDERED_WITH, type RenderResult } from "./render-types";

/** The candidates' nudges: the loop's own "simple" and "contrast" hints; the facing hints do not apply (FACING is not the model's). */
const HERO_HINTS = ["", CANDIDATE_HINTS[3] ?? "", CANDIDATE_HINTS[4] ?? ""] as const; // a candidate each, never repeated

/** One representative frame, rendered and judged. */
export interface JudgedFrame {
  pose: string;
  direction: RepresentativeFrame["direction"];
  score: number | null;
  pass: boolean;
  accepted: boolean;
  flags: string | null;
  issues: string[];
  stage: Attempt["stage"];
  requestIds: Array<string | null>;
  png: Uint8Array | null;
}

/** A candidate's code and what the verifier made of its four frames. */
export interface HeroAttempt {
  name: string;
  code: string;
  /** Why the code was refused before any render (empty when it was not). */
  staticIssues: string[];
  frames: JudgedFrame[];
  /** The mean of the four frames' scores (0 for each unjudged frame): what candidates are ranked by. */
  score: number;
  /** Every frame is accepted by the live job's rule (a verifier pass, or 6 and above with no engine flag) and the code is clean. */
  accepted: boolean;
}

const ISSUES_PER_FRAME = 3; // a frame's issues the fix turn is told about
const mean = (scores: readonly number[]) => scores.reduce((total, score) => total + score, 0) / (scores.length || 1);

function judgedFrameOf(frame: RepresentativeFrame, attempt: Attempt): JudgedFrame {
  const render = attempt.render;
  return {
    pose: poseOf(frame),
    direction: frame.direction,
    score: attempt.verdict.score,
    pass: attempt.verdict.pass,
    accepted: render.ok && isAccepted({ verdict: attempt.verdict, stats: render.stats }),
    flags: render.ok ? render.stats.flags : null,
    issues: attempt.verdict.issues,
    stage: attempt.stage,
    requestIds: attempt.requestIds,
    png: render.ok ? render.png : null,
  };
}

/** Where a frame's code comes from: the model's, wrapped for the frame's direction, or a plain script that renders as it is. */
export type FrameCode =
  | { kind: "model"; code: string }
  | { kind: "script"; codeFor: (frame: RepresentativeFrame) => string };

/** Renders and judges the four representative frames of a code, side by side. */
export async function judgeHeroCode(
  core: LoopCore,
  sex: Sex,
  source: FrameCode,
  name: string,
  session: string,
  logFields: Record<string, unknown>,
): Promise<HeroAttempt> {
  const brief = heroBrief(sex);
  const frames = REPRESENTATIVE_FRAMES(sex);
  const shownCode = source.kind === "model" ? source.code : "";
  const staticIssues = source.kind === "model" ? heroCodeIssues(sex, source.code) : [];
  if (staticIssues.length > 0) {
    return {
      name,
      code: shownCode,
      staticIssues,
      frames: frames.map((frame) => ({
        pose: poseOf(frame),
        direction: frame.direction,
        score: 0,
        pass: false,
        accepted: false,
        flags: null,
        issues: staticIssues,
        stage: "render",
        requestIds: [],
        png: null,
      })),
      score: 0,
      accepted: false,
    };
  }
  const attempts = await Promise.all(
    frames.map((frame) => {
      const code = source.kind === "model" ? source.code : source.codeFor(frame);
      const render = async (request: Parameters<LoopCore["render"]>[0]): Promise<RenderResult> =>
        core.render(
          source.kind === "model" ? { ...request, code: heroModelFrameCode(request.code, frame.direction) } : request,
        );
      return renderAndVerify(
        { ...core, pose: poseOf(frame), render },
        code,
        `${name}-${poseOf(frame)}-${frame.direction}`,
        `${brief}\n\n${frame.note}`,
        session,
        { ...logFields, frame: `${poseOf(frame)}_${frame.direction}` },
      );
    }),
  );
  const judged = attempts.map((attempt, index) => {
    const frame = frames[index];
    if (!frame) {
      throw new Error("a frame without a spec");
    }
    return judgedFrameOf(frame, attempt);
  });
  return {
    name,
    code: shownCode,
    staticIssues,
    frames: judged,
    score: mean(judged.map((frame) => frame.score ?? 0)),
    accepted: judged.every((frame) => frame.accepted),
  };
}

/** The verdict the fix turn is told: the mean score and every failing frame's issues and requested fixes, by frame. */
export function attemptVerdict(attempt: HeroAttempt): Verdict {
  const failing = attempt.frames.filter((frame) => !frame.accepted || !frame.pass);
  const weakest = attempt.frames.reduce<JudgedFrame | null>(
    (lowest, frame) => (!lowest || (frame.score ?? 0) < (lowest.score ?? 0) ? frame : lowest),
    null,
  );
  const issues = attempt.staticIssues.concat(
    failing.flatMap((frame) =>
      frame.issues.slice(0, ISSUES_PER_FRAME).map((issue) => `${frame.pose} from the ${frame.direction}: ${issue}`),
    ),
  );
  return {
    pass: false,
    score: Math.round(attempt.score * 10) / 10,
    issues: issues.length > 0 ? issues : [`weakest frame ${weakest?.pose ?? "?"}`],
    fix:
      attempt.staticIssues.length > 0
        ? attempt.staticIssues.join("; ")
        : "Keep the single hero(k, {...}) call with sex, melee, ranged, pose: POSE || 'idle' and facing: FACING exactly; raise the weakest frames by choosing a helmet, a cape and a palette whose colours contrast, so the armour, cloth and weapon read apart.",
    lesson: "",
  };
}

export interface HeroLoopOutcome {
  sex: Sex;
  brief: string;
  session: string;
  /** Every attempt in the order made: the candidates, then the fix. */
  attempts: HeroAttempt[];
  /** Generator request ids, in candidate order. */
  generatorRequestIds: Array<string | null>;
  fixRequestId: string | null;
  /** The best of the best candidate and its fix. */
  winner: HeroAttempt;
  which: "first" | "fixed";
  /** The best candidate before the fix. */
  firstScore: number;
  fixedScore: number | null;
  candidateScores: number[];
}

/** Whether the winner is good enough to skip the fix: accepted by the job's rule and above the bar the caller sets. */
export type HeroGoodEnough = (attempt: HeroAttempt) => boolean;

export async function runHeroLoop(
  core: LoopCore,
  sex: Sex,
  candidateCount: number,
  goodEnough: HeroGoodEnough,
): Promise<HeroLoopOutcome | null> {
  const print = core.print ?? console.log;
  const brief = heroBrief(sex);
  const count = Math.min(candidateCount, HERO_HINTS.length);
  const session = `lampwarden-hero-${sex}`;
  const logFields = { bid: `hero-${sex}`, cat: "hero", brief, render: RENDERED_WITH };
  const messagesFor = (index: number): ModelMessage[] => [
    { role: "user", content: `Brief: ${brief}${HERO_HINTS[index % HERO_HINTS.length] ?? ""}` },
  ];
  const generations = await Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      generate(core, "gen", messagesFor(index), session, { ...logFields, candidate: index }, GENERATOR_MAX_TOKENS),
    ),
  );
  const drawn = generations.flatMap((generation, index) =>
    generation.text === null ? [] : [{ index, generation, text: generation.text }],
  );
  if (drawn.length === 0) {
    print(`hero-${sex} GEN FAILED ${generations[0]?.record.error}`);
    return null;
  }
  const candidates = await Promise.all(
    drawn.map((item) =>
      judgeHeroCode(core, sex, { kind: "model", code: extractCode(item.text) }, `hero-${sex}-c${item.index}`, session, {
        ...logFields,
        stage: "first",
        candidate: item.index,
      }),
    ),
  );
  const bestIndex = bestIndexBy(candidates, (attempt) => attempt.score);
  const first = candidates[bestIndex];
  const chosen = drawn[bestIndex];
  if (!first || !chosen) {
    return null;
  }
  const candidateScores = candidates.map((attempt) => attempt.score);
  print(`hero-${sex} | candidates ${JSON.stringify(candidateScores)} | accepted=${first.accepted}`);
  const attempts: HeroAttempt[] = [...candidates];
  let winner = first;
  let which: "first" | "fixed" = "first";
  let fixRequestId: string | null = null;
  let fixedScore: number | null = null;
  if (!goodEnough(first)) {
    const fixMessages: ModelMessage[] = [
      ...messagesFor(chosen.index),
      { role: "assistant", content: chosen.text },
      { role: "user", content: correctionMessage(brief, attemptVerdict(first)) },
    ];
    const fixCall = await generate(
      core,
      "fix",
      fixMessages,
      session,
      {
        ...logFields,
        candidate: chosen.index,
        fixes_verify: first.frames.flatMap((frame) => frame.requestIds.slice(0, 1)),
      },
      FIX_MAX_TOKENS,
    );
    fixRequestId = fixCall.record.rid;
    if (fixCall.text !== null) {
      const fixed = await judgeHeroCode(
        core,
        sex,
        { kind: "model", code: extractCode(fixCall.text) },
        `hero-${sex}-fixed`,
        session,
        { ...logFields, stage: "after_fix", candidate: chosen.index },
      );
      attempts.push(fixed);
      fixedScore = fixed.score;
      print(`   fix ${fixRequestId} | score ${fixed.score} accepted=${fixed.accepted}`);
      // best-of: ties go to the first attempt; an accepted attempt beats one that is not
      if (fixed.score > first.score && (fixed.accepted || !first.accepted)) {
        winner = fixed;
        which = "fixed";
      }
    }
  }
  return {
    sex,
    brief,
    session,
    attempts,
    generatorRequestIds: generations.map((generation) => generation.record.rid),
    fixRequestId,
    winner,
    which,
    firstScore: first.score,
    fixedScore,
    candidateScores,
  };
}

/** The warden in use now judged the same way (the deterministic one, or the committed model code), the bar a new one must beat. */
export function judgeCurrentHero(core: LoopCore, sex: Sex, source: FrameCode): Promise<HeroAttempt> {
  return judgeHeroCode(core, sex, source, `hero-${sex}-current`, `lampwarden-hero-${sex}-current`, {
    bid: `hero-${sex}-current`,
    cat: "hero",
    brief: heroBrief(sex),
    render: RENDERED_WITH,
    stage: "current",
  });
}
