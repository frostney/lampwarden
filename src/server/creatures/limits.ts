// Rate limits on starting a generation job: per visitor per hour, and per UTC day for the whole site. Reading the
// gallery is never limited. Visitors are told apart by a salted hash of their IP; the IP itself is never stored.
import { createHmac } from "node:crypto";

import type { StartLimits } from "./config";
import type { CreatureStore } from "./store";

const HOUR_MILLISECONDS = 3_600_000;

const IPV6_GROUPS = 8;
const IPV6_PREFIX_GROUPS = 4;

/** An embedded IPv4 tail ("1.2.3.4") as the two 16-bit groups it stands for, or null when it is not one. */
function ipv4TailGroups(part: string): number[] | null {
  const octets = part.split(".").map(Number);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(part) || octets.some((octet) => octet > 255)) {
    return null;
  }
  return [(octets[0] ?? 0) * 256 + (octets[1] ?? 0), (octets[2] ?? 0) * 256 + (octets[3] ?? 0)];
}

/** The 16-bit groups of one side of an IPv6 address's `::`, or null when a group is not hex. */
function sideGroups(text: string): number[] | null {
  if (text === "") {
    return [];
  }
  const groups: number[] = [];
  const parts = text.split(":");
  for (const [index, part] of parts.entries()) {
    const tail = index === parts.length - 1 && part.includes(".") ? ipv4TailGroups(part) : null;
    if (tail) {
      groups.push(...tail);
    } else if (/^[0-9a-f]{1,4}$/.test(part)) {
      groups.push(Number.parseInt(part, 16));
    } else {
      return null;
    }
  }
  return groups;
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, an embedded IPv4 tail turned into two groups), or null. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = sideGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? sideGroups(halves[1] ?? "") : [];
  if (!head || !tail) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === IPV6_GROUPS ? head : null;
  }
  const missing = IPV6_GROUPS - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null;
}

/**
 * What tells visitors apart: the address itself for IPv4 (and for an IPv4-mapped IPv6 address, which is an IPv4 client),
 * and the /64 prefix for any other IPv6 address, because one household or host is handed a whole /64 and each address in
 * it would otherwise be a new visitor, with its own hourly allowance and a share of the site's daily cap.
 */
export function visitorAddress(address: string | null): string {
  if (address === null) {
    return "unknown";
  }
  // a port may follow the address: "1.2.3.4:5555", "[2001:db8::1]:443"
  const text = address
    .trim()
    .toLowerCase()
    .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1")
    .replace(/^\[(.*)\](?::\d+)?$/, "$1");
  const unzoned = text.split("%")[0] ?? text;
  if (!unzoned.includes(":")) {
    return unzoned;
  }
  const groups = ipv6Groups(unzoned);
  if (!groups) {
    return unzoned;
  }
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${groups
    .slice(0, IPV6_PREFIX_GROUPS)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** A stable, non-reversible key for a visitor: HMAC-SHA256 of the visitor's address (visitorAddress) under the server's secret salt. */
export function visitorKey(address: string | null, salt: string): string {
  return createHmac("sha256", salt).update(visitorAddress(address)).digest("hex").slice(0, 32);
}

/** The client address Vercel puts first in x-forwarded-for (it overwrites any value the client sent). */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

export type StartDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** What the limits read of a store: the marks of past starts (the creature jobs', or the director's calls). */
export type StartLedger = Pick<CreatureStore, "visitorStartsBetween" | "startsOnDay">;

export async function checkStartLimits(
  store: StartLedger,
  now: Date,
  visitor: string,
  limits: StartLimits,
): Promise<StartDecision> {
  const recent = await store.visitorStartsBetween(visitor, new Date(now.getTime() - HOUR_MILLISECONDS), now);
  if (recent.length >= limits.perVisitorPerHour) {
    // the start that frees a place is the one `perVisitorPerHour` places from the newest
    const freesAt = (recent.at(-limits.perVisitorPerHour)?.getTime() ?? now.getTime()) + HOUR_MILLISECONDS;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)) };
  }
  if ((await store.startsOnDay(now.toISOString().slice(0, 10))) >= limits.perDay) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)) };
  }
  return { allowed: true };
}
