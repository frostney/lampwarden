// The buildings this line has seen go up on the plaza: their ids, oldest first, sent to the buildings gallery as `seen` so
// each night asks for the newest one the line has not met (the creatures' bestiary, in legacy.ts, is the same for
// creatures). Kept apart from the legacy, which a recorded night carries and a replay rebuilds: a building is only ever
// drawn, so what has been raised is not part of a night.
import { z } from "zod";

const KEY = "lampwarden:raised:v1";
const RAISED_LIMIT = 500; // the most `seen` ids the gallery takes (nextBuildingRequestSchema)

const storedRaised = z.array(z.string()).catch([]);

/** A building goes up on the plaza the line is seeing: its id joins the list (once), and the oldest drop off past the limit. */
export function raise(raised: readonly string[], buildingId: string): string[] {
  if (raised.includes(buildingId)) return [...raised];
  return [...raised, buildingId].slice(-RAISED_LIMIT);
}

export function loadRaised(): string[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return [...new Set(storedRaised.parse(JSON.parse(raw)))].slice(-RAISED_LIMIT);
  } catch {
    /* corrupt or unavailable storage: nothing has been raised yet */
  }
  return [];
}

export function saveRaised(raised: readonly string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(raised));
  } catch {
    /* private mode etc. */
  }
}

export function clearRaised() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
