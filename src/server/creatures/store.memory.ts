// An in-memory GalleryStore with the same semantics as the Blob one (newest first, atomic claim), for tests.
import type { Building } from "@/game/building";
import type { CreatureRecord } from "@/game/creature-frames";
import type { GalleryStore, RunningLock, StoredJob } from "./store";

export interface MemoryStore extends GalleryStore {
  readonly sprites: Map<string, Uint8Array>;
  readonly atlases: Map<string, Uint8Array>;
  readonly codes: Map<string, string>;
  readonly buildingSprites: Map<string, Uint8Array>;
  readonly buildingCodes: Map<string, string>;
}

interface Mark {
  visitor: string;
  at: Date;
}

const startsBetween = (marks: readonly Mark[], visitor: string, since: Date, until: Date) =>
  marks
    .filter((mark) => mark.visitor === visitor && mark.at >= since && mark.at <= until)
    .map((mark) => mark.at)
    .sort((first, second) => first.getTime() - second.getTime());

const startsOn = (marks: readonly Mark[], day: string) =>
  marks.filter((mark) => mark.at.toISOString().slice(0, 10) === day).length;

export function createMemoryStore(): MemoryStore {
  const creatures = new Map<string, CreatureRecord>();
  const sprites = new Map<string, Uint8Array>();
  const atlases = new Map<string, Uint8Array>();
  const codes = new Map<string, string>();
  const buildings = new Map<string, Building>();
  const buildingSprites = new Map<string, Uint8Array>();
  const buildingCodes = new Map<string, string>();
  const jobs = new Map<string, StoredJob>();
  const creatureStarts: Mark[] = [];
  const buildingStarts: Mark[] = [];
  let running: { jobId: string; version: number } | null = null;
  let versionCounter = 0;
  let creatureWaiting: Date | null = null;

  return {
    sprites,
    atlases,
    codes,
    buildingSprites,
    buildingCodes,
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
    async putCreature(creature, png, code, atlas, signal) {
      sprites.set(creature.id, png);
      if (atlas) atlases.set(creature.id, atlas);
      codes.set(creature.id, code);
      signal?.throwIfAborted(); // as the Blob store: no record once the job has ended
      creatures.set(creature.id, creature);
    },
    async listBuildingIds() {
      return [...buildings.keys()].sort().reverse();
    },
    async getBuilding(id) {
      return buildings.get(id) ?? null;
    },
    async getBuildingSprite(id) {
      const png = buildingSprites.get(id);
      return png ? new Blob([new Uint8Array(png)]).stream() : null;
    },
    async putBuilding(building, png, code, signal) {
      buildingSprites.set(building.id, png);
      buildingCodes.set(building.id, code);
      signal?.throwIfAborted();
      buildings.set(building.id, building);
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
    async noteCreatureWaiting(waitedAt) {
      creatureWaiting = waitedAt;
    },
    async creatureWaitingSince() {
      return creatureWaiting;
    },
    async recordStart(visitor, _jobId, startedAt) {
      creatureStarts.push({ visitor, at: startedAt });
    },
    async visitorStartsBetween(visitor, since, until) {
      return startsBetween(creatureStarts, visitor, since, until);
    },
    async startsOnDay(day) {
      return startsOn(creatureStarts, day);
    },
    async recordBuildingStart(visitor, _jobId, startedAt) {
      buildingStarts.push({ visitor, at: startedAt });
    },
    async buildingVisitorStartsBetween(visitor, since, until) {
      return startsBetween(buildingStarts, visitor, since, until);
    },
    async buildingStartsOnDay(day) {
      return startsOn(buildingStarts, day);
    },
  };
}
