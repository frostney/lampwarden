// What the creature and building APIs read from the environment, validated once. A missing secret turns generation off (the gallery
// still serves); a malformed limit falls back to its default.
import { z } from "zod";

const LIMIT_MAX = 100_000; // the most any limit read from the environment may be

/** The routes that start jobs run this long; a job that has not moved for this long reads as failed. */
export const JOB_MAX_DURATION_SECONDS = 300;
/** A job gives up this long before the function would be killed, so it can still record that it failed. */
const JOB_MARGIN_SECONDS = 30;
export const JOB_BUDGET_SECONDS = JOB_MAX_DURATION_SECONDS - JOB_MARGIN_SECONDS;

// A normal session starts a job per night (the game asks for the next night's creature as a night begins). A night lasts
// 28 to 64 s, so a quick player (no time at the dawn panel) starts a job every half minute to a minute: 12 an hour can be
// reached in about ten minutes, and the site's daily ceiling stays the cost control (one visitor can use at most 12 of its 40). Past it a
// visitor still meets what the gallery has.
const DEFAULT_STARTS_PER_VISITOR_PER_HOUR = 12;
const DEFAULT_STARTS_PER_DAY = 40;
const DEFAULT_BLOB_PREFIX = "creatures";
// Buildings are scenery, asked for as each night begins like creatures are: the same hourly allowance, and a daily cap of
// their own (a smaller one, since the plaza needs one new building a night at most).
const DEFAULT_BUILDING_STARTS_PER_DAY = 20;
const DEFAULT_BUILDING_BLOB_PREFIX = "buildings";
const DEFAULT_CANDIDATES = 3;
const MAX_CANDIDATES = 5;
export const MIN_SALT_LENGTH = 16;

export interface StartLimits {
  perVisitorPerHour: number;
  perDay: number;
}

export interface CreatureConfig {
  limits: StartLimits;
  blobPrefix: string;
  /** The buildings' own starts per visitor an hour and per day, counted apart from the creatures'. */
  buildingLimits: StartLimits;
  /** Where in the Blob store the building gallery and its limit marks live. */
  buildingBlobPrefix: string;
  /** What generation needs; null where it is missing, which turns generation off. */
  mubitApiKey: string | null;
  snapshotId: string | null;
  rateSalt: string | null;
  /** How many candidate sprites a job draws side by side from one brief. */
  candidates: number;
  /** Dev only: where a job leaves every candidate sprite and a score summary, accepted or not. */
  debugDirectory: string | null;
}

export const positiveInteger = (fallback: number) =>
  z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(LIMIT_MAX))
    .catch(fallback);

const prefixPattern = /^[a-z0-9][a-z0-9/_-]{0,60}$/;
const BUILDING_PREFIX_KEPT = 50; // characters of a custom creature prefix the building prefix is made from
const prefixSchema = z.string().regex(prefixPattern).catch(DEFAULT_BLOB_PREFIX);

/**
 * Where the building gallery lives. Unset, it follows the creatures': "buildings" beside "creatures", and a creature prefix
 * set to keep a test run out of the real gallery ("creatures-dev") takes the buildings with it ("creatures-dev-buildings"),
 * so one setting cannot leave a run writing to the real building gallery and spending its daily allowance. The two are never
 * the same prefix: records of both kinds would mix.
 */
function buildingPrefixOf(creaturePrefix: string, explicit: string | null): string {
  const derived =
    creaturePrefix === DEFAULT_BLOB_PREFIX
      ? DEFAULT_BUILDING_BLOB_PREFIX
      : `${creaturePrefix.slice(0, BUILDING_PREFIX_KEPT)}-buildings`;
  const chosen = explicit !== null && prefixPattern.test(explicit) ? explicit : derived;
  return chosen === creaturePrefix ? derived : chosen;
}

export const present = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : null);

export function readCreatureConfig(env: Readonly<Record<string, string | undefined>>): CreatureConfig {
  const salt = present(env.CREATURE_RATE_SALT);
  const blobPrefix = prefixSchema.parse(present(env.CREATURE_BLOB_PREFIX) ?? DEFAULT_BLOB_PREFIX);
  return {
    limits: {
      perVisitorPerHour: positiveInteger(DEFAULT_STARTS_PER_VISITOR_PER_HOUR).parse(
        env.CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR,
      ),
      perDay: positiveInteger(DEFAULT_STARTS_PER_DAY).parse(env.CREATURE_MAX_STARTS_PER_DAY),
    },
    blobPrefix,
    buildingLimits: {
      perVisitorPerHour: positiveInteger(DEFAULT_STARTS_PER_VISITOR_PER_HOUR).parse(
        env.BUILDING_MAX_STARTS_PER_VISITOR_PER_HOUR,
      ),
      perDay: positiveInteger(DEFAULT_BUILDING_STARTS_PER_DAY).parse(env.BUILDING_MAX_STARTS_PER_DAY),
    },
    buildingBlobPrefix: buildingPrefixOf(blobPrefix, present(env.BUILDING_BLOB_PREFIX)),
    mubitApiKey: present(env.MUBIT_API_KEY),
    snapshotId: present(env.VERCEL_SANDBOX_SNAPSHOT_ID),
    rateSalt: salt !== null && salt.length >= MIN_SALT_LENGTH ? salt : null,
    candidates: Math.min(MAX_CANDIDATES, positiveInteger(DEFAULT_CANDIDATES).parse(env.CREATURE_CANDIDATES)),
    debugDirectory: present(env.CREATURE_DEBUG_DIR),
  };
}

/** Whether a job can be started at all: the key, the snapshot and a long enough salt are all set. */
export function generationAvailable(config: CreatureConfig): boolean {
  return config.mubitApiKey !== null && config.snapshotId !== null && config.rateSalt !== null;
}
