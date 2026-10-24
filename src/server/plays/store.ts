// Where uploaded plays are written and the marks their rate limits count. The production store is Vercel Blob
// (store.blob.ts); tests use the in-memory one (store.memory.ts), so the upload is exercised with no network.
import type { StartLedger } from "../creatures/limits";

export interface PlayStore extends StartLedger {
  /** Writes the recording unless one is stored under the id: true when this call wrote it, false when the id was taken. */
  putIfAbsent(playId: string, json: string): Promise<boolean>;
  /** Marks one stored upload for the limits. */
  recordUpload(visitor: string, playId: string, uploadedAt: Date): Promise<void>;
}
