// The record the director leaves for each decision, so the correction loop can be shown afterwards: what the model was
// told, what it decided and why, which Mubit request answered. Nothing personal: the play's random session id, numbers
// and the model's own words.
import { z } from "zod";
import { directorSchema, FALLBACK_REASONS } from "@/game/director";
import { PLAY_ID } from "@/game/plays";

const mubitCallSchema = z.object({
  /** `x-middleware-request-id`, the id to quote to Mubit. */
  requestId: z.string().nullable(),
  status: z.number().nullable(),
  milliseconds: z.number(),
  inputTokens: z.number().nullish(),
  outputTokens: z.number().nullish(),
  cacheCreationInputTokens: z.number().nullish(),
  cacheReadInputTokens: z.number().nullish(),
  /** A short hash of the system prompt, to see that every call grouped on the same one. */
  promptSha: z.string(),
});
export type MubitCall = z.infer<typeof mubitCallSchema>;

export const decisionLogSchema = z.looseObject({
  v: z.literal(1),
  playId: z.string().regex(PLAY_ID),
  session: z.string(),
  at: z.string(),
  night: z.number().int(),
  source: z.enum(["mubit", "rules"]),
  /** Set when the source is the rules because the model did not answer. */
  fallback: z.enum(FALLBACK_REASONS).nullable(),
  decision: directorSchema,
  /** The model's one sentence. Logs from the earlier, longer reply shape also carry an `expectedEffect`, which still loads. */
  reasoning: z.string(),
  /** The night as the model was told it (summary.ts). */
  summary: z.unknown(),
  mubit: mubitCallSchema.nullable(),
  /** Where the time went, in milliseconds: the play's lookup, the limits, the model, and the whole call. */
  stagesMilliseconds: z
    .object({ lookup: z.number(), limits: z.number(), model: z.number(), total: z.number() })
    .optional(),
});
export type DecisionLog = z.infer<typeof decisionLogSchema>;
