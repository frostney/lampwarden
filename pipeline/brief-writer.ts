// What every live brief writer does: one Mubit call under a fixed system prompt that invents the next thing as JSON,
// validated with the game's contract, and one more try when the reply is not a valid brief or repeats a name. The
// creature brief writer (creature-brief.ts) and the building one (building-brief.ts) differ in the prompt, the contract,
// the Mubit task they are logged under and the message they send; this is the rest.
import type { z } from "zod";

import type { CallRecord, ModelCall, MubitClient } from "./mubit";

const BRIEF_MAX_TOKENS = 1500;
const MAX_ATTEMPTS = 2;

const normalizedName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The first `{ ... }` span of a reply as a brief the contract accepts, or null. Fences and chatter around the JSON are tolerated. */
export function parseBrief<Brief>(schema: z.ZodType<Brief>, text: string | null): Brief | null {
  const span = /\{[\s\S]*\}/.exec(text ?? "")?.[0];
  if (!span) {
    return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(span));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type BriefResult<Brief> = { ok: true; brief: Brief } | { ok: false; reason: "invalid" | "unavailable" };

export interface BriefWriterBase {
  model: MubitClient;
  /** The text of the writer's system prompt (prompts/creature.md, prompts/building.md). */
  prompt: string;
  /** Called with each model call's record (no text), so the caller can log it. */
  onCall?: (record: CallRecord) => void;
}

export interface BriefRequest<Brief> {
  /** The Mubit task the call is logged under: each writer is its own. */
  task: string;
  schema: z.ZodType<Brief>;
  nameOf: (brief: Brief) => string;
  /** Names the new brief must not repeat (compared in plain letters). */
  takenNames: readonly string[];
  /** The user message of the call. */
  message: string;
}

/** Asks for a brief and validates the answer; one more try if the reply is not a valid brief or repeats a name. */
export async function writeValidatedBrief<Brief>(
  writer: BriefWriterBase,
  request: BriefRequest<Brief>,
  session: string,
): Promise<BriefResult<Brief>> {
  const taken = new Set(request.takenNames.map(normalizedName));
  let failure: "invalid" | "unavailable" = "invalid";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const call: ModelCall = await writer.model.call(
      request.task,
      writer.prompt,
      [{ role: "user", content: request.message }],
      session,
      { attempt },
      BRIEF_MAX_TOKENS,
    );
    writer.onCall?.(call.record);
    if (call.text === null) {
      failure = "unavailable";
      continue;
    }
    failure = "invalid";
    const brief = parseBrief(request.schema, call.text);
    if (brief && !taken.has(normalizedName(request.nameOf(brief)))) {
      return { ok: true, brief };
    }
  }
  return { ok: false, reason: failure };
}

/** A thread to start from, chosen with `random` (a number in [0, 1)): Mubit takes no temperature, so this is what varies the brief. */
export function pickOne(choices: readonly string[], random: () => number, fallback: string): string {
  return choices[Math.floor(random() * choices.length) % choices.length] ?? fallback;
}
