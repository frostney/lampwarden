// The game's side of the creatures API (src/game/creature.ts has the shapes): asking which creature the sea sends
// tonight, and following a job that is still making one. Answers come over the network, so they are parsed, not
// trusted; any failure is null, and the night simply has no new creature.
import { z } from "zod";

import { SECONDS_PER_DAY } from "../lib/units";
import {
  CREATURE_API,
  type CreatureJob,
  creatureJobPath,
  JOB_STEPS,
  type NextCreatureRequest,
  type NextCreatureResponse,
} from "./creature";
import { type CreatureRecord, creatureRecordSchema } from "./creature-frames";
import { followUntilDone, REQUEST_TIMEOUT, readAnswer, type WaitOptions } from "./gallery-api";

// What the game reads of the contract's answers (the compiler holds these to the shapes in creature.ts). A creature is
// read with its frame counts, when it has them (creature-frames.ts). A job id goes into a URL, so it has to look like one.
const nextCreatureAnswer: z.ZodType<NextCreatureResponse> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), creature: creatureRecordSchema }),
  z.object({ kind: z.literal("generating"), jobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
  z.object({
    kind: z.literal("none"),
    reason: z.enum(["rate-limited", "unavailable"]),
    retryAfterSeconds: z.number().min(0).max(SECONDS_PER_DAY).exactOptional(),
  }),
]);

type JobAnswer = Pick<CreatureJob, "step"> & { creature?: CreatureRecord };
const jobAnswer: z.ZodType<JobAnswer> = z
  .object({ step: z.enum(JOB_STEPS), creature: creatureRecordSchema.optional() })
  .transform(({ step, creature }) => (creature ? { step, creature } : { step }));

// POST /api/creatures/next with the ids the line has met
export function askForCreature(seen: string[]): Promise<NextCreatureResponse | null> {
  const request: NextCreatureRequest = { seen };
  return readAnswer(
    fetch(`${CREATURE_API}/next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    }),
    nextCreatureAnswer,
  );
}

// GET /api/creatures/jobs/:jobId
function followJob(jobId: string): Promise<JobAnswer | null> {
  return readAnswer(fetch(creatureJobPath(jobId), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }), jobAnswer);
}

// Follows a job every couple of seconds until it finishes: the creature when it is done, null when it failed, was
// let go, took too long, or stopped mattering.
export function waitForJob(jobId: string, options: WaitOptions): Promise<CreatureRecord | null> {
  return followUntilDone(async () => {
    const job = await followJob(jobId);
    return job ? { step: job.step, ...(job.creature ? { made: job.creature } : {}) } : null;
  }, options);
}
