import { describe, expect, test } from "bun:test";
import { createMubitClient, type FetchImplementation, MUBIT_MESSAGES_URL, MUBIT_MODEL } from "./mubit";

const TEST_KEY = "test-key-not-a-secret";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "x-middleware-request-id": "req-1", ...headers } });
}

function clientWith(responses: Array<Response | Error>) {
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
    expect(request?.url).toBe(MUBIT_MESSAGES_URL);
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toEqual({
      "x-api-key": TEST_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(request?.init.body));
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "metadata", "model", "system"]);
    expect(body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 1500,
      system: "system prompt",
      messages: [{ role: "user", content: "Brief: lamp" }],
      metadata: { user_id: "session-1" },
    });
    expect(body.model).toBe(MUBIT_MODEL);
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
