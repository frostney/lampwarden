// GET /api/creatures/:id/atlas.png: the animation atlas of a gallery creature that has frames, from the private Blob
// store (the layout is in src/game/creature-frames.ts). Ids are unique and an atlas never changes, so the response is
// cached for good, in the browser and in Vercel's CDN, as the sprite is. A creature without an atlas answers 404.
import { ignore } from "@/lib/ignore";
import { createServiceDeps } from "@/server/creatures/deps";

const CREATURE_ID = /^[a-z0-9-]{8,80}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!CREATURE_ID.test(id)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const atlas = await createServiceDeps(ignore).store.getAtlas(id);
    if (!atlas) {
      return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return new Response(atlas, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
        "cdn-cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
