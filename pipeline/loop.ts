// The loop for one brief: generator (Opus via Mubit) -> render -> verifier (Opus via Mubit, sees the image) -> one fix ->
// best-of. The model, the renderer and the store (where call logs and attempts go) are injected, so tests drive the
// loop with a fake fetch and a fake renderer, and a Vercel function runs it without a filesystem: this module imports
// nothing from node:fs. sprite-loop.ts is the command line's file-backed wrapper around it.
import { z } from "zod";
import { rejectionReason } from "./build-code";
import type { CallRecord, ContentBlock, ModelCall, ModelMessage, MubitClient } from "./mubit";
import { RENDERED_WITH, type Renderer, type RenderRequest, type RenderResult, type RenderStats } from "./render-types";
import { verifierImageBase64 } from "./verifier-image";

const PASSING_SCORE = 7;
const BORDERLINE_SCORES = [6, 7] as const;
const GENERATOR_MAX_TOKENS = 1500;
const GENERATOR_RETRY_MAX_TOKENS = 4000;
const FIX_MAX_TOKENS = 3000;
const VERIFIER_MAX_TOKENS = 1800;

export interface Brief {
  /** Also the sprite's file name, after slugifying. */
  id: string;
  category: string;
  text: string;
}

export interface Verdict {
  pass: boolean;
  score: number | null;
  issues: string[];
  fix: string;
  lesson: string;
  /** Both scores when a borderline sprite was verified twice and averaged. */
  scores?: [number, number];
}

/**
 * One finished brief. The keys are the manifest.json row format of the committed sprites (the same names as before
 * the TypeScript port) and are written in this order.
 */
export interface SpriteRow {
  id: string;
  brief: string;
  session: string;
  gen: string | null;
  verify?: Array<string | null>;
  first_score?: number | null;
  /** With several candidates: every candidate's score, in the order drawn. */
  candidate_scores?: Array<number | null>;
  /** With several candidates: every candidate's generator request id, in the order drawn (`gen` is the chosen one's). */
  candidate_gen?: Array<string | null>;
  fix?: string | null;
  fixed_verify?: Array<string | null>;
  fixed_score?: number | null;
  final?: "first" | "fixed";
  score?: number | null;
  passed?: boolean;
  issues?: string[];
  rendered_with?: string;
}

/** The loop's stages, as a caller that reports progress sees them. */
export type LoopStage = "drawing" | "rendering" | "judging" | "fixing";

/** Where the loop leaves its records. The command line writes files; a function keeps them in memory or drops them. */
export interface LoopStore {
  /** One row per model call (the call's request id, status, tokens and, for the verifier, its verdict). */
  logCall(row: CallRecord): Promise<void> | void;
  /** The build code of an attempt, before it is rendered. */
  saveAttemptCode(name: string, code: string): Promise<void> | void;
  /** The PNG an attempt rendered to. */
  saveAttemptPng(name: string, png: Uint8Array): Promise<void> | void;
}

export interface LoopCore {
  model: MubitClient;
  render: Renderer;
  pose: string;
  generatorPrompt: string;
  verifierPrompt: string;
  store: LoopStore;
  print?: (line: string) => void;
  /** Called as each stage starts, so a job can report where it is. A failure here ends the loop. */
  onStage?: (stage: LoopStage) => Promise<void> | void;
}

const verdictReplySchema = z.object({
  pass: z.unknown().optional(),
  score: z.unknown().optional(),
  issues: z.array(z.unknown()).optional(),
  fix: z.unknown().optional(),
  lesson: z.unknown().optional(),
});

function isScore(value: unknown): value is number {
  return typeof value === "number";
}

/**
 * `toFixed` with Python's rounding of exact ties (half to even), so the numbers the verifier is shown do not change
 * with the language: 12.5 -> "12", 13.5 -> "14", 12.25 -> "12.2".
 */
