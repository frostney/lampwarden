// Recorded plays: what the API routes that store and serve them share.
import { z } from "zod";
import { recordedCreatureSchema } from "./creature";

export const PLAY_ID = /^[0-9-]{19}-[a-z0-9]{1,10}$/;

// A sim fingerprint: the first 12 hex digits of a hash of the sources that decide how a night plays out
// (tools/sim-fingerprint). A play records the one it was played on.
export const SIM_FINGERPRINT = /^[0-9a-f]{12}$/;

// The fingerprint of the sim this build runs: computed by next.config.ts and inlined into the client and server bundles.
// Undefined outside Next (bun test, scripts), where callers pass the fingerprint they mean.
export const RUNNING_SIM: string | undefined = process.env.NEXT_PUBLIC_SIM_FINGERPRINT;

// A recording replays exactly only on the sim it was played on. A play from before fingerprints has no `sim` and is
// of an unknown version: it is not replayed either, because a replay that diverges shows a night nobody played.
export function replaysExactlyOn(play: { sim?: string | undefined }, runningSim: string | undefined): boolean {
  return play.sim !== undefined && play.sim === runningSim;
}

// What the summary line needs from a recording. A play is stored as sent, so one fetched for replay may not have it.
const summarisedPlay = z.object({
  legacy: z.object({ night: z.number(), heir: z.object({ name: z.string() }) }),
  outcome: z.string().nullable(),
  stats: z.object({ kills: z.number(), lampsLost: z.number() }),
  timeline: z.array(z.unknown()),
});

// A recorded night in one line (who, which night, how it ended), or null for a recording too odd to describe.
export function describeNight(play: unknown): string | null {
  const parsed = summarisedPlay.safeParse(play);
  if (!parsed.success) return null;
  const { legacy, outcome, stats, timeline } = parsed.data;
  return `${legacy.heir.name}, night ${legacy.night}: ${outcome ?? "abandoned"}, ${stats.kills} slain, ${stats.lampsLost} lamps snuffed, ${timeline.length} s.`;
}

// The shape a client must send to /api/plays; everything else in the recording is stored as sent.
export const incomingPlay = z.looseObject({
  v: z.literal(1),
  id: z.string().regex(PLAY_ID),
  seed: z.number().int(),
  inputs: z.array(z.array(z.number()).length(7)),
  creature: recordedCreatureSchema.optional(), // the creature from the sea the night met; plays from before have none
  wallSeconds: z.number().min(0).max(86_400).optional(), // real seconds the night took; plays from before have none
  sim: z.string().regex(SIM_FINGERPRINT).optional(), // the sim the night was played on; plays from before have none
});
