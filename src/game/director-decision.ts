// The part of the live director a night is played under: the decision's shape and bounds, the rules' own decision, and
// how a stored decision is read back (a save, a recorded play). A recorded night replays from this (replay.ts:
// directorFrom), so this file is covered by the sim fingerprint. What only the server and the model's reply need
// (cleanLine, parseProposal, clampProposal, checkedDecision) lives in director.ts, outside the fingerprint, so a change to
// how a reply is read does not retire recorded nights. Keep this file to what a replay reads.
import { z } from "zod";

/** The director may move the tide this far from the one the rules would pick. */
export const TIDE_SPAN = 0.15;
export const TIDE_MIN = 0.6;
export const TIDE_MAX = 2;
export const MIX_MIN = 0.5;
export const MIX_MAX = 2;
export const CREATURE_SHARE_MIN = 0.1;
export const CREATURE_SHARE_MAX = 0.4;
/** What the creature's share of the spawns was before the director could change it. */
export const DEFAULT_CREATURE_SHARE = 0.25;
export const LINE_MAX = 90;

/** How much more or less often each hand-made monster comes, against the sim's own weights (1 is unchanged). */
export interface Mix {
  satyr: number;
  cyclops: number;
  harpy: number;
}
export const EVEN_MIX: Mix = { satyr: 1, cyclops: 1, harpy: 1 };

/**
 * Whether the player was there (src/game/engagement.ts): "engaged", "idle" (hardly moved or acted), "paused" (most of the
 * real time away), or "left" (the night did not finish). Only an engaged night is evidence that a night was too hard.
 */
const ENGAGEMENTS = ["engaged", "idle", "paused", "left"] as const;
export type EngagementKind = (typeof ENGAGEMENTS)[number];
/** After a night that was not engaged nothing gets easier: the tide at least the rules', each weight at least 1, the share at least the default. */
export const mayEase = (engagement: EngagementKind | undefined) => engagement === undefined || engagement === "engaged";

export interface Director {
  source: "mubit" | "rules";
  /** The tide the night is played at: the same number as `Legacy.tide`, which is the one the sim reads. */
  tide: number;
  /** The tide the rules picked after the same night; `tide` stays within TIDE_SPAN of it. */
  rulesTide: number;
  mix: Mix;
  creatureShare: number;
  /** The sea's answer shown to the player: plain text, at most LINE_MAX characters. Empty for the rules. */
  line: string;
  /** The night this was decided after (0 before the first). */
  decidedAfterNight: number;
  /** The recorded play whose data it answers, so the next call can find what the model said about it. */
  playId?: string | undefined;
  /** How engaged the player was in the night this answers; a decision after a night that was not engaged never eases. Old saves have none. */
  engagement?: EngagementKind | undefined;
}

// Letters of any script (the sea may speak a word of Greek), digits, spaces and plain punctuation: no markup, no links.
const LINE_CHARACTERS = /^[\p{L}\p{N} .,;:!?'’\-–—…()]*$/u;

/** The stored form of a decision, as the legacy and a recorded play carry it. Validates everything the bounds name. */
export const directorSchema = z
  .object({
    source: z.enum(["mubit", "rules"]),
    tide: z.number().min(TIDE_MIN).max(TIDE_MAX),
    rulesTide: z.number().min(TIDE_MIN).max(TIDE_MAX),
    mix: z.object({
      satyr: z.number().min(MIX_MIN).max(MIX_MAX),
      cyclops: z.number().min(MIX_MIN).max(MIX_MAX),
      harpy: z.number().min(MIX_MIN).max(MIX_MAX),
    }),
    creatureShare: z.number().min(CREATURE_SHARE_MIN).max(CREATURE_SHARE_MAX),
    line: z.string().max(LINE_MAX).regex(LINE_CHARACTERS),
    decidedAfterNight: z.number().int().min(0),
    playId: z
      .string()
      .regex(/^[0-9a-z-]{1,40}$/)
      .optional(),
    engagement: z.enum(ENGAGEMENTS).optional(),
  })
  .refine((director) => Math.abs(director.tide - director.rulesTide) <= TIDE_SPAN + 1e-9, {
    message: "the tide strays too far from the rules' tide",
  })
  .refine(
    (director) =>
      mayEase(director.engagement) ||
      (director.tide >= director.rulesTide - 1e-9 &&
        director.mix.satyr >= 1 &&
        director.mix.cyclops >= 1 &&
        director.mix.harpy >= 1 &&
        director.creatureShare >= DEFAULT_CREATURE_SHARE - 1e-9),
    { message: "a night that was not engaged is not eased" },
  );

/** What the rules decide: the tide they picked, an even mix, the old creature share, and nothing to say. */
export function rulesDirector(
  rulesTide: number,
  decidedAfterNight: number,
  playId?: string,
  engagement?: EngagementKind,
): Director {
  return {
    source: "rules",
    tide: rulesTide,
    rulesTide,
    mix: { ...EVEN_MIX },
    creatureShare: DEFAULT_CREATURE_SHARE,
    line: "",
    decidedAfterNight,
    ...(playId ? { playId } : {}),
    ...(engagement ? { engagement } : {}),
  };
}

/**
 * The director a save or a recording carries, as far as it can be trusted: one that does not validate, claims to be the
 * rules' with other numbers, or whose tide is not the legacy's (the tide the sim will read) is the rules' instead.
 * Anything from before the director existed is the rules' too.
 */
export function directorFrom(stored: unknown, tide: number, night: number): Director {
  const fallback = rulesDirector(tide, Math.max(0, night - 1));
  const parsed = directorSchema.safeParse(stored);
  if (!parsed.success) {
    return fallback;
  }
  const { data } = parsed;
  if (data.tide !== tide) {
    return fallback;
  }
  return data.source === "rules" ? rulesDirector(tide, data.decidedAfterNight, data.playId, data.engagement) : data;
}
