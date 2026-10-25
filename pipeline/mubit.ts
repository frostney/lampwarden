// The Mubit client: every model call of the pipeline goes to https://api.mubit.ai/anthropic/v1/messages (Anthropic
// pass-through) with model claude-opus-5-5, and never sends `temperature`. The key is passed in by the caller (read from
// MUBIT_API_KEY in run.ts), goes only into the x-api-key header, and appears in no log row or error.
import { createHash } from "node:crypto";

import { z } from "zod";

export const MUBIT_MESSAGES_URL = "https://api.mubit.ai/anthropic/v1/messages";
export const MUBIT_MODEL = "claude-opus-5-5";
const ANTHROPIC_VERSION = "2023-06-01";
// too many requests, the server's faults, and 529 (overloaded): worth one more try
const RETRYABLE = {
  tooMany: 429,
  serverError: 500,
  badGateway: 502,
  unavailable: 503,
  gatewayTimeout: 504,
  overloaded: 529,
};
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set(Object.values(RETRYABLE));
const SHORT_SHA = 12;
const ERROR_KEPT = 200; // characters of an error kept for the log
const CLOCK_TIME = 8; // "16:11:46", the start of toTimeString()
const REQUEST_TIMEOUT_MILLISECONDS = 240_000;
const RETRY_DELAY_MILLISECONDS = 5000;
const ERROR_BODY_LIMIT = 400;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** A system prompt block; `cache_control` marks the end of the stable prefix the API may cache (5 minute TTL). */
export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** The request body, exactly as it is sent. There is deliberately no `temperature`. */
export interface MubitRequestBody {
  model: typeof MUBIT_MODEL;
  max_tokens: number;
  /** A plain string, or with prompt caching on one cacheable text block. */
  system: string | SystemBlock[];
  messages: ModelMessage[];
  metadata: { user_id: string };
}

const replySchema = z.object({
  content: z.array(z.object({ text: z.string().optional() })).optional(),
  usage: z
    .object({
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish(),
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish(),
    })
    .optional(),
  stop_reason: z.string().nullish(),
});

type MubitReply = z.infer<typeof replySchema>;

interface AttemptSummary {
  status: number | null;
  rid: string | null;
  ms: number;
  error: string | null;
}

/**
 * One row of pipeline/runs/run.jsonl. The keys are the on-disk format (the same names as before the TypeScript port),
 * so existing logs and new ones read the same. No key and no header is ever stored.
 */
export interface CallRecord {
  ts: string;
  task: string;
  status: number | null;
  /** The `x-middleware-request-id` response header. */
  rid: string | null;
  ms: number;
  session: string;
  model: string;
  system_sha: string;
  in_tokens?: number | null | undefined;
  out_tokens?: number | null | undefined;
  /** Prompt caching: tokens written to / read from the cache (a read is billed at 0.05x on claude-opus-5-5). */
  cache_creation_input_tokens?: number | null | undefined;
  cache_read_input_tokens?: number | null | undefined;
  stop?: string | null | undefined;
  error?: string | null | undefined;
  first_try?: AttemptSummary | undefined;
  /** Pipeline-level fields (stage, sample, truncation notes, the verdict) are added by the caller. */
  [field: string]: unknown;
}

export interface ModelCall {
  record: CallRecord;
  /** The reply's text, or null when the call failed. */
  text: string | null;
}

/** The parts of `fetch` the client uses, so tests can inject a fake. */
export type FetchImplementation = (url: string, init: RequestInit) => Promise<Response>;

