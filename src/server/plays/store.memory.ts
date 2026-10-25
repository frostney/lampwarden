// An in-memory PlayStore for tests.
import type { PlayStore } from "./store";

export interface MemoryPlayStore extends PlayStore {
  /** The stored recordings, by play id. */
  readonly plays: Map<string, string>;
}

export function createMemoryPlayStore(): MemoryPlayStore {
  const plays = new Map<string, string>();
  const versions = new Map<string, number>();
  const uploads: Array<{ visitor: string; at: Date }> = [];
  const write = (playId: string, json: string) => {
    plays.set(playId, json);
    versions.set(playId, (versions.get(playId) ?? 0) + 1);
  };
  return {
    plays,
    async putIfAbsent(playId, json) {
      if (plays.has(playId)) return false;
      write(playId, json);
      return true;
    },
    async read(playId) {
      const json = plays.get(playId);
      return json === undefined ? null : { json, version: String(versions.get(playId)) };
    },
    async replace(playId, json, version) {
      if (String(versions.get(playId)) !== version) return false;
      write(playId, json);
      return true;
    },
    async recordUpload(visitor, _playId, uploadedAt) {
      uploads.push({ visitor, at: uploadedAt });
    },
    async visitorStartsBetween(visitor, since, until) {
      return uploads
        .filter((upload) => upload.visitor === visitor && upload.at >= since && upload.at <= until)
        .map((upload) => upload.at)
        .sort((first, second) => first.getTime() - second.getTime());
    },
    async startsOnDay(day) {
      return uploads.filter((upload) => upload.at.toISOString().slice(0, 10) === day).length;
    },
  };
}
