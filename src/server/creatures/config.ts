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
const DEFAULT_CANDIDATES = 3;
const MAX_CANDIDATES = 5;
const MIN_SALT_LENGTH = 16;

export interface StartLimits {
  perVisitorPerHour: number;
  perDay: number;
}

/** Where a job renders the sprite the verifier judges: QuickJS in a worker thread (the default) or a Vercel Sandbox. */
type CreatureRenderer = "quickjs" | "sandbox";
const DEFAULT_RENDERER: CreatureRenderer = "quickjs";

export interface CreatureConfig {
  limits: StartLimits;
  blobPrefix: string;
  /** What generation needs; null where it is missing, which turns generation off. */
  mubitApiKey: string | null;
  /**
   * Which renderer the job's render step uses; `sandbox` also needs `snapshotId`. Null when the variable is set to something
   * else: a misspelt "sandbox" must not quietly select the other renderer, so generation is off until it is fixed.
   */
  renderer: CreatureRenderer | null;
  snapshotId: string | null;
  rateSalt: string | null;
  /** How many candidate sprites a job draws side by side from one brief. */
  candidates: number;
  /** Dev only: where a job leaves every candidate sprite and a score summary, accepted or not. */
  debugDirectory: string | null;
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

const rendererSchema = z.enum(["quickjs", "sandbox"]).nullable().catch(null);

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
    renderer: rendererSchema.parse(present(env.CREATURE_RENDERER) ?? DEFAULT_RENDERER),
    snapshotId: present(env.VERCEL_SANDBOX_SNAPSHOT_ID),
    rateSalt: salt !== null && salt.length >= MIN_SALT_LENGTH ? salt : null,
    candidates: Math.min(MAX_CANDIDATES, positiveInteger(DEFAULT_CANDIDATES).parse(env.CREATURE_CANDIDATES)),
    debugDirectory: present(env.CREATURE_DEBUG_DIR),
  };
}

/** Whether a job can be started at all: the key and a long enough salt are set, and the sandbox renderer has its snapshot. */
export function generationAvailable(config: CreatureConfig): boolean {
  const renderable = config.renderer === "quickjs" || (config.renderer === "sandbox" && config.snapshotId !== null);
  return config.mubitApiKey !== null && config.rateSalt !== null && renderable;
}
