// POST /api/director {playId}: the live director. The server reads the recorded night from the plays store (the game
// uploads it as the night ends), asks Mubit for bounded balance tweaks for the player's next night, and answers with the
// clamped decision, or with the rules' decision (source "rules") when the model did not answer in time. See
// src/server/director/service.ts and docs/DIRECTOR.md.
import { type DirectorAnswer, directorRequestSchema } from "@/game/director-api";
import { clientAddress } from "@/server/creatures/limits";
import { createDirectorDeps } from "@/server/director/deps";
import { decide } from "@/server/director/service";

// a literal, because Next reads it statically; routes.test.ts keeps it equal to DIRECTOR_MAX_DURATION_SECONDS
export const maxDuration = 30;
export const runtime = "nodejs";

const MAX_BODY_LENGTH = 1000;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_LENGTH) return Response.json({ error: "too large" }, { status: 413 });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = directorRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const result = await decide(createDirectorDeps(), { playId: parsed.data.playId, ip: clientAddress(request.headers) });
  if (result.kind === "no-play") return Response.json({ error: "play not found" }, { status: 404 });
  const answer: DirectorAnswer = {
    decision: result.decision,
    ...(result.fallback ? { fallback: result.fallback } : {}),
  };
  return Response.json(answer, { headers: { "cache-control": "no-store" } });
}
