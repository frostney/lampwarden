// The director store on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN, the one /api/plays uses).
//
//   <plays prefix>/<first 10 characters of the id>/<id>.json   recorded plays, as /api/plays wrote them
//   <prefix>/decisions/<id>.json                               one record per decision (log.ts), keyed by the play it answers
//   <prefix>/calls/visitor/<visitor>/<day>/<ms>-<id>           one tiny blob per call to the model, counted for the limits
//   <prefix>/calls/day/<day>/<id>
// The prefix is "director" in production; a live test uses another ("director-dev") so the real record stays clean.
import { get, list, put } from "@vercel/blob";
import { type DecisionLog, decisionLogSchema } from "./log";
import type { DirectorStore } from "./store";

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export function createBlobStore(prefix: string, playsPrefix: string): DirectorStore {
  const path = {
    play: (playId: string) => `${playsPrefix}/${playId.slice(0, 10)}/${playId}.json`,
    decision: (playId: string) => `${prefix}/decisions/${playId}.json`,
    visitorCalls: (visitor: string, day: string) => `${prefix}/calls/visitor/${visitor}/${day}/`,
    dayCalls: (day: string) => `${prefix}/calls/day/${day}/`,
  };

  async function listPathnames(listPrefix: string): Promise<string[]> {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: listPrefix, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) pathnames.push(blob.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return pathnames;
  }

  async function readJson(pathname: string): Promise<unknown> {
    const blob = await get(pathname, { access: "private", useCache: false });
    if (blob?.statusCode !== 200) return null;
    try {
      return JSON.parse(await new Response(blob.stream).text());
    } catch {
      return null;
    }
  }

  const writeMark = (pathname: string) =>
    put(pathname, "{}", { access: "private", contentType: "application/json", addRandomSuffix: false });

  return {
    getPlay: (playId) => readJson(path.play(playId)),

    async getDecision(playId) {
      const parsed = decisionLogSchema.safeParse(await readJson(path.decision(playId)));
      return parsed.success ? parsed.data : null;
    },

    async putDecision(log: DecisionLog) {
      await put(path.decision(log.playId), JSON.stringify(log), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },

    async recordCall(visitor, playId, calledAt) {
      const day = dayOf(calledAt);
      await writeMark(`${path.visitorCalls(visitor, day)}${calledAt.getTime()}-${playId}`);
      await writeMark(`${path.dayCalls(day)}${calledAt.getTime()}-${playId}`);
    },

    async visitorStartsBetween(visitor, since, until) {
      const days = new Set([dayOf(since), dayOf(until)]);
      const calls: Date[] = [];
      for (const day of days) {
        for (const pathname of await listPathnames(path.visitorCalls(visitor, day))) {
          const calledAt = Number(/\/(\d+)-[^/]+$/.exec(pathname)?.[1]);
          if (calledAt >= since.getTime() && calledAt <= until.getTime()) calls.push(new Date(calledAt));
        }
      }
      return calls.sort((first, second) => first.getTime() - second.getTime());
    },

    async startsOnDay(day) {
      return (await listPathnames(path.dayCalls(day))).length;
    },
  };
}
