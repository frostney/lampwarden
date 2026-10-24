// The contract of the Vercel Sandbox renderer, the only renderer: a build script and a name go in, the kit's stats and
// the 128 px PNG come out. Build code may come from a model, so everything read back from the sandbox (the stats line a
// runner prints, a batch's results file) is validated once, here.
import { z } from "zod";

/** The stats `render/runner.ts` prints for one sprite: the kit's `post()` stats plus fit. */
export const renderStatsSchema = z.object({
  name: z.string(),
  /** Render time inside the runner. */
  ms: z.number().optional(),
  fit: z.string(),
  snapped: z.number(),
  dropped: z.number(),
  coverage: z.number(),
  bbox: z.string(),
  outer: z.number(),
  inner: z.number(),
  clamped: z.number(),
  edge: z.number(),
  parts: z.number(),
  /** `ok`, or engine flags joined by `|` (`clipped_at_edge`, `too_small`, `too_big`, `too_short`). */
  flags: z.string(),
});

export type RenderStats = z.infer<typeof renderStatsSchema>;

export interface RenderRequest {
  /** The build script: `function build(k) { ... }` calling the kit's builders. */
  code: string;
  /** File-name safe: letters, digits, `_` and `-` (see `isSafeRenderArgument`). */
  name: string;
  /** Hero-style pose such as `walk3`, or an empty string. */
  pose: string;
}

export interface RenderedSprite {
  stats: RenderStats;
  /** The 128 px sprite as PNG bytes. */
  png: Uint8Array;
}

export type RenderResult = ({ ok: true } & RenderedSprite) | { ok: false; error: string };

/** What a manifest row and a log line record as the renderer. */
export const RENDERED_WITH = "vercel-sandbox";

/** `signal` cancels the render: its sandbox is stopped and the result is a failure. */
export type Renderer = (request: RenderRequest, signal?: AbortSignal) => Promise<RenderResult>;

/** The failure of a render that was cancelled or never started because the caller's signal had fired. */
export const RENDER_ABORTED = "render aborted";

/** The same renderer tied to `signal`: once it has fired nothing more is rendered, and a render in flight is cancelled. */
export function bindRenderSignal(render: Renderer, signal: AbortSignal): Renderer {
  return async (request, callSignal) =>
    signal.aborted
      ? { ok: false, error: RENDER_ABORTED }
      : render(request, callSignal ? AbortSignal.any([signal, callSignal]) : signal);
}

const SAFE_RENDER_ARGUMENT = /^[A-Za-z0-9_-]*$/;

/** Names and poses end up in file paths and a command line; only these characters may. */
export function isSafeRenderArgument(value: string): boolean {
  return SAFE_RENDER_ARGUMENT.test(value);
}

/** Why a request cannot be rendered, or null when it can. */
export function invalidRequestReason(request: RenderRequest): string | null {
  if (!request.name || !isSafeRenderArgument(request.name)) return `invalid sprite name: ${request.name}`;
  if (!isSafeRenderArgument(request.pose)) return `invalid pose: ${request.pose}`;
  return null;
}

/** Reads the stats from the last JSON-object line of a runner's standard output. */
export function parseStatsLine(standardOutput: string): RenderStats {
  const statsLine = standardOutput
    .trim()
    .split("\n")
    .findLast((line) => line.startsWith("{"));
  return renderStatsSchema.parse(JSON.parse(statsLine ?? "null"));
}

/** The one-line reason for a failed runner: the last `error:` / `SomeError:` line, not bun's trailing version banner. */
export function lastErrorLine(standardError: string): string {
  const lines = standardError
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Bun v"));
  const errorLine = lines.findLast((line) => /^(\w*Error|error)\b/.test(line)) ?? lines.at(-1);
  return errorLine || "error";
}

/**
 * Rejects with `message` when `work` has not settled after `milliseconds`. `work` is not cancelled by the race itself:
 * pass the `controller` that `work` listens to and it is aborted when the deadline passes (and when `work` rejects),
 * so what `work` started stops spending instead of running on after the caller has given up.
 */
export async function withDeadline<Result>(
  work: Promise<Result>,
  milliseconds: number,
  message: string,
  controller?: AbortController,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller?.abort(new Error(message));
      reject(new Error(message));
    }, milliseconds);
  });
  try {
    return await Promise.race([work, expiry]);
  } catch (error) {
    controller?.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** What `render/batch.ts` writes for one item; the sandbox is outside this process, so the file is validated. */
export const batchResultsSchema = z.object({
  items: z.array(
    z.object({
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
      standardOutput: z.string(),
      standardError: z.string(),
      png: z.string().nullable(),
      milliseconds: z.number(),
    }),
  ),
});
export type BatchItemOutcome = z.infer<typeof batchResultsSchema>["items"][number];

/** One item's outcome as a render result: the runner's stats and PNG, or the one-line reason it failed. */
export function interpretOutcome(outcome: BatchItemOutcome, deadlineMilliseconds: number): RenderResult {
  if (outcome.timedOut) return { ok: false, error: `render timed out after ${deadlineMilliseconds} ms` };
  if (outcome.exitCode !== 0) {
    // Bun reports a process killed by a signal (the kernel's out-of-memory kill) as a null exit code
    const reason =
      outcome.exitCode === 137 || outcome.exitCode === null
        ? "render killed (memory)"
        : lastErrorLine(outcome.standardError).slice(0, 300);
    return { ok: false, error: `exit ${outcome.exitCode}: ${reason}` };
  }
  if (outcome.png === null) return { ok: false, error: "render wrote no PNG" };
  try {
    return { ok: true, stats: parseStatsLine(outcome.standardOutput), png: Buffer.from(outcome.png, "base64") };
  } catch {
    return { ok: false, error: "render printed no valid stats" };
  }
}
