// The contract every renderer (local, QuickJS, Shotcup, Vercel Sandbox, boat.dev) fulfils: a build script and a name go in, the
// kit's stats and the 128 px PNG come out. Build code may come from a model, so everything a renderer reads back from
// outside the process (the stats line a sandbox prints) is validated once, here.
import { z } from "zod";

/** The stats `render/run_local.ts` (or the generated Shotcup main) prints for one sprite: the kit's `post()` stats plus fit. */
export const renderStatsSchema = z.object({
  name: z.string(),
  /** Render time inside the runner; the Shotcup main does not time itself. */
  ms: z.number().optional(),
  /** Shotcup only: engine time of the whole run the sprite was rendered in. */
  engineMilliseconds: z.number().optional(),
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

export const RENDERER_NAMES = ["local", "quickjs", "shotcup", "vercel", "boat"] as const;
export type RendererName = (typeof RENDERER_NAMES)[number];

export type Renderer = (request: RenderRequest) => Promise<RenderResult>;

const SAFE_RENDER_ARGUMENT = /^[A-Za-z0-9_-]*$/;

/** Names and poses end up in file paths, generated source and a shell command; only these characters may. */
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

/** Rejects with `message` when `work` has not settled after `milliseconds`; `work` itself is left to clean up after itself. */
export async function withDeadline<Result>(
  work: Promise<Result>,
  milliseconds: number,
  message: string,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