export interface MubitClientOptions {
  apiKey: string;
  /**
   * Mark the system prompt cacheable (`cache_control: {type: "ephemeral"}`). The prompt must be at least 512 tokens
   * for claude-opus-5-5 to be cached; a shorter one is silently not cached. Default on.
   */
  promptCaching?: boolean;
  /** How long one request may take (default 240 s: a sprite's generation). The director's answer is worth 8 s. */
  requestTimeoutMilliseconds?: number;
  /** Retry once on 429/5xx/timeout (default on). A caller with a deadline of its own turns it off. */
  retry?: boolean;
  fetchImplementation?: FetchImplementation;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface MubitClient {
  /** One model call with one retry on 429/5xx/timeout (unless the client was made without it). Never throws: a failed call has `text: null` and `record.error`. */
  call(
    task: string,
    system: string,
    messages: ModelMessage[],
    session: string,
    logFields: Record<string, unknown>,
    maxTokens: number,
    /** Cancels the call: an in-flight request is aborted and neither it nor a retry is started after this fires. */
    signal?: AbortSignal,
  ): Promise<ModelCall>;
}

/** The same client with every call tied to `signal`, so a caller with a deadline stops all the model calls it started. */
export function bindMubitSignal(client: MubitClient, signal: AbortSignal): MubitClient {
  return {
    call: (task, system, messages, session, logFields, maxTokens, callSignal) =>
      client.call(
        task,
        system,
        messages,
        session,
        logFields,
        maxTokens,
        callSignal ? AbortSignal.any([signal, callSignal]) : signal,
      ),
  };
}

export function shortSha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, SHORT_SHA);
}

interface SentRequest extends AttemptSummary {
  reply: MubitReply | null;
}

export function createMubitClient(options: MubitClientOptions): MubitClient {
  const fetchImplementation: FetchImplementation = options.fetchImplementation ?? ((url, init) => fetch(url, init));
  const promptCaching = options.promptCaching ?? true;
  const requestTimeout = options.requestTimeoutMilliseconds ?? REQUEST_TIMEOUT_MILLISECONDS;
  const retry = options.retry ?? true;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  async function send(
    system: string,
    messages: ModelMessage[],
    session: string,
    maxTokens: number,
    signal: AbortSignal | undefined,
  ): Promise<SentRequest> {
    const body: MubitRequestBody = {
      model: MUBIT_MODEL,
      max_tokens: maxTokens,
      system: promptCaching ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
      messages,
      metadata: { user_id: session },
    };
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    // an abort before the request leaves means nothing is sent
    if (signal?.aborted) {
      return { status: null, rid: null, ms: 0, reply: null, error: "aborted" };
    }
    try {
      const response = await fetchImplementation(MUBIT_MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(requestTimeout), signal])
          : AbortSignal.timeout(requestTimeout),
      });
      const rid = response.headers.get("x-middleware-request-id");
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, ERROR_BODY_LIMIT);
        return { status: response.status, rid, ms: elapsed(), reply: null, error: errorText };
      }
      const reply = replySchema.parse(await response.json());
      return { status: response.status, rid, ms: elapsed(), reply, error: null };
    } catch (error) {
      // any other failure (network, timeout, a reply that is not a message) is logged and retried once like a 5xx
      return { status: null, rid: null, ms: elapsed(), reply: null, error: String(error).slice(0, ERROR_KEPT) };
    }
  }

  return {
    async call(task, system, messages, session, logFields, maxTokens, signal) {
      let attempt = await send(system, messages, session, maxTokens, signal);
      let firstTry: AttemptSummary | undefined;
      // no retry once the caller has aborted: it has given up on the call, and a retry would spend after the deadline
      if (retry && !signal?.aborted && (attempt.status === null || RETRYABLE_STATUSES.has(attempt.status))) {
        firstTry = { status: attempt.status, rid: attempt.rid, ms: attempt.ms, error: attempt.error };
        await sleep(RETRY_DELAY_MILLISECONDS);
        attempt = await send(system, messages, session, maxTokens, signal);
      }
      const record: CallRecord = {
        ts: new Date().toTimeString().slice(0, CLOCK_TIME),
        task,
        status: attempt.status,
        rid: attempt.rid,
        ms: attempt.ms,
        session,
        model: MUBIT_MODEL,
        system_sha: shortSha(system),
        ...logFields,
      };
      if (firstTry) {
        record.first_try = firstTry;
      }
      if (!attempt.reply) {
        record.error = attempt.error;
        return { record, text: null };
      }
      record.in_tokens = attempt.reply.usage?.input_tokens;
      record.out_tokens = attempt.reply.usage?.output_tokens;
      record.cache_creation_input_tokens = attempt.reply.usage?.cache_creation_input_tokens;
      record.cache_read_input_tokens = attempt.reply.usage?.cache_read_input_tokens;
      record.stop = attempt.reply.stop_reason;
      return { record, text: (attempt.reply.content ?? []).map((block) => block.text ?? "").join("") };
    },
  };
}
