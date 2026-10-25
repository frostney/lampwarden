// The game's side of the buildings API (src/game/building.ts has the shapes): asking which building goes up on the plaza
// tonight, and following a job that is still making one. Answers come over the network, so they are parsed, not trusted;
// any failure is null, and the night simply has the plaza it always had.
import { z } from "zod";

import { SECONDS_PER_DAY } from "../lib/units";
import {
  BUILDING_API,
  type BuildingJob,
  buildingJobPath,
  buildingSchema,
  type NextBuildingRequest,
  type NextBuildingResponse,
} from "./building";
import { JOB_STEPS } from "./creature";
import { followUntilDone, REQUEST_TIMEOUT, readAnswer, type WaitOptions } from "./gallery-api";

// What the game reads of the contract's answers (the compiler holds these to the shapes in building.ts). A job id goes
// into a URL, so it has to look like one.
const nextBuildingAnswer: z.ZodType<NextBuildingResponse> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), building: buildingSchema }),
  z.object({ kind: z.literal("generating"), jobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
  z.object({
    kind: z.literal("none"),
    reason: z.enum(["rate-limited", "unavailable", "busy"]),
    retryAfterSeconds: z.number().min(0).max(SECONDS_PER_DAY).exactOptional(),
  }),
]);

type JobAnswer = Pick<BuildingJob, "step"> & { building?: z.infer<typeof buildingSchema> };
const jobAnswer: z.ZodType<JobAnswer> = z
  .object({ step: z.enum(JOB_STEPS), building: buildingSchema.optional() })
  .transform(({ step, building }) => (building ? { step, building } : { step }));

// POST /api/buildings/next with the ids of the buildings the line has seen go up
export function askForBuilding(seen: string[]): Promise<NextBuildingResponse | null> {
  const request: NextBuildingRequest = { seen };
  return readAnswer(
    fetch(`${BUILDING_API}/next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    }),
    nextBuildingAnswer,
  );
}

// GET /api/buildings/jobs/:jobId
function followJob(jobId: string): Promise<JobAnswer | null> {
  return readAnswer(fetch(buildingJobPath(jobId), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }), jobAnswer);
}

// Follows a job every couple of seconds until it finishes: the building when it is done, null when it failed, was let go,
// took too long, or stopped mattering.
export function waitForBuildingJob(jobId: string, options: WaitOptions) {
  return followUntilDone(async () => {
    const job = await followJob(jobId);
    return job ? { step: job.step, ...(job.building ? { made: job.building } : {}) } : null;
  }, options);
}