export function formatFixed(value: number, digits: number): string {
  const scaledByPowerOfTwo = value * 2 ** (digits + 1);
  const isExactTie = Number.isInteger(scaledByPowerOfTwo) && scaledByPowerOfTwo % 2 !== 0;
  if (!isExactTie) return value.toFixed(digits);
  const scale = 10 ** digits;
  const lower = Math.floor(value * scale);
  return ((lower % 2 === 0 ? lower : lower + 1) / scale).toFixed(digits);
}

/** The first `{ ... }` span of the reply as a verdict, or null when the reply is not a JSON verdict. */
export function parseVerdict(text: string | null): Verdict | null {
  const span = /\{[\s\S]*\}/.exec(text ?? "")?.[0];
  if (!span) return null;
  try {
    const parsed = verdictReplySchema.safeParse(JSON.parse(span));
    if (!parsed.success) return null;
    const { score, pass, issues, fix, lesson } = parsed.data;
    const numericScore = isScore(score) ? score : null;
    return {
      pass: Boolean(pass) && numericScore !== null && numericScore >= PASSING_SCORE,
      score: numericScore,
      issues: (issues ?? []).map(String),
      fix: typeof fix === "string" ? fix : "",
      lesson: typeof lesson === "string" ? lesson : "",
    };
  } catch {
    return null;
  }
}

function verifierMessage(brief: string, code: string, stats: RenderStats, png: Uint8Array): ModelMessage {
  const statsSummary = `bbox ${stats.bbox}, coverage ${formatFixed(100 * stats.coverage, 0)}%, parts ${stats.parts}, flags ${stats.flags}`;
  const content: ContentBlock[] = [
    {
      type: "text",
      text: `BRIEF: ${brief}\n\nENGINE STATS: ${statsSummary}\n\nGENERATOR CODE:\n\`\`\`ts\n${code}\n\`\`\`\n\nRENDERED SPRITE (image):`,
    },
    { type: "image", source: { type: "base64", media_type: "image/png", data: verifierImageBase64(png) } },
  ];
  return { role: "user", content };
}

interface VerifierRow {
  rid: string | null;
  verdict: Verdict;
}

async function verifyOnce(
  context: LoopCore,
  png: Uint8Array,
  brief: string,
  code: string,
  stats: RenderStats,
  session: string,
  logFields: Record<string, unknown>,
): Promise<VerifierRow> {
  const { record, text } = await context.model.call(
    "verify",
    context.verifierPrompt,
    [verifierMessage(brief, code, stats, png)],
    session,
    logFields,
    VERIFIER_MAX_TOKENS,
  );
  const unparsed = (text || (typeof record.error === "string" ? record.error : "")).slice(0, 200);
  const verdict = parseVerdict(text) ?? {
    pass: false,
    score: null,
    issues: [`verifier reply not JSON: ${unparsed}`],
    fix: "",
    lesson: "",
  };
  record.verdict = verdict;
  await context.store.logCall(record);
  return { rid: record.rid, verdict };
}

export async function verify(
  context: LoopCore,
  png: Uint8Array,
  brief: string,
  code: string,
  stats: RenderStats,
  session: string,
  logFields: Record<string, unknown>,
): Promise<{ verdict: Verdict; requestIds: Array<string | null> }> {
  const first = await verifyOnce(context, png, brief, code, stats, session, { ...logFields, sample: 1 });
  const verdict = { ...first.verdict };
  const requestIds = [first.rid];
  const firstScore = verdict.score;
  const [lowest, highest] = BORDERLINE_SCORES;
  if (isScore(firstScore) && firstScore >= lowest && firstScore <= highest) {
    // borderline: verify twice, average
    const second = await verifyOnce(context, png, brief, code, stats, session, { ...logFields, sample: 2 });
    requestIds.push(second.rid);
    const secondScore = second.verdict.score;
    if (isScore(secondScore)) {
      verdict.scores = [firstScore, secondScore];
      verdict.score = (firstScore + secondScore) / 2;
      verdict.pass = verdict.score >= PASSING_SCORE && (verdict.pass || second.verdict.pass);
    }
  }
  return { verdict, requestIds };
}

