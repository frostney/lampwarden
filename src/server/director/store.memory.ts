// An in-memory DirectorStore for tests.
import type { DecisionLog } from "./log";
import type { DirectorStore } from "./store";

export interface MemoryDirectorStore extends DirectorStore {
  readonly plays: Map<string, unknown>;
  readonly decisions: Map<string, DecisionLog>;
}

export function createMemoryStore(): MemoryDirectorStore {
  const plays = new Map<string, unknown>();
  const decisions = new Map<string, DecisionLog>();
  const calls: Array<{ visitor: string; at: Date }> = [];
  const claimed = new Set<string>();
  return {
    plays,
    decisions,
    async getPlay(playId) {
      return plays.get(playId) ?? null;
    },
    async getDecision(playId) {
      return decisions.get(playId) ?? null;
    },
    async putDecision(log) {
      decisions.set(log.playId, log);
    },
    async recordCall(visitor, _playId, calledAt) {
      calls.push({ visitor, at: calledAt });
    },
    async claim(key) {
      if (claimed.has(key)) {
        return false;
      }
      claimed.add(key);
      return true;
    },
    async visitorStartsBetween(visitor, since, until) {
      return calls
        .filter((call) => call.visitor === visitor && call.at >= since && call.at <= until)
        .map((call) => call.at)
        .sort((first, second) => first.getTime() - second.getTime());
    },
    async startsOnDay(day) {
      return calls.filter((call) => call.at.toISOString().slice(0, 10) === day).length;
    },
  };
}
