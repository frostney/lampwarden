import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { createMubitClient, type FetchImplementation } from "./mubit";
import type { RenderRequest, RenderResult, RenderStats } from "./render-types";
import {
  correctionMessage,
  engineFlagIssues,
  formatFixed,
  type LoopContext,
  parseVerdict,
  processBrief,
  slugify,
} from "./sprite-loop";

const GENERATOR_PROMPT = "GENERATOR PROMPT";
const VERIFIER_PROMPT = "VERIFIER PROMPT";
const GOOD_CODE = "function build(k) {\n  lamp(k, {});\n}";
const FIXED_CODE = "function build(k) {\n  lamp(k, { lit: true });\n}";

const STATS: RenderStats = {
  name: "lamp",
  ms: 21,
  fit: "",
  snapped: 0,
  dropped: 0,
  coverage: 0.084,
  bbox: "42,27,88,105",
  outer: 234,
  inner: 90,
  clamped: 0,
  edge: 0,
  parts: 78,
  flags: "ok",
};

function spritePng(): Uint8Array {
  const sprite = new PixelImage(8, 8);
  sprite.set(3, 3, [200, 100, 50, 255]);
  sprite.set(4, 3, [200, 100, 50, 128]);
  return encodePng(sprite);
}

interface SentRequest {
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
  max_tokens: number;
  messages: Array<{ role: string; content: unknown }>;
}

let directory: string;
let sent: SentRequest[];
let rendered: RenderRequest[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "sprite-loop-test-"));
  sent = [];
  rendered = [];
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** A model that answers each request from `answers`, in order, as Anthropic's messages API would. */
function contextWith(
  answers: Array<{ text: string; stop?: string }>,
  renderResult: (request: RenderRequest) => RenderResult = () => ({ ok: true, stats: STATS, png: spritePng() }),
): LoopContext {
  const fetchImplementation: FetchImplementation = async (_url, init) => {
    sent.push(JSON.parse(String(init.body)));
    const answer = answers.shift();
    if (!answer) throw new Error("the loop made a request the test did not expect");
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: answer.text }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: answer.stop ?? "end_turn",
      }),
      { headers: { "x-middleware-request-id": `req-${sent.length}` } },
    );
  };
  return {
    model: createMubitClient({ apiKey: "test-key", fetchImplementation, sleep: async () => {} }),
    render: async (request) => {
      rendered.push(request);
      return renderResult(request);
    },
    rendererName: "local",
    pose: "",
    generatorPrompt: GENERATOR_PROMPT,
    verifierPrompt: VERIFIER_PROMPT,
    outputDirectory: join(directory, "out"),
    workDirectory: join(directory, "work"),
    logPath: join(directory, "run.jsonl"),
    print: () => {},
  };
}

/** A system prompt as it is sent with prompt caching on: one block marked as the end of the cacheable prefix. */
const cachedSystem = (prompt: string) => [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }];
const verdictJson = (score: number, extra = "") =>
  `{"pass": ${score >= 7}, "score": ${score}, "issues": ["too plain"], "fix": "add a flame", "lesson": ""${extra}}`;
const fenced = (code: string) => `\`\`\`ts\n${code}\n\`\`\``;
const brief = { id: "lamp on a post", category: "prop", text: "a lamp on a post" };

