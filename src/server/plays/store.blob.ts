// The play store on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
//
//   plays/<first 10 characters of the id>/<id>.json   the recording (the director reads these)
//   play-uploads/visitor/<visitor>/<day>/<ms>-<id>-<random>, play-uploads/day/<day>/...   one tiny mark per first upload of an id
import { createBlobLedger, putIfAbsent, readWithVersion, replaceIfUnchanged } from "../blob";
import type { PlayStore } from "./store";

const pathOf = (playId: string) => `plays/${playId.slice(0, 10)}/${playId}.json`;

export function createBlobPlayStore(): PlayStore {
  const uploads = createBlobLedger("play-uploads");
  return {
    putIfAbsent: (playId, json) => putIfAbsent(pathOf(playId), json, "application/json"),
    async read(playId) {
      const found = await readWithVersion(pathOf(playId));
      return found && { json: found.text, version: found.version };
    },
    replace: (playId, json, version) => replaceIfUnchanged(pathOf(playId), json, "application/json", version),
    recordUpload: (visitor, playId, uploadedAt) => uploads.record(visitor, playId, uploadedAt),
    visitorStartsBetween: (visitor, since, until) => uploads.visitorStartsBetween(visitor, since, until),
    startsOnDay: (day) => uploads.startsOnDay(day),
  };
}
