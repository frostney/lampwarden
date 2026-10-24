// The game's side of the creatures API (src/game/creature.ts has the shapes): asking which creature the sea sends
// tonight, and following a job that is still making one. Answers come over the network, so they are parsed, not
// trusted; any failure is null, and the night simply has no new creature.
import { z } from "zod";
import {
  CREATURE_API,
  type Creature,
  type CreatureJob,
  creatureJobPath,
  creatureSchema,
  JOB_STEPS,
  type NextCreatureRequest,
  type NextCreatureResponse,
} from "./creature";

const REQUEST_TIMEOUT = 8000; // ms: the server answers from its gallery or starts a job, never waits for one

// What the game reads of the contract's answers (the compiler holds these to the shapes in creature.ts). A job id goes
// into a URL, so it has to look like one.
const nextCreatureAnswer: z.ZodType<NextCreatureResponse> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), creature: creatureSchema }),
  z.object({ kind: z.literal("generating"), jobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
  z.object({ kind: z.literal("none"), reason: z.enum(["rate-limited", "unavailable"]) }),
]);

type JobAnswer = Pick<CreatureJob, "step" | "creature">;
const jobAnswer: z.ZodType<JobAnswer> = z
  .object({ step: z.enum(JOB_STEPS), creature: creatureSchema.optional() })
  .transform(({ step, creature }) => (creature ? { step, creature } : { step }));

async function read<Schema extends z.ZodType>(
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

// POST /api/creatures/next with the ids the line has met
export function askForCreature(seen: string[]): Promise<NextCreatureResponse | null> {
  const request: NextCreatureRequest = { seen };
  return read(
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
  return read(fetch(creatureJobPath(jobId), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }), jobAnswer);
}

const POLL_INTERVAL = 2000; // ms between looks at a job
const GIVE_UP_AFTER = 5 * 60_000; // ms: a night is long over by then
const MISSES_ALLOWED = 3; // answers in a row that may fail before the job is let go

interface WaitOptions {
  onStep: (step: JobAnswer["step"]) => void;
  isCurrent: () => boolean; // false once the answer no longer matters (a night began, or the sea was asked again)
  pollInterval?: number;
  giveUpAfter?: number;
}

// Follows a job every couple of seconds until it finishes: the creature when it is done, null when it failed, was
// let go, took too long, or stopped mattering.
export async function waitForJob(jobId: string, options: WaitOptions): Promise<Creature | null> {
  const { onStep, isCurrent, pollInterval = POLL_INTERVAL, giveUpAfter = GIVE_UP_AFTER } = options;
  const deadline = Date.now() + giveUpAfter;
  let misses = 0;
  while (isCurrent() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    if (!isCurrent()) return null;
    const job = await followJob(jobId);
    if (!job) {
      misses++;
      if (misses >= MISSES_ALLOWED) return null;
      continue;
    }
    misses = 0;
    if (job.step === "done") return job.creature ?? null;
    if (job.step === "failed") return null;
    onStep(job.step);
  }
  return null;
}
