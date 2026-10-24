// What POST /api/plays does once the request is a valid play, with the store injected so the tests need no network.
// A play is stored once: a second upload under the same id (a retry whose first answer was lost) is answered as stored
// and writes nothing. Uploads are limited per visitor per hour and for the whole site per UTC day, by the salted address
// hash the director and the creature routes use; without a salt (local development) every upload is accepted.
import type { StartLimits } from "../creatures/config";
import { checkStartLimits, visitorKey } from "../creatures/limits";
import type { PlayStore } from "./store";

/** A night lasts at least 40 s, so one player sends well under 90 an hour; 120 leaves room for retries and shared addresses. */
export const UPLOADS_PER_VISITOR_PER_HOUR = 120;
/** Every upload is kept, so the site's daily total is capped: more than any day of real play, far less than a flood. */
export const UPLOADS_PER_DAY = 3000;

export interface PlayUploadDeps {
  store: PlayStore;
  now: () => Date;
  /** Keys the visitors of the limits; null where there is none, which turns the limits off. */
  rateSalt: string | null;
  limits: StartLimits;
  /** The build that took the upload, kept with the recording. */
  build: string;
}

export type PlayUploadResult = { kind: "stored" | "exists" } | { kind: "limited"; retryAfterSeconds: number };

export async function savePlay(
  deps: PlayUploadDeps,
  input: { play: { id: string }; ip: string | null },
): Promise<PlayUploadResult> {
  const now = deps.now();
  const visitor = deps.rateSalt === null ? null : visitorKey(input.ip, deps.rateSalt);
  if (visitor !== null) {
    const decision = await checkStartLimits(deps.store, now, visitor, deps.limits);
    if (!decision.allowed) return { kind: "limited", retryAfterSeconds: decision.retryAfterSeconds };
  }
  const stored = JSON.stringify({ ...input.play, build: deps.build, receivedAt: now.toISOString() });
  if (!(await deps.store.putIfAbsent(input.play.id, stored))) return { kind: "exists" };
  // the recording is kept whether or not it can be counted
  if (visitor !== null) await deps.store.recordUpload(visitor, input.play.id, now).catch(() => undefined);
  return { kind: "stored" };
}
