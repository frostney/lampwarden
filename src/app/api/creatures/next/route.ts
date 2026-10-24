// POST /api/creatures/next {seen}: the newest gallery creature this player has not met, or a generation job to follow.
// The job runs in `after()` on this invocation, so `maxDuration` covers it: 300 s is the default on every plan under
// Fluid Compute, and a job gives up at 270 s (src/server/creatures/config.ts).
import { after } from "next/server";
import { nextCreatureRequestSchema } from "@/game/creature";
import { createServiceDeps } from "@/server/creatures/deps";
import { clientAddress } from "@/server/creatures/limits";
import { nextCreature } from "@/server/creatures/service";

// a literal, because Next reads it statically; routes.test.ts keeps it equal to JOB_MAX_DURATION_SECONDS
export const maxDuration = 300;

const MAX_BODY_LENGTH = 100_000;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_LENGTH) return Response.json({ error: "too large" }, { status: 413 });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = nextCreatureRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const result = await nextCreature(
    createServiceDeps((work) => after(work)),
    { seen: parsed.data.seen, ip: clientAddress(request.headers) },
  );
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
