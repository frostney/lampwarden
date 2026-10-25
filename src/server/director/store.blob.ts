// The director store on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN, the one /api/plays uses).
//
//   <plays prefix>/<first 10 characters of the id>/<id>.json   recorded plays, as /api/plays wrote them
//   <prefix>/decisions/<id>.json                               one record per decision (log.ts), keyed by the play it answers
//   <prefix>/calls/visitor/<visitor>/<day>/<ms>-<id>-<random>  one tiny blob per call to the model, counted for the limits
//   <prefix>/calls/day/<day>/<ms>-<id>-<random>                (src/server/blob.ts)
//   <prefix>/claims/<key>                                      empty; the first put wins, so one of several calls takes a play
// The prefix is "director" in production; a live test uses another ("director-dev") so the real record stays clean.
import { createBlobLedger, putIfAbsent, readWithVersion } from "../blob";
import { blobPut } from "../blob-client";
import { type DecisionLog, decisionLogSchema } from "./log";
import type { DirectorStore } from "./store";

export function createBlobStore(prefix: string, playsPrefix: string): DirectorStore {
  const path = {
    play: (playId: string) => `${playsPrefix}/${playId.slice(0, 10)}/${playId}.json`,
    decision: (playId: string) => `${prefix}/decisions/${playId}.json`,
    claim: (key: string) => `${prefix}/claims/${key}`,
  };
  const calls = createBlobLedger(`${prefix}/calls`);

  async function readJson(pathname: string): Promise<unknown> {
    const stored = await readWithVersion(pathname);
    if (!stored) {
      return null;
    }
    try {
      return JSON.parse(stored.text);
    } catch {
      return null;
    }
  }

  return {
    getPlay: (playId) => readJson(path.play(playId)),

    async getDecision(playId) {
      const parsed = decisionLogSchema.safeParse(await readJson(path.decision(playId)));
      return parsed.success ? parsed.data : null;
    },

    async putDecision(log: DecisionLog) {
      await blobPut(path.decision(log.playId), JSON.stringify(log), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },

    recordCall: (visitor, playId, calledAt) => calls.record(visitor, playId, calledAt),

    claim: (key) => putIfAbsent(path.claim(key), "{}", "application/json"),

    visitorStartsBetween: (visitor, since, until) => calls.visitorStartsBetween(visitor, since, until),

    startsOnDay: (day) => calls.startsOnDay(day),
  };
}
