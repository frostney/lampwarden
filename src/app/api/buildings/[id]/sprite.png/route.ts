// GET /api/buildings/:id/sprite.png: a gallery building's sprite from the private Blob store. Ids are unique and a
// sprite never changes, so the response is cached for good.
import { createServiceDeps } from "@/server/creatures/deps";

const BUILDING_ID = /^[a-z0-9-]{8,80}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!BUILDING_ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const sprite = await createServiceDeps(() => {}).store.getBuildingSprite(id);
    if (!sprite)
      return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    return new Response(sprite, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
