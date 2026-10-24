// Rate limits on starting a generation job: per visitor per hour, and per UTC day for the whole site. Reading the
// gallery is never limited. Visitors are told apart by a salted hash of their IP; the IP itself is never stored.
import { createHmac } from "node:crypto";
import type { StartLimits } from "./config";
import type { CreatureStore } from "./store";

const HOUR_MILLISECONDS = 3_600_000;

/** A stable, non-reversible key for a visitor: HMAC-SHA256 of the IP under the server's secret salt. */
export function visitorKey(address: string | null, salt: string): string {
  return createHmac("sha256", salt)
    .update(address ?? "unknown")
    .digest("hex")
    .slice(0, 32);
}

/** The client address Vercel puts first in x-forwarded-for (it overwrites any value the client sent). */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

export type StartDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkStartLimits(
  store: CreatureStore,
  now: Date,
  visitor: string,
  limits: StartLimits,
): Promise<StartDecision> {
  const recent = await store.visitorStartsBetween(visitor, new Date(now.getTime() - HOUR_MILLISECONDS), now);
  if (recent.length >= limits.perVisitorPerHour) {
    // the start that frees a place is the one `perVisitorPerHour` places from the newest
    const freesAt = (recent[recent.length - limits.perVisitorPerHour]?.getTime() ?? now.getTime()) + HOUR_MILLISECONDS;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)) };
  }
  if ((await store.startsOnDay(now.toISOString().slice(0, 10))) >= limits.perDay) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)) };
  }
  return { allowed: true };
}
