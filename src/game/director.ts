// The live director's contract: what it may change about the next night, how far, and how an answer is made safe. The
// server (src/server/director) and the game (legacy.ts, Game.tsx) both import it, so a decision is clamped the same way
// wherever it is read. The model never sets a rule directly: it proposes, and `clampProposal` disposes.
//
// A decision applies to one night. The rules (the tide `nextTide` picks, an even mix, the old creature share) are the
// default the game falls back to whenever there is no answer, so nothing here is needed for a night to be played.
import { z } from "zod";
import { PLAY_ID } from "./plays";

/** The director may move the tide this far from the one the rules would pick. */
export const TIDE_SPAN = 0.15;
const TIDE_MIN = 0.6;
const TIDE_MAX = 2;
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

/** Why the rules answered instead of the model (the route says so; the game only needs to know it was them). */
export const FALLBACK_REASONS = ["timeout", "error", "invalid", "rate-limited", "unavailable"] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

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
}

// Letters of any script (the sea may speak a word of Greek), digits, spaces and plain punctuation: no markup, no links.
const LINE_CHARACTERS = /^[\p{L}\p{N} .,;:!?'’\-–—…()]*$/u;
const LINE_STRIPPED = /[^\p{L}\p{N} .,;:!?'’\-–—…()]/gu;

/** A line the player may be shown: only plain characters, one space between words, at most LINE_MAX long. */
export function cleanLine(text: string): string {
  const plain = text.replace(LINE_STRIPPED, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= LINE_MAX) return plain;
  const cut = plain.slice(0, LINE_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > LINE_MAX / 2 ? cut.slice(0, lastSpace) : cut).replace(/[ .,;:\-–—]+$/, "")}…`;
}

const hundredths = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The tides a decision may pick, given the one the rules picked: TIDE_SPAN either way, never outside TIDE_MIN..TIDE_MAX. */
export function tideRange(rulesTide: number): [number, number] {
  return [hundredths(Math.max(TIDE_MIN, rulesTide - TIDE_SPAN)), hundredths(Math.min(TIDE_MAX, rulesTide + TIDE_SPAN))];
}

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
    playId: z.string().regex(PLAY_ID).optional(),
  })
  .refine((director) => Math.abs(director.tide - director.rulesTide) <= TIDE_SPAN + 1e-9, {
    message: "the tide strays too far from the rules' tide",
  });

/** What the rules decide: the tide they picked, an even mix, the old creature share, and nothing to say. */
export function rulesDirector(rulesTide: number, decidedAfterNight: number, playId?: string): Director {
  return {
    source: "rules",
    tide: rulesTide,
    rulesTide,
    mix: { ...EVEN_MIX },
    creatureShare: DEFAULT_CREATURE_SHARE,
    line: "",
    decidedAfterNight,
    ...(playId ? { playId } : {}),
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
  if (!parsed.success) return fallback;
  const { data } = parsed;
  if (data.tide !== tide) return fallback;
  return data.source === "rules" ? rulesDirector(tide, data.decidedAfterNight, data.playId) : data;
}

/** What a model may propose. Numbers are all that is trusted; the reasoning and the expected effect are only recorded. */
const proposalSchema = z.object({
  reasoning: z.string().max(2000).catch(""),
  expectedEffect: z.string().max(2000).catch(""),
  tide: z.number().finite(),
  mix: z.object({ satyr: z.number().finite(), cyclops: z.number().finite(), harpy: z.number().finite() }),
  creatureShare: z.number().finite(),
  line: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;

/** The text of a reply as a proposal: JSON, possibly inside a code fence or after a word or two; null when it is not. */
export function parseProposal(text: string): Proposal | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = proposalSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A proposal brought inside every bound: the tide within TIDE_SPAN of the rules' tide (and TIDE_MIN to TIDE_MAX), each
 * mix weight within MIX_MIN to MIX_MAX, the creature share within CREATURE_SHARE_MIN to CREATURE_SHARE_MAX, the line
 * plain and at most LINE_MAX long. A proposal with nothing to say is null: the player would be shown nothing, so the
 * rules answer instead.
 */
export function clampProposal(
  proposal: Proposal,
  rulesTide: number,
  decidedAfterNight: number,
  playId?: string,
): Director | null {
  const line = cleanLine(proposal.line);
  if (line === "") return null;
  const weight = (value: number) => hundredths(clamp(value, MIX_MIN, MIX_MAX));
  const [lowestTide, highestTide] = tideRange(rulesTide);
  return {
    source: "mubit",
    tide: hundredths(clamp(proposal.tide, lowestTide, highestTide)),
    rulesTide,
    mix: {
      satyr: weight(proposal.mix.satyr),
      cyclops: weight(proposal.mix.cyclops),
      harpy: weight(proposal.mix.harpy),
    },
    creatureShare: hundredths(clamp(proposal.creatureShare, CREATURE_SHARE_MIN, CREATURE_SHARE_MAX)),
    line,
    decidedAfterNight,
    ...(playId ? { playId } : {}),
  };
}

/**
 * A decision that arrived over the network (the server's, or a stub's) brought inside the bounds again, against the
 * rules' tide the game itself computed. Null when it is not a decision at all.
 */
export function checkedDecision(received: unknown, rulesTide: number): Director | null {
  const parsed = directorSchema.safeParse(received);
  if (!parsed.success || parsed.data.source !== "mubit") return null;
  const { data } = parsed;
  return clampProposal(
    {
      reasoning: "",
      expectedEffect: "",
      tide: data.tide,
      mix: data.mix,
      creatureShare: data.creatureShare,
      line: data.line,
    },
    rulesTide,
    data.decidedAfterNight,
    data.playId,
  );
}
