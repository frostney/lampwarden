// The play store on the project's private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
//
//   plays/<first 10 characters of the id>/<id>.json   the recording (the director reads these)
//   play-uploads/visitor/<visitor>/<day>/<ms>-<id>-<random>, play-uploads/day/<day>/...   one tiny mark per stored upload
import { createBlobLedger, putIfAbsent } from "../blob";
import type { PlayStore } from "./store";

export function createBlobPlayStore(): PlayStore {
  const uploads = createBlobLedger("play-uploads");
  return {
    putIfAbsent: (playId, json) => putIfAbsent(`plays/${playId.slice(0, 10)}/${playId}.json`, json, "application/json"),
    recordUpload: (visitor, playId, uploadedAt) => uploads.record(visitor, playId, uploadedAt),
    visitorStartsBetween: (visitor, since, until) => uploads.visitorStartsBetween(visitor, since, until),
    startsOnDay: (day) => uploads.startsOnDay(day),
  };
}
