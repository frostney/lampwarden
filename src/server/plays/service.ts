// What POST /api/plays does once the request is a valid play, with the store injected so the tests need no network.
// A night is sent more than once under one id: a snapshot when the tab is hidden, then the finished night, and a retry of
// either. The most complete one is kept: an upload for an id already stored replaces it only when it has more steps (or
// is the finished night where the stored one is not), and an identical or older one changes nothing. A finished night is
// final, only an upload from the browser that recorded the night (its session; one without storage sends the shared
// "anon", which protects nothing) can replace it, and an id takes at most MAX_WRITES_PER_PLAY writes besides the finished
// night's, so one id cannot be rewritten without end. Every one of them is answered as taken. Only the first write of an
// id counts against the limits, and past a limit the finished night of a snapshot already stored still lands. Uploads
// are limited per visitor per hour and for the whole site per UTC day, by the salted address hash the director and the
// creature routes use; without a salt (local development) every upload is accepted.
import { z } from "zod";
import type { StartLimits } from "../creatures/config";
import { checkStartLimits, visitorKey } from "../creatures/limits";
import type { PlayStore } from "./store";

/**
 * A night lasts at least 28 s, so a player who spent no time at the dawn panel could send about 130 nights an hour; with
 * the panel, the shop and the title it is well under 100, each night one first write (a snapshot and the finished night of a
 * night are one id, and only its first write counts). 120 leaves room for retries and for several players behind one
 * address. It stays where it was through every change of the nights' length: it and the site's 3000 a day are spend
 * limits the owner sets.
 */
export const UPLOADS_PER_VISITOR_PER_HOUR = 120;
/** Every upload is kept, so the site's daily total is capped: more than any day of real play, far less than a flood. */
export const UPLOADS_PER_DAY = 3000;

/**
 * The most writes one id takes before its night is finished: the first and the snapshots after it (one each time the tab
 * is hidden or closed, and their retries). The finished night of a snapshot always lands on top of them.
 */
export const MAX_WRITES_PER_PLAY = 12;

/** How often an upload that lost a race with another write of its id reads and decides again. */
const REPLACE_ATTEMPTS = 3;

export interface PlayUploadDeps {
  store: PlayStore;
  now: () => Date;
  /** Keys the visitors of the limits; null where there is none, which turns the limits off. */
  rateSalt: string | null;
  limits: StartLimits;
  /** The build that took the upload, kept with the recording. */
  build: string;
}

/** stored: the first write of the id; replaced: a more complete play for it; exists: the stored one was kept. */
export type PlayUploadResult =
  | { kind: "stored" | "replaced" | "exists" }
  | { kind: "limited"; retryAfterSeconds: number };

// How far a recording got: its steps, and whether the night ended (a snapshot of a night in progress has no outcome); the
// tab that recorded it; and, once stored, how many times it was written.
const progressSchema = z.looseObject({
  steps: z.number(),
  outcome: z.string().nullable(),
  session: z.string().optional(),
  writes: z.number().optional(),
});
type Progress = z.infer<typeof progressSchema>;

const progressOf = (play: unknown): Progress => {
  const parsed = progressSchema.safeParse(play);
  return parsed.success ? parsed.data : { steps: 0, outcome: null };
};

/** Whether the stored recording stays: it is finished, at least as complete as the one that came in, or not its tab's. */
function keepsStored(stored: Progress, incoming: Progress): boolean {
  if (stored.outcome !== null) return true; // a finished night is final
  // a recording from before sessions has none, and gives way as it did then
  if (stored.session !== undefined && stored.session !== incoming.session) return true;
  if (incoming.outcome !== null) return incoming.steps < stored.steps; // the finished night, also at the snapshot's step
  if ((stored.writes ?? 1) >= MAX_WRITES_PER_PLAY) return true;
  return stored.steps >= incoming.steps;
}

function parseStored(json: string): Progress | null {
  try {
    const parsed = progressSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keeps the more complete of the stored recording and the incoming one (`written`: as it would be written, its nth time). */
async function settle(
  deps: PlayUploadDeps,
  id: string,
  written: (writes: number) => string,
  incoming: Progress,
  mayCreate: boolean,
): Promise<PlayUploadResult> {
  for (let attempt = 0; attempt < REPLACE_ATTEMPTS; attempt++) {
    const current = await deps.store.read(id);
    if (!current) {
      // gone between the put and the read: as if the id were new
      if (!mayCreate || !(await deps.store.putIfAbsent(id, written(1)))) continue;
      return { kind: "stored" };
    }
    const earlier = parseStored(current.json);
    if (earlier && keepsStored(earlier, incoming)) return { kind: "exists" };
    if (await deps.store.replace(id, written((earlier?.writes ?? 1) + 1), current.version)) return { kind: "replaced" };
  }
  return { kind: "exists" };
}

export async function savePlay(
  deps: PlayUploadDeps,
  input: { play: { id: string }; ip: string | null },
): Promise<PlayUploadResult> {
  const now = deps.now();
  const { id } = input.play;
  const written = (writes: number) =>
    JSON.stringify({ ...input.play, build: deps.build, receivedAt: now.toISOString(), writes });
  const incoming = progressOf(input.play);
  const visitor = deps.rateSalt === null ? null : visitorKey(input.ip, deps.rateSalt);
  if (visitor !== null) {
    const decision = await checkStartLimits(deps.store, now, visitor, deps.limits);
    if (!decision.allowed) {
      // Past a limit nothing new is taken, but the finished night of a snapshot already stored still lands: it is the
      // same id, written once more, and only a snapshot gives way to it.
      const current = await deps.store.read(id);
      const earlier = current && parseStored(current.json);
      if (earlier && earlier.outcome === null && incoming.outcome !== null)
        return settle(deps, id, written, incoming, false);
      return { kind: "limited", retryAfterSeconds: decision.retryAfterSeconds };
    }
  }
  if (await deps.store.putIfAbsent(id, written(1))) {
    // the recording is kept whether or not it can be counted
    if (visitor !== null) await deps.store.recordUpload(visitor, id, now).catch(() => undefined);
    return { kind: "stored" };
  }
  return settle(deps, id, written, incoming, true);
}
