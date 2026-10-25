// Serves one recorded night back for in-game replay (?replay=<id>). It is read from the store uncached, because a
// snapshot stored under the id can still give way to the finished night (src/server/plays/service.ts), and it goes out
// without the session it was sent from: only an upload from that session can replace the stored night.
import { z } from "zod";

import { PLAY_ID } from "@/game/plays";
import { createBlobPlayStore } from "@/server/plays/store.blob";

// a stored recording as far as this route reads it: an object (the game validates the rest as a play)
const storedRecording = z.looseObject({});

function parsedOrNull(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!PLAY_ID.test(id)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const stored = await createBlobPlayStore().read(id);
    const recording = stored && storedRecording.safeParse(parsedOrNull(stored.json));
    if (!recording?.success) {
      return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    const { session: _session, ...shared } = recording.data;
    return Response.json({ ...shared, session: "" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "play-read-failed", kind: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
