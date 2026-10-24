// Serves one recorded night back for in-game replay (?replay=<id>).
import { get } from "@vercel/blob";

const ID = /^[0-9-]{19}-[a-z0-9]{1,10}$/;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const r = await get(`plays/${id.slice(0, 10)}/${id}.json`, { access: "private" });
  if (!r || r.statusCode !== 200) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(r.stream, { headers: { "content-type": "application/json" } });
}
