// Stores one recorded night (inputs + timeline, no personal data) as a private blob, for testing and balancing.
import { put } from "@vercel/blob";
import { ENV } from "varlock/env";
import { playSchema } from "@/game/plays";

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
  const parsed = playSchema.safeParse(parsedJson);
  if (!parsed.success) return Response.json({ error: "not a play" }, { status: 400 });
  const play = parsed.data;
  const stored = JSON.stringify({
    ...play,
    build: ENV.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    receivedAt: new Date().toISOString(),
  });
  await put(`plays/${play.id.slice(0, 10)}/${play.id}.json`, stored, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return Response.json({ ok: true, id: play.id });
}