describe("the generate-verify loop's requests", () => {
  test("a borderline score is verified twice and averaged; each request has the documented shape", async () => {
    const context = contextWith([{ text: fenced(GOOD_CODE) }, { text: verdictJson(6.5) }, { text: verdictJson(7.5) }]);
    const row = await processBrief(context, brief);
    expect(sent.map((request) => request.max_tokens)).toEqual([1500, 1800, 1800]);
    expect(sent.map((request) => request.system)).toEqual([
      cachedSystem(GENERATOR_PROMPT),
      cachedSystem(VERIFIER_PROMPT),
      cachedSystem(VERIFIER_PROMPT),
    ]);
    expect(sent[0]?.messages).toEqual([{ role: "user", content: "Brief: a lamp on a post" }]);

    const verifierContent = sent[1]?.messages[0]?.content;
    expect(Array.isArray(verifierContent)).toBe(true);
    if (!Array.isArray(verifierContent)) return;
    expect(verifierContent[0]).toEqual({
      type: "text",
      text: `BRIEF: a lamp on a post\n\nENGINE STATS: bbox 42,27,88,105, coverage 8%, parts 78, flags ok\n\nGENERATOR CODE:\n\`\`\`ts\n${GOOD_CODE}\n\`\`\`\n\nRENDERED SPRITE (image):`,
    });
    expect(verifierContent[1].type).toBe("image");
    expect(verifierContent[1].source.media_type).toBe("image/png");
    const magnified = decodePng(Buffer.from(verifierContent[1].source.data, "base64"));
    expect([magnified.width, magnified.height]).toEqual([32, 32]);
    expect(magnified.get(0, 0)).toEqual([46, 46, 56, 255]); // transparent pixels sit on the verifier's backdrop
    expect(magnified.get(12, 12)).toEqual([200, 100, 50, 255]); // each sprite pixel is a 4x4 block

    expect(row).toMatchObject({ final: "first", passed: true, score: 7, rendered_with: "local" });
    expect(row?.verify).toEqual(["req-2", "req-3"]);
    expect(sent).toHaveLength(3); // passing after averaging: no fix call
  });

  test("a failing sprite gets one fix turn carrying the verifier's issues, and the better attempt wins", async () => {
    const context = contextWith([
      { text: fenced(GOOD_CODE) },
      { text: verdictJson(4) },
      { text: fenced(FIXED_CODE) },
      { text: verdictJson(8) },
    ]);
    const row = await processBrief(context, brief);
    const fixRequest = sent[2];
    expect(fixRequest?.max_tokens).toBe(3000);
    expect(fixRequest?.system).toEqual(cachedSystem(GENERATOR_PROMPT));
    expect(fixRequest?.messages).toEqual([
      { role: "user", content: "Brief: a lamp on a post" },
      { role: "assistant", content: fenced(GOOD_CODE) },
      {
        role: "user",
        content:
          "Your sprite was rendered and rejected.\nBrief: a lamp on a post\nScore: 4/10\nIssues:\n- too plain\nRequested fix: add a flame\n\nReply with the complete corrected build(k) only, keeping what already works.",
      },
    ]);
    expect(row).toMatchObject({ final: "fixed", passed: true, first_score: 4, fixed_score: 8, score: 8 });
    expect(readFileSync(join(directory, "out", "lamp-on-a-post.ts"), "utf8")).toBe(`${FIXED_CODE}\n`);
    expect(decodePng(readFileSync(join(directory, "out", "lamp-on-a-post.png"))).width).toBe(8);
  });

  test("ties go to the first attempt", async () => {
    const context = contextWith([
      { text: fenced(GOOD_CODE) },
      { text: verdictJson(5) },
      { text: fenced(FIXED_CODE) },
      { text: verdictJson(5) },
    ]);
    expect(await processBrief(context, brief)).toMatchObject({ final: "first" });
  });

  test("a truncated generator reply is retried once with a bigger budget", async () => {
    const context = contextWith([
      { text: "function build(k) {\n  lamp(k, {", stop: "max_tokens" },
      { text: fenced(GOOD_CODE) },
      { text: verdictJson(9) },
    ]);
    await processBrief(context, brief);
    expect(sent.map((request) => request.max_tokens)).toEqual([1500, 4000, 1800]);
    expect(sent[0]?.messages).toEqual(sent[1]?.messages ?? []);
  });
});

