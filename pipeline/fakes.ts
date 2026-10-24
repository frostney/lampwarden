// Fakes for the creature tests (pipeline/ and src/server/creatures/): a Mubit that answers from a script (through the real client, so request shapes are the
// real ones), a renderer that returns a fixed sprite, and a clock. No network anywhere.
import { PixelImage } from "../tools/logo/image";
import { encodePng } from "../tools/logo/png";
import { createMubitClient, type MubitClient } from "./mubit";
import type { Renderer, RenderRequest, RenderResult, RenderStats } from "./render-types";

export const GOOD_CODE = "function build(k) {\n  humanoid(k, {});\n}";

export const CLEAN_STATS: RenderStats = {
  name: "creature",
  ms: 21,
  fit: "",
  snapped: 0,
  dropped: 0,
  coverage: 0.1,
  bbox: "30,20,90,106",
  outer: 200,
  inner: 80,
  clamped: 0,
  edge: 0,
  parts: 40,
  flags: "ok",
};

export function spritePng(): Uint8Array {
  const sprite = new PixelImage(8, 8);
  sprite.set(3, 3, [200, 100, 50, 255]);
  return encodePng(sprite);
}

export const briefJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "Brine hound",
    lore: "It follows the smell of lamp oil up the quay.",
    brief: "a sleek sea-hound with kelp-green fur and webbed paws",
    archetype: "skulker",
    modifiers: { speed: 1, toughness: -1, bite: 0, snuffing: 0 },
    ...overrides,
  });

export const verdictJson = (score: number) =>
  JSON.stringify({ pass: score >= 7, score, issues: ["too plain"], fix: "add a tail", lesson: "" });

export const fenced = (code: string) => `\`\`\`ts\n${code}\n\`\`\``;

const replyWith = (text: string, requestNumber: number) =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    }),
    { headers: { "x-middleware-request-id": `req-${requestNumber}` } },
  );

export interface FakeModel {
  client: MubitClient;
  /** Every request body sent to Mubit, parsed. */
  sent: Array<{ model: string; system: unknown; max_tokens: number; messages: unknown[]; temperature?: unknown }>;
  urls: string[];
}

/** A request as the fake sees it: which prompt it carries and the messages after it. */
export interface SentRequest {
  system: string;
  messages: unknown[];
}

/**
 * Mubit answering each request with the next scripted reply (a string), or failing with 500 for `null`; or, given a
 * function, answering each request from what it says (for tests where requests run side by side and arrive in no fixed order).
 */
export function fakeModel(script: Array<string | null> | ((request: SentRequest) => string | null)): FakeModel {
  const replies = Array.isArray(script) ? script : [];
  const sent: FakeModel["sent"] = [];
  const urls: string[] = [];
  const client = createMubitClient({
    apiKey: "test-key",
    sleep: async () => {},
    fetchImplementation: async (url, init) => {
      urls.push(url);
      sent.push(JSON.parse(String(init.body)));
      const body = sent[sent.length - 1];
      const systemBlocks = Array.isArray(body?.system) ? body.system : [];
      const system = systemBlocks.map((block: { text?: string }) => block.text ?? "").join("");
      if (!Array.isArray(script)) {
        const answer = script({ system, messages: body?.messages ?? [] });
        return answer === null ? new Response("overloaded", { status: 500 }) : replyWith(answer, sent.length);
      }
      if (replies.length === 0) throw new Error("the code made a request the test did not expect");
      const reply = replies.shift();
      if (reply === null || reply === undefined) return new Response("overloaded", { status: 500 });
      return replyWith(reply, sent.length);
    },
  });
  return { client, sent, urls };
}

export function fakeRenderer(result?: (request: RenderRequest) => RenderResult): {
  render: Renderer;
  requests: RenderRequest[];
} {
  const requests: RenderRequest[] = [];
  return {
    requests,
    render: async (request) => {
      requests.push(request);
      return result ? result(request) : { ok: true, stats: CLEAN_STATS, png: spritePng() };
    },
  };
}

/** A clock that only moves when told to. */
export function fakeClock(start = "2026-10-24T12:00:00.000Z") {
  let current = Date.parse(start);
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
  };
}
