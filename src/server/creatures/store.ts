// Where the creature and building galleries, the jobs and the rate-limit marks live. The production store is Vercel Blob
// (store.blob.ts); tests use the in-memory one (store.memory.ts). Everything a handler needs from storage is here, so a
// handler is exercised with no network.
import type { Building } from "@/game/building";
import type { CreatureJob } from "@/game/creature";
import type { CreatureRecord } from "@/game/creature-frames";

/** What a job makes. A job stored without a kind is a creature's, as every job was before buildings existed. */
export type JobKind = "creature" | "building";

/** A job as the store keeps it: the contract's creature job, or a building's, which carries `kind` and `building`. */
export interface StoredJob extends CreatureJob {
  kind?: JobKind;
  creature?: CreatureRecord;
  building?: Building;
}

export const kindOf = (job: Pick<StoredJob, "kind">): JobKind => job.kind ?? "creature";

/** The mark that says which job holds the global "one job at a time" slot. */
export interface RunningLock {
  jobId: string;
  /** Opaque version of the mark; `claimRunning` swaps it only if nobody changed it since it was read. */
  version: string;
}

/** The jobs and the one slot, shared by creatures and buildings: at most one model job and one sandbox run at a time. */
export interface JobStore {
  getJob(jobId: string): Promise<StoredJob | null>;
  putJob(job: StoredJob): Promise<void>;

  readRunning(): Promise<RunningLock | null>;
  /**
   * Makes `jobId` the running job if the mark is still `previous` (null: there was none). Atomic: of several callers
   * holding the same `previous`, exactly one gets true.
   */
  claimRunning(jobId: string, previous: RunningLock | null): Promise<boolean>;

  /**
   * Notes that a creature asked for the slot while a building job held it. Buildings do not start while the note is
   * fresh, so the creature, which asks again, gets the slot first.
   */
  noteCreatureWaiting(waitedAt: Date): Promise<void>;
  /** When the last creature was told to wait, or null. */
  creatureWaitingSince(): Promise<Date | null>;
}

interface CreatureGallery {
  /** Ids of the accepted creatures, newest first (ids start with their creation time). */
  listCreatureIds(): Promise<string[]>;
  /** A gallery record, or null when it is missing or does not validate. */
  getCreature(id: string): Promise<CreatureRecord | null>;
  getSprite(id: string): Promise<ReadableStream<Uint8Array> | null>;
  /** The animation atlas of a creature whose record has `frames`; null for one that has none. */
  getAtlas(id: string): Promise<ReadableStream<Uint8Array> | null>;
  /**
   * Writes the sprite, its code and the atlas (when the record has `frames`), then the record: a creature is in the
   * gallery only once its record exists.
   */
  putCreature(creature: CreatureRecord, png: Uint8Array, code: string, atlas?: Uint8Array): Promise<void>;
}

/** The marks of past job starts, which the rate limits count. */
interface CreatureLedger {
  /** Marks one job start for the rate limits. */
  recordStart(visitor: string, jobId: string, startedAt: Date): Promise<void>;
  /** When this visitor started jobs from `since` to `until`, oldest first. */
  visitorStartsBetween(visitor: string, since: Date, until: Date): Promise<Date[]>;
  /** How many jobs started on a UTC day (`YYYY-MM-DD`). */
  startsOnDay(day: string): Promise<number>;
}

export interface CreatureStore extends JobStore, CreatureGallery, CreatureLedger {}

interface BuildingGallery {
  /** Ids of the accepted buildings, newest first (ids start with their creation time). */
  listBuildingIds(): Promise<string[]>;
  /** A gallery record, or null when it is missing or does not validate. */
  getBuilding(id: string): Promise<Building | null>;
  getBuildingSprite(id: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Writes the sprite and its code, then the record: a building is in the gallery only once its record exists. */
  putBuilding(building: Building, png: Uint8Array, code: string): Promise<void>;
}

/** The buildings' own marks, apart from the creatures', so each kind has its own daily cap. */
interface BuildingLedger {
  recordBuildingStart(visitor: string, jobId: string, startedAt: Date): Promise<void>;
  buildingVisitorStartsBetween(visitor: string, since: Date, until: Date): Promise<Date[]>;
  buildingStartsOnDay(day: string): Promise<number>;
}

export interface BuildingStore extends JobStore, BuildingGallery, BuildingLedger {}

/** Everything the one Blob store holds. */
export interface GalleryStore extends CreatureStore, BuildingStore {}
