// The live director's contract, the part only the server and the model's reply need: how an answer is made safe. The
// server (src/server/director) and the game (legacy.ts, Game.tsx) both import it, so a decision is clamped the same way
// wherever it is read. The model never sets a rule directly: it proposes, and `clampProposal` disposes.
//
// A decision applies to one night. The rules (the tide `nextTide` picks, an even mix, the old creature share) are the
// default the game falls back to whenever there is no answer, so nothing here is needed for a night to be played.
//
// The decision's shape, bounds, schema and the rules' own decision are in director-decision.ts, which a recorded night
// replays from and the sim fingerprint covers. This file is not covered: how a reply is read or cleaned does not change
// how a recorded night plays. Anything `directorFrom` or `rulesDirector` reads therefore belongs in that file, never
// here: an edit here would change what a replay does without changing the fingerprint. It re-exports that module so the game and the server have one place to import from.
import { z } from "zod";

import {
  CREATURE_SHARE_MAX,
  CREATURE_SHARE_MIN,
  DEFAULT_CREATURE_SHARE,
  type Director,
  directorSchema,
  type EngagementKind,
  LINE_MAX,
  MIX_MAX,
  MIX_MIN,
  mayEase,
  TIDE_MAX,
  TIDE_MIN,
  TIDE_SPAN,
} from "./director-decision";

export {
  CREATURE_SHARE_MAX,
  CREATURE_SHARE_MIN,
  DEFAULT_CREATURE_SHARE,
  type Director,
  directorFrom,
  directorSchema,
  type EngagementKind,
  EVEN_MIX,
  LINE_MAX,
  MIX_MAX,
  MIX_MIN,
  type Mix,
  mayEase,
  rulesDirector,
  TIDE_SPAN,
} from "./director-decision";

/** Why the rules answered instead of the model (the route says so; the game only needs to know it was them). */
export const FALLBACK_REASONS = ["timeout", "error", "invalid", "rate-limited", "unavailable"] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

// What a line may not carry (the complement of the stored schema's LINE_CHARACTERS, in director-decision.ts): anything but
// letters of any script, digits, spaces and plain punctuation.
const LINE_STRIPPED = /[^\p{L}\p{N} .,;:!?'’\-–—…()]/gu;

/** A line the player may be shown: only plain characters, one space between words, at most LINE_MAX long. */
export function cleanLine(text: string): string {
  const plain = text.replace(LINE_STRIPPED, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= LINE_MAX) {
    return plain;
  }
  // cut between code points, never inside a surrogate pair: the stored schema counts UTF-16 units and allows no lone half
  let cut = "";
  for (const character of plain) {
    if (cut.length + character.length > LINE_MAX - 1) {
      break;
    }
    cut += character;
  }
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > LINE_MAX / 2 ? cut.slice(0, lastSpace) : cut).replace(/[ .,;:\-–—]+$/, "")}…`;
}

const hundredths = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The tides a decision may pick, given the one the rules picked: TIDE_SPAN either way, never outside TIDE_MIN..TIDE_MAX. */
export function tideRange(rulesTide: number, engagement?: EngagementKind): [number, number] {
  // after a night that was not engaged the tide may not go below the rules' (which itself does not ease)
  const lowest = mayEase(engagement) ? rulesTide - TIDE_SPAN : rulesTide;
  return [hundredths(Math.max(TIDE_MIN, lowest)), hundredths(Math.min(TIDE_MAX, rulesTide + TIDE_SPAN))];
}

/**
 * What a model may propose. Numbers are all that is trusted; the reasoning (one short sentence) is only recorded. A reply
 * that still carries an `expectedEffect` (the earlier, longer shape) parses too: the key is ignored.
 */
const proposalSchema = z.object({
  reasoning: z.string().max(2000).catch(""),
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
  if (start < 0 || end <= start) {
    return null;
  }
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
  engagement?: EngagementKind,
): Director | null {
  const line = cleanLine(proposal.line);
  if (line === "") {
    return null;
  }
  // after a night that was not engaged, whatever the model says, no weight drops below 1 and the share not below the default
  const easing = mayEase(engagement);
  const weight = (value: number) => hundredths(clamp(value, easing ? MIX_MIN : 1, MIX_MAX));
  const [lowestTide, highestTide] = tideRange(rulesTide, engagement);
  return {
    source: "mubit",
    tide: hundredths(clamp(proposal.tide, lowestTide, highestTide)),
    rulesTide,
    mix: {
      satyr: weight(proposal.mix.satyr),
      cyclops: weight(proposal.mix.cyclops),
      harpy: weight(proposal.mix.harpy),
    },
    creatureShare: hundredths(
      clamp(proposal.creatureShare, easing ? CREATURE_SHARE_MIN : DEFAULT_CREATURE_SHARE, CREATURE_SHARE_MAX),
    ),
    line,
    decidedAfterNight,
    ...(playId ? { playId } : {}),
    ...(engagement ? { engagement } : {}),
  };
}

/**
 * A decision that arrived over the network (the server's, or a stub's) brought inside the bounds again, against the
 * rules' tide the game itself computed. Null when it is not a decision at all.
 */
export function checkedDecision(received: unknown, rulesTide: number, engagement?: EngagementKind): Director | null {
  const parsed = directorSchema.safeParse(received);
  if (!parsed.success || parsed.data.source !== "mubit") {
    return null;
  }
  const { data } = parsed;
  return clampProposal(
    {
      reasoning: "",
      tide: data.tide,
      mix: data.mix,
      creatureShare: data.creatureShare,
      line: data.line,
    },
    rulesTide,
    data.decidedAfterNight,
    data.playId,
    engagement,
  );
}
