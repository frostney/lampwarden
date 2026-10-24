// The game's side of POST /api/director: the request and answer shapes the route shares with the game, and asking for
// the decision about a night that just ended. The answer comes over the network, so it is parsed, not trusted; any
// failure is null, and the night simply keeps the rules' decision.
import { z } from "zod";
import { directorSchema, FALLBACK_REASONS } from "./director";
import { PLAY_ID } from "./plays";

export const DIRECTOR_API = "/api/director";

/** The client waits this long (ms) for the whole route: the play's lookup and the model's 8 s. */
const REQUEST_TIMEOUT = 15_000;

export const directorRequestSchema = z.object({ playId: z.string().regex(PLAY_ID) });
type DirectorRequest = z.infer<typeof directorRequestSchema>;

const directorAnswerSchema = z.object({
  decision: directorSchema,
  fallback: z.enum(FALLBACK_REASONS).optional(),
});

export type DirectorAnswer = z.infer<typeof directorAnswerSchema>;

/** What the route said, or null: the route was unreachable, answered with an error, or sent nonsense. `signal` stops the wait. */
export async function askDirector(playId: string, signal: AbortSignal): Promise<DirectorAnswer | null> {
  try {
    const request: DirectorRequest = { playId };
    const response = await fetch(DIRECTOR_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]),
    });
    if (!response.ok) return null;
    const parsed = directorAnswerSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
