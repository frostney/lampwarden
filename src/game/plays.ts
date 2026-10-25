// Recorded plays: what the API routes that store and serve them share.
import { z } from "zod";

import { SEXES } from "../scene/assets";
import { recordedCreatureSchema } from "./creature";
import { TRAITS, type TraitId } from "./legacy";
import type { Play } from "./recording";
import { nightLength } from "./sim";

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

// Enough of a stored play to tell whether it is a recording and which sim it was played on, before deciding to replay it.
export const playVersion = z.object({ v: z.literal(1), sim: z.string().optional() });

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
  if (!parsed.success) {
    return null;
  }
  const { legacy, outcome, stats, timeline } = parsed.data;
  return `${legacy.heir.name}, night ${legacy.night}: ${outcome ?? "abandoned"}, ${stats.kills} slain, ${stats.lampsLost} lamps snuffed, ${timeline.length} s.`;
}

// The longest night in steps (60 a second), and what a recording of one can hold: an input row per step at most, a
// timeline row per second. A sent play past these is not a night this game played.
const MAX_STEPS = nightLength(Number.POSITIVE_INFINITY) * 60 + 60;
const MAX_TIMELINE_ROWS = Math.ceil(MAX_STEPS / 60);

const count = z.number().int().min(0);
const traitId = z.custom<TraitId>((value) => typeof value === "string" && Object.hasOwn(TRAITS, value));

// A whole recorded night, as the Recorder makes it: what /api/plays stores (anything else sent is dropped) and what a
// replay accepts, so a play that would not replay is refused at the door, and one that is stored replays without
// crashing. `legacy.levels` and `legacy.director` are read leniently by legacyOf, as plays from before an upgrade or the
// director lack them.
export const playSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(PLAY_ID),
  session: z.string().max(80),
  build: z.string().max(40),
  sim: z.string().regex(SIM_FINGERPRINT).optional(), // the sim the night was played on; plays from before have none
  startedAt: z.string().max(40),
  seed: z.number().int(),
  legacy: z.object({
    night: z.number().int().min(1),
    generation: z.number().int().min(1),
    tide: z.number().min(0.6).max(2),
    heir: z.object({ name: z.string().max(40), sex: z.enum(SEXES), trait: traitId }),
    levels: z.record(z.string(), z.number()),
    director: z.unknown().optional(),
  }),
  creature: recordedCreatureSchema.optional(), // the creature from the sea the night met; plays from before have none
  inputs: z.array(z.tuple([count, z.number(), z.number(), count, count, z.number(), z.number()])).max(MAX_STEPS),
  timeline: z.array(z.tuple([count, count, count, z.number(), count, count])).max(MAX_TIMELINE_ROWS),
  steps: count.max(MAX_STEPS),
  outcome: z.enum(["dawn", "dark", "fallen"]).nullable(),
  stats: z.object({
    kills: count,
    lampsLost: count,
    hpLost: z.number(),
    time: z.number(),
    oilEarned: z.number(),
    hp: z.number(),
    maxHp: z.number(),
    lit: count,
  }),
  hiddenSeconds: z.number().min(0).max(86_400).optional(), // seconds the tab was hidden in the night; plays from before have none
  replay: z.object({ endsMatch: z.boolean() }).optional(), // filled in when a recording is verified by replay
}) satisfies z.ZodType<Play>;
