// What a new player has been shown: the opening scene, and the practice night their first "Light the lamps" opens. Kept
// apart from the legacy (it outlives a bloodline: starting a new one does not teach the watch again) and from any night.
// Either one counts as shown once it was seen through or skipped; the title can show both again.
import { z } from "zod";
import type { Legacy } from "./legacy";

const KEY = "lampwarden:welcome:v1";

const welcomeSchema = z.object({ opening: z.boolean().catch(false), practice: z.boolean().catch(false) });
export type Welcome = z.infer<typeof welcomeSchema>;

export function loadWelcome(): Welcome {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return welcomeSchema.parse(JSON.parse(raw));
  } catch {
    /* corrupt or unavailable storage: nothing has been shown yet */
  }
  return { opening: false, practice: false };
}

export function markWelcome(welcome: Welcome, shown: keyof Welcome): Welcome {
  const next = { ...welcome, [shown]: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. */
  }
  return next;
}

// A line that has played a night is no new player's, whatever the storage says: a player from before the welcome existed
// is not shown it unasked.
export const isNewLine = (legacy: Pick<Legacy, "generation" | "night" | "bestNight">) =>
  legacy.generation === 1 && legacy.night === 1 && legacy.bestNight === 0;
