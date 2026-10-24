// What the creature API reads from the environment, validated once. A missing secret turns generation off (the gallery
// still serves); a malformed limit falls back to its default.
import { z } from "zod";

/** The routes that start jobs run this long; a job that has not moved for this long reads as failed. */
export const JOB_MAX_DURATION_SECONDS = 300;
/** A job gives up this long before the function would be killed, so it can still record that it failed. */
export const JOB_BUDGET_SECONDS = JOB_MAX_DURATION_SECONDS - 30;

const DEFAULT_STARTS_PER_VISITOR_PER_HOUR = 3;
const DEFAULT_STARTS_PER_DAY = 40;
const DEFAULT_BLOB_PREFIX = "creatures";
const MIN_SALT_LENGTH = 16;

export interface StartLimits {
  perVisitorPerHour: number;
  perDay: number;
}

export interface CreatureConfig {
  limits: StartLimits;
  blobPrefix: string;
  /** What generation needs; null where it is missing, which turns generation off. */
  mubitApiKey: string | null;
  snapshotId: string | null;
  rateSalt: string | null;
}

const positiveInteger = (fallback: number) =>
  z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100_000))
    .catch(fallback);

const prefixSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_-]{0,60}$/)
  .catch(DEFAULT_BLOB_PREFIX);

const present = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : null);

export function readCreatureConfig(env: Readonly<Record<string, string | undefined>>): CreatureConfig {
  const salt = present(env.CREATURE_RATE_SALT);
  return {
    limits: {
      perVisitorPerHour: positiveInteger(DEFAULT_STARTS_PER_VISITOR_PER_HOUR).parse(
        env.CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR,
      ),
      perDay: positiveInteger(DEFAULT_STARTS_PER_DAY).parse(env.CREATURE_MAX_STARTS_PER_DAY),
    },
    blobPrefix: prefixSchema.parse(present(env.CREATURE_BLOB_PREFIX) ?? DEFAULT_BLOB_PREFIX),
    mubitApiKey: present(env.MUBIT_API_KEY),
    snapshotId: present(env.VERCEL_SANDBOX_SNAPSHOT_ID),
    rateSalt: salt !== null && salt.length >= MIN_SALT_LENGTH ? salt : null,
  };
}

/** Whether a job can be started at all: the key, the snapshot and a long enough salt are all set. */
export function generationAvailable(config: CreatureConfig): boolean {
  return config.mubitApiKey !== null && config.snapshotId !== null && config.rateSalt !== null;
}
