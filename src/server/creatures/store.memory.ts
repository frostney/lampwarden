// An in-memory CreatureStore with the same semantics as the Blob one (newest first, atomic claim), for tests.
import type { CreatureJob } from "@/game/creature";
import type { CreatureRecord } from "@/game/creature-frames";
import type { CreatureStore, RunningLock } from "./store";

export interface MemoryCreatureStore extends CreatureStore {
  readonly sprites: Map<string, Uint8Array>;
  readonly atlases: Map<string, Uint8Array>;
  readonly codes: Map<string, string>;
}

export function createMemoryStore(): MemoryCreatureStore {
  const creatures = new Map<string, CreatureRecord>();
  const sprites = new Map<string, Uint8Array>();
  const atlases = new Map<string, Uint8Array>();
  const codes = new Map<string, string>();
  const jobs = new Map<string, CreatureJob>();
  const starts: Array<{ visitor: string; at: Date }> = [];
  let running: { jobId: string; version: number } | null = null;
  let versionCounter = 0;

  return {
    sprites,
    atlases,
    codes,
    async listCreatureIds() {
      return [...creatures.keys()].sort().reverse();
    },
    async getCreature(id) {
      return creatures.get(id) ?? null;
    },
    async getSprite(id) {
      const png = sprites.get(id);
      return png ? new Blob([new Uint8Array(png)]).stream() : null;
    },
    async getAtlas(id) {
      const png = atlases.get(id);
      return png ? new Blob([new Uint8Array(png)]).stream() : null;
    },
    async putCreature(creature, png, code, atlas) {
      sprites.set(creature.id, png);
      if (atlas) atlases.set(creature.id, atlas);
      codes.set(creature.id, code);
      creatures.set(creature.id, creature);
    },
    async getJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async putJob(job) {
      jobs.set(job.jobId, job);
    },
    async readRunning(): Promise<RunningLock | null> {
      return running ? { jobId: running.jobId, version: String(running.version) } : null;
    },
    async claimRunning(jobId, previous) {
      const currentVersion = running ? String(running.version) : null;
      if (currentVersion !== (previous?.version ?? null)) return false;
      running = { jobId, version: ++versionCounter };
      return true;
    },
    async recordStart(visitor, _jobId, startedAt) {
      starts.push({ visitor, at: startedAt });
    },
    async visitorStartsBetween(visitor, since, until) {
      return starts
        .filter((start) => start.visitor === visitor && start.at >= since && start.at <= until)
        .map((start) => start.at)
        .sort((first, second) => first.getTime() - second.getTime());
    },
    async startsOnDay(day) {
      return starts.filter((start) => start.at.toISOString().slice(0, 10) === day).length;
    },
  };
}
