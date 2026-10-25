// Where the director reads recorded plays and writes its decisions and the marks its limits count. The production store
// is Vercel Blob (store.blob.ts); tests use the in-memory one (store.memory.ts), so a handler is exercised with no network.
import type { StartLedger } from "../creatures/limits";
import type { DecisionLog } from "./log";

export interface DirectorStore extends StartLedger {
  /** The recording as stored (JSON, not yet validated), or null when it is not there. */
  getPlay(playId: string): Promise<unknown>;
  getDecision(playId: string): Promise<DecisionLog | null>;
  putDecision(log: DecisionLog): Promise<void>;
  /** Marks one call to the model for the limits. Every mark is its own record, even for the same play in the same millisecond. */
  recordCall(visitor: string, playId: string, calledAt: Date): Promise<void>;
  /** Takes `key` for the caller: true for exactly one caller however many ask at once, false for every later one. */
  claim(key: string): Promise<boolean>;
}
