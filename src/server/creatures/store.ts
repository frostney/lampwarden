// Where the creature gallery, the jobs and the rate-limit marks live. The production store is Vercel Blob
// (store.blob.ts); tests use the in-memory one (store.memory.ts). Everything a handler needs from storage is here, so a
// handler is exercised with no network.
import type { Creature, CreatureJob } from "@/game/creature";

/** The mark that says which job holds the global "one job at a time" slot. */
export interface RunningLock {
  jobId: string;
  /** Opaque version of the mark; `claimRunning` swaps it only if nobody changed it since it was read. */
  version: string;
}

export interface CreatureStore {
  /** Ids of the accepted creatures, newest first (ids start with their creation time). */
  listCreatureIds(): Promise<string[]>;
  /** A gallery record, or null when it is missing or does not validate. */
  getCreature(id: string): Promise<Creature | null>;
  getSprite(id: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Writes the sprite and its code, then the record: a creature is in the gallery only once its record exists. */
  putCreature(creature: Creature, png: Uint8Array, code: string): Promise<void>;

  getJob(jobId: string): Promise<CreatureJob | null>;
  putJob(job: CreatureJob): Promise<void>;

  readRunning(): Promise<RunningLock | null>;
  /**
   * Makes `jobId` the running job if the mark is still `previous` (null: there was none). Atomic: of several callers
   * holding the same `previous`, exactly one gets true.
   */
  claimRunning(jobId: string, previous: RunningLock | null): Promise<boolean>;

  /** Marks one job start for the rate limits. */
  recordStart(visitor: string, jobId: string, startedAt: Date): Promise<void>;
  /** When this visitor started jobs from `since` to `until`, oldest first. */
  visitorStartsBetween(visitor: string, since: Date, until: Date): Promise<Date[]>;
  /** How many jobs started on a UTC day (`YYYY-MM-DD`). */
  startsOnDay(day: string): Promise<number>;
}
