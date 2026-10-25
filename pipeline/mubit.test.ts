import { describe, expect, test } from "bun:test";
import { createMubitClient, type FetchImplementation } from "./mubit";

const TEST_KEY = "test-key-not-a-secret";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "x-middleware-request-id": "req-1", ...headers } });
}

function clientWith(responses: Array<Response | Error>, promptCaching?: boolean) {
  const requests: CapturedRequest[] = [];
  const sleeps: number[] = [];
  const fetchImplementation: FetchImplementation = async (url, init) => {
    requests.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createMubitClient({
    apiKey: TEST_KEY,
    ...(promptCaching === undefined ? {} : { promptCaching }),
    fetchImplementation,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });
  return { client, requests, sleeps };
}

const okReply = {
  content: [{ type: "text", text: "hello" }],
  usage: { input_tokens: 10, output_tokens: 2 },
  stop_reason: "end_turn",
};

describe("Mubit request", () => {
  test("goes to the Mubit messages URL with the pinned model, headers and body keys, and no temperature", async () => {
    const { client, requests } = clientWith([reply(200, okReply)]);
    const call = await client.call(
      "gen",
      "system prompt",
      [{ role: "user", content: "Brief: lamp" }],
      "session-1",
      { bid: "lamp" },
      1500,
    );
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://api.mubit.ai/anthropic/v1/messages");
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toEqual({
      "x-api-key": TEST_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(request?.init.body));
    expect(body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 1500,
      system: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Brief: lamp" }],
      metadata: { user_id: "session-1" },
    });
    expect(call.text).toBe("hello");
    expect(call.record).toMatchObject({
      task: "gen",
      status: 200,
      rid: "req-1",
      session: "session-1",
      bid: "lamp",
      in_tokens: 10,
      out_tokens: 2,
      stop: "end_turn",
    });
  });

  test("with prompt caching off the system prompt is a plain string, as run.py sent it", async () => {
    const { client, requests } = clientWith([reply(200, okReply)], false);
    await client.call("gen", "system prompt", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(JSON.parse(String(requests[0]?.init.body)).system).toBe("system prompt");
  });

  test("logs the cache tokens next to the other token counts", async () => {
    const cachedReply = {
      ...okReply,
      usage: { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 5400 },
    };
    const { client } = clientWith([reply(200, cachedReply)]);
    const call = await client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(call.record).toMatchObject({
      in_tokens: 12,
      out_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5400,
    });
  });

  test("never puts the key in the log row", async () => {
    const { client } = clientWith([reply(500, { error: "boom" }), reply(200, okReply)]);
    const call = await client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(JSON.stringify(call.record)).not.toContain(TEST_KEY);
  });
});

describe("Mubit retries", () => {
  test("retries once after 5 s on 529 and records the first try", async () => {
    const { client, requests, sleeps } = clientWith([reply(529, { error: "overloaded" }), reply(200, okReply)]);
    const call = await client.call("verify", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([5000]);
    expect(call.text).toBe("hello");
    expect(call.record.first_try).toMatchObject({ status: 529, rid: "req-1" });
  });

  test("retries a network failure, and reports the second failure instead of throwing", async () => {
    const { client, requests } = clientWith([new Error("reset"), new Error("reset again")]);
    const call = await client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(requests).toHaveLength(2);
    expect(call.text).toBeNull();
    expect(call.record.status).toBeNull();
    expect(call.record.error).toContain("reset again");
  });

  test("does not retry a client error", async () => {
    const { client, requests, sleeps } = clientWith([reply(400, { error: "bad request" })]);
    const call = await client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(call.text).toBeNull();
    expect(call.record.status).toBe(400);
    expect(call.record.error).toContain("bad request");
  });
});

describe("Mubit abort", () => {
  const ask = (client: ReturnType<typeof clientWith>["client"], signal: AbortSignal) =>
    client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100, signal);

  test("a signal that has already fired sends nothing and does not retry", async () => {
    const { client, requests, sleeps } = clientWith([reply(200, okReply)]);
    const call = await ask(client, AbortSignal.abort());
    expect(requests).toHaveLength(0);
    expect(sleeps).toEqual([]);
    expect(call.text).toBeNull();
    expect(call.record.error).toBe("aborted");
  });

  test("the request in flight sees the abort, and the failure that follows is not retried", async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const sleeps: number[] = [];
    const client = createMubitClient({
      apiKey: TEST_KEY,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      fetchImplementation: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error("the request carries no signal");
          seen.push(signal);
          signal.addEventListener("abort", () => reject(new Error("the operation was aborted")), { once: true });
        }),
    });
    const pending = ask(client, controller.signal);
    controller.abort();
    const call = await pending;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
    expect(sleeps).toEqual([]);
    expect(call.text).toBeNull();
    expect(call.record.error).toContain("aborted");
  });

  test("an abort during the wait before the retry stops the retry from being sent", async () => {
    const controller = new AbortController();
    const requests: string[] = [];
    const client = createMubitClient({
      apiKey: TEST_KEY,
      sleep: async () => controller.abort(),
      fetchImplementation: async () => {
        requests.push("sent");
        return reply(529, { error: "overloaded" });
      },
    });
    const call = await ask(client, controller.signal);
    expect(requests).toEqual(["sent"]);
    expect(call.text).toBeNull();
  });

  test("a call without a signal still carries its own timeout", async () => {
    const { client, requests } = clientWith([reply(200, okReply)]);
    await client.call("gen", "system", [{ role: "user", content: "x" }], "session", {}, 100);
    expect(requests[0]?.init.signal?.aborted).toBe(false);
  });
});
