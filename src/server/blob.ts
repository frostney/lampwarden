// What the server's Blob stores share (the director's, the play uploads'): a write that only the first caller wins, and
// the ledger of marks the rate limits count. Private store, BLOB_READ_WRITE_TOKEN.
import { BlobNotFoundError, head, list, put } from "@vercel/blob";
import type { StartLedger } from "./creatures/limits";

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export async function listPathnames(prefix: string): Promise<string[]> {
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) pathnames.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return pathnames;
}

/**
 * Writes `body` at `pathname` unless a blob is already there: true when this call wrote it, false when one was. A put
 * without `allowOverwrite` fails on an existing blob, and the failure is told from an outage by looking for the blob.
 */
export async function putIfAbsent(pathname: string, body: string, contentType: string): Promise<boolean> {
  try {
    await put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false });
    return true;
  } catch (error) {
    try {
      await head(pathname);
      return false;
    } catch (lookup) {
      throw lookup instanceof BlobNotFoundError ? error : lookup;
    }
  }
}

/**
 * The marks the limits count, one tiny blob each, under
 *   <root>/visitor/<visitor>/<day>/<ms>-<id>-<random>
 *   <root>/day/<day>/<ms>-<id>-<random>
 * The random ending keeps two marks for one id in one millisecond from colliding (a collision fails the put).
 */
export function createBlobLedger(root: string): StartLedger & {
  record(visitor: string, id: string, markedAt: Date): Promise<void>;
} {
  const visitorPrefix = (visitor: string, day: string) => `${root}/visitor/${visitor}/${day}/`;
  const writeMark = (pathname: string) =>
    put(pathname, "{}", { access: "private", contentType: "application/json", addRandomSuffix: false });

  return {
    async record(visitor, id, markedAt) {
      const name = `${markedAt.getTime()}-${id}-${crypto.randomUUID().slice(0, 8)}`;
      await Promise.all([
        writeMark(`${visitorPrefix(visitor, dayOf(markedAt))}${name}`),
        writeMark(`${root}/day/${dayOf(markedAt)}/${name}`),
      ]);
    },

    async visitorStartsBetween(visitor, since, until) {
      const days = new Set([dayOf(since), dayOf(until)]);
      const marked: Date[] = [];
      for (const day of days) {
        for (const pathname of await listPathnames(visitorPrefix(visitor, day))) {
          const markedAt = Number(/\/(\d+)-[^/]+$/.exec(pathname)?.[1]);
          if (markedAt >= since.getTime() && markedAt <= until.getTime()) marked.push(new Date(markedAt));
        }
      }
      return marked.sort((first, second) => first.getTime() - second.getTime());
    },

    async startsOnDay(day) {
      return (await listPathnames(`${root}/day/${day}/`)).length;
    },
  };
}