export function extractCode(text: string): string {
  const match = /```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/.exec(text);
  return (match?.[1] ?? text).trim();
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

function isTruncated(stop: unknown, text: string): boolean {
  const code = extractCode(text);
  return (
    stop === "max_tokens" ||
    countOf(code, "{") !== countOf(code, "}") ||
    (code.includes("function build") && !code.trimEnd().endsWith("}"))
  );
}

async function generate(
  context: LoopCore,
  task: string,
  messages: ModelMessage[],
  session: string,
  logFields: Record<string, unknown>,
  maxTokens: number,
): Promise<ModelCall> {
  let call = await context.model.call(task, context.generatorPrompt, messages, session, logFields, maxTokens);
  if (call.text !== null && isTruncated(call.record.stop, call.text)) {
    // one retry with a bigger budget
    call.record.truncated_first = { rid: call.record.rid, out_tokens: call.record.out_tokens };
    const retry = await context.model.call(
      task,
      context.generatorPrompt,
      messages,
      session,
      logFields,
      GENERATOR_RETRY_MAX_TOKENS,
    );
    retry.record.note = `truncation retry of ${call.record.rid}`;
    await context.store.logCall(call.record);
    call = retry;
  }
  await context.store.logCall(call.record);
  return call;
}

/** What the engine's own checks say about a render; a non-empty list scores 0 without a verifier call. */
export function engineFlagIssues(stats: RenderStats): string[] {
  const issues: string[] = [];
  if (stats.flags.includes("clipped_at_edge"))
    issues.push(`sprite touches the canvas edge (bbox ${stats.bbox}): keep everything within |u|,|v|<=14 and z<=40`);
  if (stats.flags.includes("too_small"))
    issues.push(`sprite covers only ${formatFixed(100 * stats.coverage, 1)}% of the canvas: make it bigger`);
  if (stats.flags.includes("too_big"))
    issues.push(`sprite covers ${formatFixed(100 * stats.coverage, 0)}% of the canvas: make it smaller`);
  if (stats.flags.includes("too_short")) issues.push("sprite is under 24 px tall: make it taller");
  return issues;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** A score as the fix prompt shows it: `None` without one, and an averaged score always with a decimal (`6.0`). */
function scoreText(verdict: Verdict): string {
  if (verdict.score === null) return "None";
  return verdict.scores && Number.isInteger(verdict.score) ? verdict.score.toFixed(1) : String(verdict.score);
}

export function correctionMessage(brief: string, verdict: Verdict): string {
  return (
    `Your sprite was rendered and rejected.\nBrief: ${brief}\nScore: ${scoreText(verdict)}/10\nIssues:\n- ${verdict.issues.join("\n- ")}` +
    `\nRequested fix: ${verdict.fix}\n\nReply with the complete corrected build(k) only, keeping what already works.`
  );
}

interface Attempt {
  code: string;
  name: string;
  render: RenderResult;
  verdict: Verdict;
  requestIds: Array<string | null>;
  /** "render" (the code did not run), "post" (the engine's flags failed it) or "llm" (the verifier scored it). */
  stage: "render" | "post" | "llm";
}

async function renderAndVerify(
  context: LoopCore,
  code: string,
  name: string,
  brief: string,
  session: string,
  logFields: Record<string, unknown>,
): Promise<Attempt> {
  const rejection = rejectionReason(code);
  let render: RenderResult;
  if (rejection) render = { ok: false, error: rejection };
  else {
    await context.store.saveAttemptCode(name, code);
    await context.onStage?.("rendering");
    render = await context.render({ code, name, pose: context.pose } satisfies RenderRequest);
  }
  if (!render.ok) {
    const verdict: Verdict = {
      pass: false,
      score: 0,
      issues: [`code did not run: ${render.error}`],
      fix: "Return a complete function build(k) using only the documented builders.",
      lesson: "",
    };
    return { code, name, render, verdict, requestIds: [], stage: "render" };
  }
  await context.store.saveAttemptPng(name, render.png);
  const flagIssues = engineFlagIssues(render.stats);
  if (flagIssues.length > 0) {
    // engine flags short-circuit: no verifier call
    const verdict: Verdict = { pass: false, score: 0, issues: flagIssues, fix: flagIssues.join("; "), lesson: "" };
    return { code, name, render, verdict, requestIds: [], stage: "post" };
  }
  await context.onStage?.("judging");
  const { verdict, requestIds } = await verify(context, render.png, brief, code, render.stats, session, logFields);
  return { code, name, render, verdict, requestIds, stage: "llm" };
}

function describeAttempt(attempt: Attempt): string {
  return `${attempt.stage} pass=${attempt.verdict.pass} score=${attempt.verdict.score} ${JSON.stringify(attempt.verdict.issues.slice(0, 2))}`;
}

/** The attempt the loop kept: its code and PNG, the engine's stats and the verdict. */
export interface LoopWinner {
  which: "first" | "fixed";
  name: string;
  code: string;
  png: Uint8Array;
  stats: RenderStats;
  verdict: Verdict;
}

export interface LoopOutcome {
  row: SpriteRow;
  winner: LoopWinner;
}

/** Runs the whole loop for one brief. Returns its manifest row and the winning attempt, or null when nothing renderable came out. */
export async function runLoop(context: LoopCore, brief: Brief): Promise<LoopOutcome | null> {
  const print = context.print ?? console.log;
  const session = `lampwarden-${brief.id}-${Array.from(brief.text.replace(/[^\p{L}\p{N}_]+/gu, "-"))
    .slice(0, 34)
    .join("")}`;
  const logFields = { bid: brief.id, cat: brief.category, brief: brief.text, render: RENDERED_WITH };
  const messages: ModelMessage[] = [{ role: "user", content: `Brief: ${brief.text}` }];
  await context.onStage?.("drawing");
  const generation = await generate(context, "gen", messages, session, { ...logFields }, GENERATOR_MAX_TOKENS);
  const row: SpriteRow = { id: brief.id, brief: brief.text, session, gen: generation.record.rid };
  if (generation.text === null) {
    print(`${brief.id} GEN FAILED ${generation.record.error}`);
    return null;
  }
  const code = extractCode(generation.text);
  const spriteName = slugify(brief.id);
  const first = await renderAndVerify(context, code, spriteName, brief.text, session, { ...logFields, stage: "first" });
  row.verify = first.requestIds;
  row.first_score = first.verdict.score;
  let best: { attempt: Attempt; which: "first" | "fixed" } = { attempt: first, which: "first" };
  print(`${brief.id} | gen ${generation.record.rid} | ${describeAttempt(first)}`);
  if (!first.verdict.pass) {
    // ONE fix call: the verifier's issues + fix go back to the generator as a follow-up turn
    const fixMessages: ModelMessage[] = [
      ...messages,
      { role: "assistant", content: generation.text },
      { role: "user", content: correctionMessage(brief.text, first.verdict) },
    ];
    await context.onStage?.("fixing");
    const fixCall = await generate(
      context,
      "fix",
      fixMessages,
      session,
      { ...logFields, fixes_verify: first.requestIds.slice(0, 1) },
      FIX_MAX_TOKENS,
    );
    row.fix = fixCall.record.rid;
    if (fixCall.text !== null) {
      const fixed = await renderAndVerify(
        context,
        extractCode(fixCall.text),
        `${spriteName}-fixed`,
        brief.text,
        session,
        {
          ...logFields,
          stage: "after_fix",
        },
      );
      row.fixed_verify = fixed.requestIds;
      row.fixed_score = fixed.verdict.score;
      print(`   fix ${fixCall.record.rid} | ${describeAttempt(fixed)}`);
      // best-of: ties go to the first attempt
      if ((fixed.verdict.score ?? 0) > (first.verdict.score ?? 0)) best = { attempt: fixed, which: "fixed" };
    }
  }
  const { attempt, which } = best;
  if (!attempt.render.ok) {
    print(`${brief.id} no renderable result`);
    return null;
  }
  row.final = which;
  row.score = attempt.verdict.score;
  row.passed = attempt.verdict.pass;
  row.issues = attempt.verdict.issues;
  row.rendered_with = RENDERED_WITH;
  const winner: LoopWinner = {
    which,
    name: attempt.name,
    code: attempt.code,
    png: attempt.render.png,
    stats: attempt.render.stats,
    verdict: attempt.verdict,
  };
  return { row, winner };
}

// Mubit takes no temperature, so candidates drawn from one prompt come out nearly identical. Each candidate after the
// first gets a different nudge in its user message, which is what makes drawing several worth it.
const CANDIDATE_HINTS = [
  "",
  "\n\nAim for a clear silhouette: turn the figure so its defining parts face the viewer (facing 40), and keep everything well inside the frame.",
  "\n\nTurn the figure to a three-quarter view at facing 10, with the key parts turned towards the viewer, and keep everything well inside the frame.",
  "\n\nKeep it as simple as possible: the builder's own defaults wherever the brief does not say otherwise, and only the parameters the brief names.",
  "\n\nGive each named part a strong, contrasting colour so it stands out from the body.",
];

const candidateMessages = (brief: Brief, index: number): ModelMessage[] => [
  { role: "user", content: `Brief: ${brief.text}${CANDIDATE_HINTS[index % CANDIDATE_HINTS.length] ?? ""}` },
];

/** One rendered candidate or fix, kept for diagnostics (the contact sheets of a live run). */
export interface CandidateRecord {
  name: string;
  code: string;
  png: Uint8Array | null;
  stats: RenderStats | null;
  score: number | null;
  pass: boolean;
  stage: "render" | "post" | "llm";
  isFix: boolean;
}

export interface CandidateOutcome extends LoopOutcome {
  /** Every candidate and the fix, in the order made. */
  candidates: CandidateRecord[];
}

/** Reports each stage once per phase, so candidates running side by side do not each write the same job step. */
function reportingEachStageOnce(context: LoopCore): { context: LoopCore; reset: () => void } {
  const seen = new Set<LoopStage>();
  return {
    context: {
      ...context,
      onStage: (stage) => {
        if (seen.has(stage)) return;
        seen.add(stage);
        return context.onStage?.(stage);
      },
    },
    reset: () => seen.clear(),
  };
}

const recordOf = (attempt: Attempt, isFix: boolean): CandidateRecord => ({
  name: attempt.name,
  code: attempt.code,
  png: attempt.render.ok ? attempt.render.png : null,
  stats: attempt.render.ok ? attempt.render.stats : null,
  score: attempt.verdict.score,
  pass: attempt.verdict.pass,
  stage: attempt.stage,
  isFix,
});

/**
 * The loop with several candidates: `candidateCount` generator calls from the same brief at once, each candidate rendered
 * in its own sandbox and (unless the engine flags it) verified as soon as it is drawn, then one fix turn on the best
 * one only, and best-of between the best candidate and its fix. The fix turn is only for a best candidate that is not
 * already good enough by the caller's own measure (`goodEnough`): a fix more often loses points than gains them, and
 * costs a model call, a render and a verification.
 */
export async function runCandidateLoop(
  context: LoopCore,
  brief: Brief,
  candidateCount: number,
  goodEnough: (winner: LoopWinner) => boolean,
): Promise<CandidateOutcome | null> {
  const print = context.print ?? console.log;
  const staging = reportingEachStageOnce(context);
  const session = `lampwarden-${brief.id}-${Array.from(brief.text.replace(/[^\p{L}\p{N}_]+/gu, "-"))
    .slice(0, 34)
    .join("")}`;
  const logFields = { bid: brief.id, cat: brief.category, brief: brief.text, render: RENDERED_WITH };
  const spriteName = slugify(brief.id);

  await staging.context.onStage?.("drawing");
  const generations = await Promise.all(
    Array.from({ length: candidateCount }, (_unused, index) =>
      generate(
        context,
        "gen",
        candidateMessages(brief, index),
        session,
        { ...logFields, candidate: index },
        GENERATOR_MAX_TOKENS,
      ),
    ),
  );
  const drawn = generations.flatMap((generation, index) =>
    generation.text === null ? [] : [{ index, generation, text: generation.text }],
  );
  if (drawn.length === 0) {
    print(`${brief.id} GEN FAILED ${generations[0]?.record.error}`);
    return null;
  }

  staging.reset();
  const attempts = await Promise.all(
    drawn.map((item) =>
      renderAndVerify(staging.context, extractCode(item.text), `${spriteName}-c${item.index}`, brief.text, session, {
        ...logFields,
        stage: "first",
        candidate: item.index,
      }),
    ),
  );
  const records = attempts.map((attempt) => recordOf(attempt, false));
  // the best candidate; ties go to the lower-numbered one
  let bestIndex = 0;
  for (const [index, attempt] of attempts.entries()) {
    if ((attempt.verdict.score ?? 0) > (attempts[bestIndex]?.verdict.score ?? 0)) bestIndex = index;
  }
  const first = attempts[bestIndex];
  const chosen = drawn[bestIndex];
  if (!first || !chosen) return null;
  const row: SpriteRow = { id: brief.id, brief: brief.text, session, gen: chosen.generation.record.rid };
  row.verify = first.requestIds;
  row.first_score = first.verdict.score;
  row.candidate_scores = attempts.map((attempt) => attempt.verdict.score);
  row.candidate_gen = drawn.map((item) => item.generation.record.rid);
  let best: { attempt: Attempt; which: "first" | "fixed" } = { attempt: first, which: "first" };
  print(`${brief.id} | candidates ${JSON.stringify(row.candidate_scores)} | ${describeAttempt(first)}`);
  const firstAttempt: LoopWinner | null = first.render.ok
    ? {
        which: "first",
        name: first.name,
        code: first.code,
        png: first.render.png,
        stats: first.render.stats,
        verdict: first.verdict,
      }
    : null;
  if (!firstAttempt || !goodEnough(firstAttempt)) {
    const fixMessages: ModelMessage[] = [
      ...candidateMessages(brief, chosen.index),
      { role: "assistant", content: chosen.text },
      { role: "user", content: correctionMessage(brief.text, first.verdict) },
    ];
    staging.reset();
    await staging.context.onStage?.("fixing");
    const fixCall = await generate(
      context,
      "fix",
      fixMessages,
      session,
      { ...logFields, fixes_verify: first.requestIds.slice(0, 1), candidate: chosen.index },
      FIX_MAX_TOKENS,
    );
    row.fix = fixCall.record.rid;
    if (fixCall.text !== null) {
      staging.reset();
      const fixed = await renderAndVerify(
        staging.context,
        extractCode(fixCall.text),
        `${spriteName}-fixed`,
        brief.text,
        session,
        { ...logFields, stage: "after_fix", candidate: chosen.index },
      );
      row.fixed_verify = fixed.requestIds;
      row.fixed_score = fixed.verdict.score;
      records.push(recordOf(fixed, true));
      print(`   fix ${fixCall.record.rid} | ${describeAttempt(fixed)}`);
      if ((fixed.verdict.score ?? 0) > (first.verdict.score ?? 0)) best = { attempt: fixed, which: "fixed" };
    }
  }
  const { attempt, which } = best;
  if (!attempt.render.ok) {
    print(`${brief.id} no renderable result`);
    return null;
  }
  row.final = which;
  row.score = attempt.verdict.score;
  row.passed = attempt.verdict.pass;
  row.issues = attempt.verdict.issues;
  row.rendered_with = RENDERED_WITH;
  const winner: LoopWinner = {
    which,
    name: attempt.name,
    code: attempt.code,
    png: attempt.render.png,
    stats: attempt.render.stats,
    verdict: attempt.verdict,
  };
  return { row, winner, candidates: records };
}
