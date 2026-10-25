// What the game's side of the creatures API (creature-api.ts) and of the buildings API (building-api.ts) share: reading an
// answer that came over the network (parsed, never trusted; any failure is null) and following a generation job until it
// is done.
import type { z } from "zod";

import type { JobStep } from "./creature";

export const REQUEST_TIMEOUT = 8000; // ms: the server answers from its gallery or starts a job, never waits for one

export async function readAnswer<Schema extends z.ZodType>(
  request: Promise<Response>,
  schema: Schema,
): Promise<z.output<Schema> | null> {
  try {
    const parsed = schema.safeParse(await (await request).json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const POLL_INTERVAL = 2000; // ms between looks at a job
const GIVE_UP_AFTER = 300_000; // ms, five minutes: a night is long over by then
const MISSES_ALLOWED = 3; // answers in a row that may fail before the job is let go

export interface WaitOptions {
  onStep: (step: JobStep) => void;
  isCurrent: () => boolean; // false once the answer no longer matters (a night began, or the sea was asked again)
  pollInterval?: number;
  giveUpAfter?: number;
}

/** A job as the client reads it: where it is, and what it made once it has made it. */
export interface FollowedJob<Made> {
  step: JobStep;
  made?: Made;
}

// Follows a job every couple of seconds until it finishes: what it made when it is done, null when it failed, was let go,
// took too long, or stopped mattering.
export async function followUntilDone<Made>(
  follow: () => Promise<FollowedJob<Made> | null>,
  options: WaitOptions,
): Promise<Made | null> {
  const { onStep, isCurrent, pollInterval = POLL_INTERVAL, giveUpAfter = GIVE_UP_AFTER } = options;
  const deadline = Date.now() + giveUpAfter;
  let misses = 0;
  while (isCurrent() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    if (!isCurrent()) {
      return null;
    }
    const job = await follow();
    if (!job) {
      misses++;
      if (misses >= MISSES_ALLOWED) {
        return null;
      }
      continue;
    }
    misses = 0;
    if (job.step === "done") {
      return job.made ?? null;
    }
    if (job.step === "failed") {
      return null;
    }
    onStep(job.step);
  }
  return null;
}
