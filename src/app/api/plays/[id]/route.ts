// Serves one recorded night back for in-game replay (?replay=<id>).
import { get } from "@vercel/blob";

import { PLAY_ID } from "@/game/plays";
import { HTTP_OK } from "@/lib/units";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!PLAY_ID.test(id)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const blob = await get(`plays/${id.slice(0, 10)}/${id}.json`, { access: "private" });
  if (blob?.statusCode !== HTTP_OK) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return new Response(blob.stream, { headers: { "content-type": "application/json" } });
}
