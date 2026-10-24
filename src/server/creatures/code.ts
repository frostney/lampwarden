// The answer to GET /api/creatures/:id/code: a gallery creature's build code as text. The player's browser runs it in a
// worker (src/scene/creature-render.ts) after checking its SHA-256 against the creature's record. Ids are unique and a
// creature's code never changes, so the response is cached for good. It is plain text with nothing allowed to load or
// run from it, so a browser that is sent here shows text and does nothing else.
import type { CreatureStore } from "./store";

const CREATURE_ID = /^[a-z0-9-]{8,80}$/;
const NOT_CACHED = { "cache-control": "no-store" };

export async function codeResponse(store: Pick<CreatureStore, "getCode">, id: string): Promise<Response> {
  if (!CREATURE_ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const code = await store.getCode(id);
    if (code === null) return Response.json({ error: "not found" }, { status: 404, headers: NOT_CACHED });
    return new Response(code, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: NOT_CACHED });
  }
}
