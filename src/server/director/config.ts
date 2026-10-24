// What the director route reads from the environment, validated once. A missing key or salt turns the model off (every
// answer is then the rules'); a malformed limit falls back to its default.
import { z } from "zod";
import { MIN_SALT_LENGTH, positiveInteger, present, type StartLimits } from "../creatures/config";

/** The model gets this long; after it the rules answer, so the shop never waits on the sea. */
export const MODEL_TIMEOUT_MILLISECONDS = 8000;
/** The whole decision, after the play is read, gets this long (the model's 8 s, the store's calls and some slack). */
export const DECISION_DEADLINE_MILLISECONDS = 20_000;
/** The route's `maxDuration` (a literal in the route file, which routes.test.ts holds equal): the play's upload, the model's 8 s and the log. */
export const DIRECTOR_MAX_DURATION_SECONDS = 30;

const DEFAULT_CALLS_PER_VISITOR_PER_HOUR = 40;
const DEFAULT_CALLS_PER_DAY = 2000;
const DEFAULT_BLOB_PREFIX = "director";
const DEFAULT_PLAYS_PREFIX = "plays";

export interface DirectorConfig {
  limits: StartLimits;
  /** Where decisions and the limits' marks are written. */
  blobPrefix: string;
  /** Where recorded plays are read from: `plays`, the store /api/plays writes; a test run points it elsewhere. */
  playsPrefix: string;
  mubitApiKey: string | null;
  rateSalt: string | null;
}

const prefixSchema = (fallback: string) =>
  z
    .string()
    .regex(/^[a-z0-9][a-z0-9/_-]{0,60}$/)
    .catch(fallback);

export function readDirectorConfig(env: Readonly<Record<string, string | undefined>>): DirectorConfig {
  // the creature routes' salt keys this route's visitors too, unless it has one of its own
  const salt = present(env.DIRECTOR_RATE_SALT) ?? present(env.CREATURE_RATE_SALT);
  return {
    limits: {
      perVisitorPerHour: positiveInteger(DEFAULT_CALLS_PER_VISITOR_PER_HOUR).parse(
        env.DIRECTOR_MAX_CALLS_PER_VISITOR_PER_HOUR,
      ),
      perDay: positiveInteger(DEFAULT_CALLS_PER_DAY).parse(env.DIRECTOR_MAX_CALLS_PER_DAY),
    },
    blobPrefix: prefixSchema(DEFAULT_BLOB_PREFIX).parse(present(env.DIRECTOR_BLOB_PREFIX) ?? DEFAULT_BLOB_PREFIX),
    playsPrefix: prefixSchema(DEFAULT_PLAYS_PREFIX).parse(present(env.DIRECTOR_PLAYS_PREFIX) ?? DEFAULT_PLAYS_PREFIX),
    mubitApiKey: present(env.MUBIT_API_KEY),
    rateSalt: salt !== null && salt.length >= MIN_SALT_LENGTH ? salt : null,
  };
}
