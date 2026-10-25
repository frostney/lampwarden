// The creature and building stores on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN, the one /api/plays uses).
//
// Layout under a configurable prefix (default "creatures"; live tests use another so the real gallery stays clean):
//   <prefix>/records/<id>.json        accepted creatures (ids start with their creation time, so a sort is newest-first)
//   <prefix>/sprites/<id>.png|.ts     the sprite and the build code that drew it
//   <prefix>/sprites/<id>.atlas.png   the animation atlas, for a creature whose record has `frames`
//   <prefix>/jobs/<jobId>.json        job status, rewritten at every step; building jobs are here too (they say `kind`)
//   <prefix>/state/running.json       the global "one job at a time" mark, claimed with a conditional write: one slot for
//                                     creatures and buildings together
//   <prefix>/state/creature-waiting.json  when a creature last had to wait for a building job's slot
//   <prefix>/starts/...               one tiny blob per creature job start, counted for the rate limits
// and the buildings, under a prefix of their own (default "buildings"), laid out the same way:
//   <buildingPrefix>/records/<id>.json, sprites/<id>.png|.ts, starts/...
import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";
import { z } from "zod";
import { buildingSchema } from "@/game/building";
import { JOB_STEPS } from "@/game/creature";
import { type CreatureRecord, creatureRecordSchema } from "@/game/creature-frames";
import { listPathnames, readWithVersion } from "../blob";
import { blobGet, blobPut } from "../blob-client";
import type { GalleryStore, RunningLock, StoredJob } from "./store";

const RECORD_ID = /^[a-z0-9-]{8,80}$/;

