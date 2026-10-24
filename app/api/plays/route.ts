// Stores one recorded night (inputs + timeline, no personal data) as a private blob, for testing and balancing.
import { put } from "@vercel/blob";

const ID = /^[0-9-]{19}-[a-z0-9]{1,10}$/;
const MAX = 400_000;

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX) return Response.json({ error: "too large" }, { status: 413 });
  let p: { v?: number; id?: string; inputs?: unknown; seed?: unknown };
  try { p = JSON.parse(text); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (p.v !== 1 || typeof p.id !== "string" || !ID.test(p.id) || !Array.isArray(p.inputs) || typeof p.seed !== "number")
    return Response.json({ error: "not a play" }, { status: 400 });
  const body = JSON.stringify({ ...p, build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev", receivedAt: new Date().toISOString() });
  await put(`plays/${p.id.slice(0, 10)}/${p.id}.json`, body, { access: "private", contentType: "application/json", addRandomSuffix: false });
  return Response.json({ ok: true, id: p.id });
}
