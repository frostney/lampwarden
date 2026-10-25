// The creature store on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN, the one /api/plays uses).
//
// Layout under a configurable prefix (default "creatures"; live tests use another so the real gallery stays clean):
//   <prefix>/records/<id>.json        accepted creatures (ids start with their creation time, so a sort is newest-first)
//   <prefix>/sprites/<id>.png|.ts     the sprite and the build code that drew it
//   <prefix>/sprites/<id>.atlas.png   the animation atlas, for a creature whose record has `frames`
//   <prefix>/jobs/<jobId>.json        job status, rewritten at every step
//   <prefix>/state/running.json       the global "one job at a time" mark, claimed with a conditional write
//   <prefix>/starts/...               one tiny blob per job start, counted for the rate limits

import { BlobError, BlobPreconditionFailedError, get, list, put } from "@vercel/blob";
import { z } from "zod";

import { type CreatureJob, JOB_STEPS } from "@/game/creature";
import { type CreatureRecord, creatureRecordSchema } from "@/game/creature-frames";
import { compareCodeUnits } from "@/lib/compare";
import { HTTP_OK } from "@/lib/units";

import type { CreatureStore, RunningLock } from "./store";

const RECORD_ID = /^[a-z0-9-]{8,80}$/;

const jobSchema = z.object({
  jobId: z.string(),
  step: z.enum(JOB_STEPS),
  creature: creatureRecordSchema.optional(),
  error: z.string().optional(),
  updatedAt: z.string(),
});
const runningSchema = z.object({ jobId: z.string() });

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export function createBlobStore(prefix: string): CreatureStore {
  const path = {
    record: (id: string) => `${prefix}/records/${id}.json`,
    sprite: (id: string) => `${prefix}/sprites/${id}.png`,
    atlas: (id: string) => `${prefix}/sprites/${id}.atlas.png`,
    code: (id: string) => `${prefix}/sprites/${id}.ts`,
    job: (jobId: string) => `${prefix}/jobs/${jobId}.json`,
    running: `${prefix}/state/running.json`,
    visitorStarts: (visitor: string, day: string) => `${prefix}/starts/visitor/${visitor}/${day}/`,
    dayStarts: (day: string) => `${prefix}/starts/day/${day}/`,
  };

  async function listPathnames(listPrefix: string): Promise<string[]> {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: listPrefix, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) {
        pathnames.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return pathnames;
  }

  async function readText(pathname: string): Promise<{ text: string; etag: string } | null> {
    // mutable blobs are read from origin: a CDN copy could be a step behind
    const blob = await get(pathname, { access: "private", useCache: false });
    if (blob?.statusCode !== HTTP_OK) {
      return null;
    }
    return { text: await new Response(blob.stream).text(), etag: blob.blob.etag };
  }

  const writeMark = (pathname: string) =>
    put(pathname, "{}", { access: "private", contentType: "application/json", addRandomSuffix: false });

  return {
    async listCreatureIds() {
      const recordsPrefix = `${prefix}/records/`;
      const ids = (await listPathnames(recordsPrefix))
        .filter((pathname) => pathname.endsWith(".json"))
        .map((pathname) => pathname.slice(recordsPrefix.length, -".json".length))
        .filter((id) => RECORD_ID.test(id));
      return ids.sort(compareCodeUnits).reverse();
    },

    async getCreature(id) {
      const stored = await readText(path.record(id));
      if (!stored) {
        return null;
      }
      try {
        const parsed = creatureRecordSchema.safeParse(JSON.parse(stored.text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async getSprite(id) {
      const blob = await get(path.sprite(id), { access: "private" });
      return blob?.statusCode === HTTP_OK ? blob.stream : null;
    },

    async getAtlas(id) {
      const blob = await get(path.atlas(id), { access: "private" });
      return blob?.statusCode === HTTP_OK ? blob.stream : null;
    },

    async putCreature(creature: CreatureRecord, png, code, atlas) {
      const write = { access: "private", addRandomSuffix: false } as const;
      await put(path.sprite(creature.id), Buffer.from(png), { ...write, contentType: "image/png" });
      if (atlas) {
        await put(path.atlas(creature.id), Buffer.from(atlas), { ...write, contentType: "image/png" });
      }
      await put(path.code(creature.id), code, { ...write, contentType: "text/plain" });
      await put(path.record(creature.id), JSON.stringify(creature), { ...write, contentType: "application/json" });
    },

    async getJob(jobId) {
      const stored = await readText(path.job(jobId));
      if (!stored) {
        return null;
      }
      try {
        const parsed = jobSchema.safeParse(JSON.parse(stored.text));
        if (!parsed.success) {
          return null;
        }
        const { creature, error, ...rest } = parsed.data;
        return { ...rest, ...(creature ? { creature } : {}), ...(error ? { error } : {}) } satisfies CreatureJob;
      } catch {
        return null;
      }
    },

    async putJob(job) {
      await put(path.job(job.jobId), JSON.stringify(job), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    },

    async readRunning(): Promise<RunningLock | null> {
      const stored = await readText(path.running);
      if (!stored) {
        return null;
      }
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
        await put(
          path.running,
          body,
          previous === null ? options : { ...options, allowOverwrite: true, ifMatch: previous.version },
        );
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          return false;
        }
        if (previous === null && error instanceof BlobError && /already exists/i.test(error.message)) {
          return false;
        }
        throw error;
      }
    },

    async recordStart(visitor, jobId, startedAt) {
      const day = dayOf(startedAt);
      await writeMark(`${path.visitorStarts(visitor, day)}${startedAt.getTime()}-${jobId}`);
      await writeMark(`${path.dayStarts(day)}${jobId}`);
    },

    async visitorStartsBetween(visitor, since, until) {
      const days = new Set([dayOf(since), dayOf(until)]);
      const starts: Date[] = [];
      for (const day of days) {
        for (const pathname of await listPathnames(path.visitorStarts(visitor, day))) {
          const startedAt = Number(/\/(\d+)-[^/]+$/.exec(pathname)?.[1]);
          if (startedAt >= since.getTime() && startedAt <= until.getTime()) {
            starts.push(new Date(startedAt));
          }
        }
      }
      return starts.sort((first, second) => first.getTime() - second.getTime());
    },

    async startsOnDay(day) {
      return (await listPathnames(path.dayStarts(day))).length;
    },
  };
}