const jobSchema = z.object({
  jobId: z.string(),
  step: z.enum(JOB_STEPS),
  kind: z.enum(["creature", "building"]).optional(),
  creature: creatureRecordSchema.optional(),
  building: buildingSchema.optional(),
  error: z.string().optional(),
  updatedAt: z.string(),
});
const runningSchema = z.object({ jobId: z.string() });
const waitingSchema = z.object({ at: z.string() });

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export function createBlobStore(prefix: string, buildingPrefix: string): GalleryStore {
  const path = {
    record: (id: string) => `${prefix}/records/${id}.json`,
    sprite: (id: string) => `${prefix}/sprites/${id}.png`,
    atlas: (id: string) => `${prefix}/sprites/${id}.atlas.png`,
    code: (id: string) => `${prefix}/sprites/${id}.ts`,
    job: (jobId: string) => `${prefix}/jobs/${jobId}.json`,
    running: `${prefix}/state/running.json`,
    creatureWaiting: `${prefix}/state/creature-waiting.json`,
    visitorStarts: (visitor: string, day: string) => `${prefix}/starts/visitor/${visitor}/${day}/`,
    dayStarts: (day: string) => `${prefix}/starts/day/${day}/`,
  };
  const buildingPath = {
    record: (id: string) => `${buildingPrefix}/records/${id}.json`,
    sprite: (id: string) => `${buildingPrefix}/sprites/${id}.png`,
    code: (id: string) => `${buildingPrefix}/sprites/${id}.ts`,
    visitorStarts: (visitor: string, day: string) => `${buildingPrefix}/starts/visitor/${visitor}/${day}/`,
    dayStarts: (day: string) => `${buildingPrefix}/starts/day/${day}/`,
  };

  // mutable blobs are read from origin (readWithVersion): a CDN copy could be a step behind
  async function readText(pathname: string): Promise<{ text: string; etag: string } | null> {
    const found = await readWithVersion(pathname);
    return found && { text: found.text, etag: found.version };
  }

  /** A stored JSON file as the schema reads it, or null when it is missing or does not validate. */
  async function readRecord<Schema extends z.ZodType>(
    pathname: string,
    schema: Schema,
  ): Promise<z.output<Schema> | null> {
    const stored = await readText(pathname);
    if (!stored) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(stored.text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function streamOf(pathname: string) {
    const blob = await blobGet(pathname, { access: "private" });
    return blob?.statusCode === 200 ? blob.stream : null;
  }

  /** The ids of the records under a `records/` prefix, newest first. */
  async function idsIn(recordsPrefix: string): Promise<string[]> {
    const ids = (await listPathnames(recordsPrefix))
      .filter((pathname) => pathname.endsWith(".json"))
      .map((pathname) => pathname.slice(recordsPrefix.length, -".json".length))
      .filter((id) => RECORD_ID.test(id));
    return ids.sort().reverse();
  }

  async function startsBetween(
    visitorStarts: (visitor: string, day: string) => string,
    visitor: string,
    since: Date,
    until: Date,
  ): Promise<Date[]> {
    const days = new Set([dayOf(since), dayOf(until)]);
    const starts: Date[] = [];
    for (const day of days) {
      for (const pathname of await listPathnames(visitorStarts(visitor, day))) {
        const startedAt = Number(/\/(\d+)-[^/]+$/.exec(pathname)?.[1]);
        if (startedAt >= since.getTime() && startedAt <= until.getTime()) starts.push(new Date(startedAt));
      }
    }
    return starts.sort((first, second) => first.getTime() - second.getTime());
  }

  const writeMark = (pathname: string) =>
    blobPut(pathname, "{}", { access: "private", contentType: "application/json", addRandomSuffix: false });
  const privateWrite = { access: "private", addRandomSuffix: false } as const;

  return {
    listCreatureIds: () => idsIn(`${prefix}/records/`),
    getCreature: (id) => readRecord(path.record(id), creatureRecordSchema),
    getSprite: (id) => streamOf(path.sprite(id)),
    getAtlas: (id) => streamOf(path.atlas(id)),

    // the record goes last, so a creature is in the gallery only once its sprite, atlas and code are; once its job has
    // ended (timed out, say) the writes stop, and the record is not started
    async putCreature(creature: CreatureRecord, png, code, atlas, signal) {
      const write = (pathname: string, body: Buffer | string, contentType: string) =>
        blobPut(pathname, body, { ...privateWrite, contentType }, signal);
      await Promise.all([
        write(path.sprite(creature.id), Buffer.from(png), "image/png"),
        atlas && write(path.atlas(creature.id), Buffer.from(atlas), "image/png"),
        write(path.code(creature.id), code, "text/plain"),
      ]);
      signal?.throwIfAborted();
      await write(path.record(creature.id), JSON.stringify(creature), "application/json");
    },

    listBuildingIds: () => idsIn(`${buildingPrefix}/records/`),
    getBuilding: (id) => readRecord(buildingPath.record(id), buildingSchema),
    getBuildingSprite: (id) => streamOf(buildingPath.sprite(id)),

    async putBuilding(building, png, code, signal) {
      const write = (pathname: string, body: Buffer | string, contentType: string) =>
        blobPut(pathname, body, { ...privateWrite, contentType }, signal);
      await Promise.all([
        write(buildingPath.sprite(building.id), Buffer.from(png), "image/png"),
        write(buildingPath.code(building.id), code, "text/plain"),
      ]);
      signal?.throwIfAborted();
      await write(buildingPath.record(building.id), JSON.stringify(building), "application/json");
    },

    async getJob(jobId) {
      const parsed = await readRecord(path.job(jobId), jobSchema);
      if (!parsed) return null;
      const { creature, building, error, kind, ...rest } = parsed;
      return {
        ...rest,
        ...(kind ? { kind } : {}),
        ...(creature ? { creature } : {}),
        ...(building ? { building } : {}),
        ...(error ? { error } : {}),
      } satisfies StoredJob;
    },

    async putJob(job) {
      await blobPut(path.job(job.jobId), JSON.stringify(job), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    },

    async readRunning(): Promise<RunningLock | null> {
      const stored = await readText(path.running);
      if (!stored) return null;
      try {
        return { jobId: runningSchema.parse(JSON.parse(stored.text)).jobId, version: stored.etag };
      } catch {
        return null;
      }
    },

    async claimRunning(jobId, previous) {
      const body = JSON.stringify({ jobId });
      const options = {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      } as const;
      try {
        // first claim: the write fails if the mark exists; later: only if its version is still the one that was read
        await blobPut(
          path.running,
          body,
          previous === null ? options : { ...options, allowOverwrite: true, ifMatch: previous.version },
        );
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        if (previous === null && error instanceof BlobError && /already exists/i.test(error.message)) return false;
        throw error;
      }
    },

    async noteCreatureWaiting(waitedAt) {
      await blobPut(path.creatureWaiting, JSON.stringify({ at: waitedAt.toISOString() }), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    },

    async creatureWaitingSince() {
      const waiting = await readRecord(path.creatureWaiting, waitingSchema);
      const waitedAt = waiting ? Date.parse(waiting.at) : Number.NaN;
      return Number.isFinite(waitedAt) ? new Date(waitedAt) : null;
    },

    async recordStart(visitor, jobId, startedAt) {
      const day = dayOf(startedAt);
      await writeMark(`${path.visitorStarts(visitor, day)}${startedAt.getTime()}-${jobId}`);
      await writeMark(`${path.dayStarts(day)}${jobId}`);
    },
    visitorStartsBetween: (visitor, since, until) => startsBetween(path.visitorStarts, visitor, since, until),
    async startsOnDay(day) {
      return (await listPathnames(path.dayStarts(day))).length;
    },

    async recordBuildingStart(visitor, jobId, startedAt) {
      const day = dayOf(startedAt);
      await writeMark(`${buildingPath.visitorStarts(visitor, day)}${startedAt.getTime()}-${jobId}`);
      await writeMark(`${buildingPath.dayStarts(day)}${jobId}`);
    },
    buildingVisitorStartsBetween: (visitor, since, until) =>
      startsBetween(buildingPath.visitorStarts, visitor, since, until),
    async buildingStartsOnDay(day) {
      return (await listPathnames(buildingPath.dayStarts(day))).length;
    },
  };
}