describe("what never reaches the renderer or the verifier", () => {
  test("banned identifiers are rejected before any renderer runs, and the fix turn is told why", async () => {
    const context = contextWith([
      { text: fenced("function build(k) { fetch('https://example.com'); }") },
      { text: fenced(GOOD_CODE) },
      { text: verdictJson(9) },
    ]);
    const row = await processBrief(context, brief);
    expect(rendered.map((request) => request.code)).toEqual([GOOD_CODE]);
    expect(JSON.stringify(sent[1]?.messages)).toContain("code did not run: rejected: banned identifier fetch");
    expect(row).toMatchObject({ final: "fixed", first_score: 0 });
  });

  test("engine flags fail a sprite without a verifier call", async () => {
    const clipped: RenderResult = { ok: true, stats: { ...STATS, flags: "clipped_at_edge" }, png: spritePng() };
    const context = contextWith(
      [{ text: fenced(GOOD_CODE) }, { text: fenced(FIXED_CODE) }, { text: verdictJson(9) }],
      (request) => (request.name.endsWith("-fixed") ? { ok: true, stats: STATS, png: spritePng() } : clipped),
    );
    const row = await processBrief(context, brief);
    expect(sent.map((request) => request.system[0]?.text)).toEqual([
      GENERATOR_PROMPT,
      GENERATOR_PROMPT,
      VERIFIER_PROMPT,
    ]);
    expect(row).toMatchObject({ first_score: 0, final: "fixed" });
  });

  test("a sprite that never renders leaves no output", async () => {
    const context = contextWith([{ text: fenced(GOOD_CODE) }, { text: fenced(FIXED_CODE) }], () => ({
      ok: false,
      error: "render timed out",
    }));
    expect(await processBrief(context, brief)).toBeNull();
    expect(existsSync(join(directory, "out", "manifest.json"))).toBe(false);
  });
});

describe("the manifest", () => {
  test("keeps the file's other keys and sprites and writes the row keys in the committed order", async () => {
    const outputDirectory = join(directory, "out");
    const context = contextWith([{ text: fenced(GOOD_CODE) }, { text: verdictJson(9) }]);
    await Bun.write(
      join(outputDirectory, "manifest.json"),
      JSON.stringify({ setting: "greek", note: "kept", sprites: { other: { brief: "x" } } }),
    );
    await processBrief(context, brief);
    const manifest = JSON.parse(readFileSync(join(outputDirectory, "manifest.json"), "utf8"));
    expect(Object.keys(manifest)).toEqual(["setting", "note", "sprites"]);
    expect(manifest.sprites.other).toEqual({ brief: "x" });
    expect(Object.keys(manifest.sprites["lamp-on-a-post"])).toEqual([
      "brief",
      "file",
      "code",
      "session",
      "gen",
      "verify",
      "first_score",
      "final",
      "score",
      "passed",
      "issues",
      "rendered_with",
    ]);
  });

  test("the run log has one row per model call and no key", async () => {
    const context = contextWith([{ text: fenced(GOOD_CODE) }, { text: verdictJson(9) }]);
    await processBrief(context, brief);
    const lines = readFileSync(join(directory, "run.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({
      task: "verify",
      stage: "first",
      sample: 1,
      verdict: { score: 9 },
    });
    expect(lines.join("\n")).not.toContain("test-key");
  });
});

describe("text the model reads", () => {
  test("percentages round exact ties to even, like the Python pipeline did", () => {
    expect(formatFixed(12.5, 0)).toBe("12");
    expect(formatFixed(13.5, 0)).toBe("14");
    expect(formatFixed(12.25, 1)).toBe("12.2");
    expect(formatFixed(0.35, 1)).toBe("0.3"); // not a tie in binary
    expect(formatFixed(8.4, 0)).toBe("8");
  });

  test("engine flags become issues", () => {
    expect(engineFlagIssues({ ...STATS, flags: "too_small|too_short", coverage: 0.0125 })).toEqual([
      "sprite covers only 1.2% of the canvas: make it bigger",
      "sprite is under 24 px tall: make it taller",
    ]);
    expect(engineFlagIssues(STATS)).toEqual([]);
  });

  test("an averaged score is shown with a decimal, a missing one as None", () => {
    const base = { pass: false, issues: [], fix: "", lesson: "" };
    expect(correctionMessage("b", { ...base, score: 6, scores: [6, 6] })).toContain("Score: 6.0/10");
    expect(correctionMessage("b", { ...base, score: null })).toContain("Score: None/10");
  });

  test("a verdict is read from the first brace to the last, and a non-number score cannot pass", () => {
    expect(parseVerdict(`Here you go: ${verdictJson(8)} done`)).toMatchObject({ pass: true, score: 8 });
    expect(parseVerdict('{"pass": true, "score": "9", "issues": []}')).toMatchObject({ pass: false, score: null });
    expect(parseVerdict("no json here")).toBeNull();
  });

  test("slugs are lower-case words joined by dashes, at most 48 characters", () => {
    expect(slugify("  A Lamp, on a POST!  ")).toBe("a-lamp-on-a-post");
    expect(slugify("x".repeat(60))).toHaveLength(48);
  });
});
