// Stores one recorded night (inputs + timeline, no personal data) as a private blob, for testing and balancing.
// Limited per visitor and per day, and idempotent: a second upload under the same id is answered as stored and writes
// nothing (src/server/plays/service.ts).
import { incomingPlay } from "@/game/plays";
import { clientAddress } from "@/server/creatures/limits";
import { createPlayUploadDeps } from "@/server/plays/deps";
import { savePlay } from "@/server/plays/service";

const MAX_BODY_LENGTH = 400_000;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY_LENGTH) return Response.json({ error: "too large" }, { status: 413 });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = incomingPlay.safeParse(parsedJson);
  if (!parsed.success) return Response.json({ error: "not a play" }, { status: 400 });
  const play = parsed.data;
  const saved = await savePlay(createPlayUploadDeps(), { play, ip: clientAddress(request.headers) });
  if (saved.kind === "limited")
    return Response.json(
      { error: "too many uploads" },
      { status: 429, headers: { "retry-after": String(saved.retryAfterSeconds) } },
    );
  return Response.json({ ok: true, id: play.id });
}
