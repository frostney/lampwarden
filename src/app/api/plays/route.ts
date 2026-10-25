// Stores one recorded night (inputs + timeline, no personal data) as a private blob, for testing and balancing.
// Limited per visitor and per day, and idempotent: a second upload under the same id is answered as stored and writes
// nothing (src/server/plays/service.ts).
import { playSchema } from "@/game/plays";
import { clientAddress } from "@/server/creatures/limits";
import { createPlayUploadDeps } from "@/server/plays/deps";
import { savePlay } from "@/server/plays/service";

const MAX_BODY_LENGTH = 400_000;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_LENGTH) {
    return Response.json({ error: "too large" }, { status: 413 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = playSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return Response.json({ error: "not a play" }, { status: 400 });
  }
  const play = parsed.data;
  let saved: Awaited<ReturnType<typeof savePlay>>;
  try {
    saved = await savePlay(createPlayUploadDeps(), { play, ip: clientAddress(request.headers) });
  } catch (error) {
    // the store did not answer (src/server/blob-client.ts): the game keeps the night queued and sends it again later
    console.error(
      JSON.stringify({ event: "play-upload-failed", kind: error instanceof Error ? error.name : "unknown" }),
    );
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (saved.kind === "limited") {
    return Response.json(
      { error: "too many uploads" },
      { status: 429, headers: { "retry-after": String(saved.retryAfterSeconds) } },
    );
  }
  return Response.json({ ok: true, id: play.id });
}
