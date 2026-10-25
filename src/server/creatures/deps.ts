// Wires the creature and building services and jobs to the real world: environment, Blob, Mubit and the Vercel Sandbox.
// The only module that reads the environment (ENV, typed from .env.schema), the prompt files and the kit; everything it
// builds is a plain object the tests replace.
//
// Files read at runtime (the prompts, and the kit and runner to compute the digest a snapshot must match) are listed in
// next.config.ts under outputFileTracingIncludes, so a deployed function has them; the kit and runner themselves
// are in the sandbox snapshot, not read for rendering.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENV } from "varlock/env";

import { MILLISECONDS_PER_SECOND } from "@/lib/units";

import type { CandidateOutcome } from "../../../pipeline/loop";
import { createMubitClient } from "../../../pipeline/mubit";
import type { RenderRequest } from "../../../pipeline/render-types";
import { renderBatchSafely, renderSafely } from "../../../pipeline/render-vercel-sandbox";
import { readRunnerFiles, runnerBundleSha } from "../../../pipeline/runner-bundle";
import { type BuildingJobDeps, runBuildingJob } from "../buildings/job";
import {
  type CreatureConfig,
  generationAvailable,
  JOB_BUDGET_SECONDS,
  JOB_MAX_DURATION_SECONDS,
  readCreatureConfig,
} from "./config";
import { type JobDeps, runCreatureJob } from "./job";
import { randomEntropy } from "./job-shell";
import type { ServiceDeps } from "./service";
import type { BuildingStore, CreatureStore, GalleryStore, JobKind } from "./store";
import { createBlobStore } from "./store.blob";

const FRAME_BATCH_VCPUS = 8;

const pipelineDirectory = () => join(process.cwd(), "pipeline");
const readPrompt = (name: string) =>
  readFileSync(join(/*turbopackIgnore: true*/ pipelineDirectory(), "prompts", name), "utf8");

/** Dev only (CREATURE_DEBUG_DIR): every candidate's PNG and a summary of the scores, to look at a run afterwards. */
function debugSink(directory: string) {
  return ({
    jobId,
    id,
    brief,
    accepted,
    outcome,
  }: {
    jobId: string;
    id: string;
    brief: unknown;
    accepted: boolean;
    outcome: CandidateOutcome;
  }) => {
    try {
      mkdirSync(directory, { recursive: true });
      for (const candidate of outcome.candidates) {
        if (candidate.png) {
          writeFileSync(join(directory, `${jobId}-${candidate.name}.png`), candidate.png);
        }
      }
      const summary = {
        jobId,
        id,
        accepted,
        brief,
        winner: outcome.winner.name,
        candidates: outcome.candidates.map(({ name, score, pass, stage, isFix, stats }) => ({
          name,
          score,
          pass,
          stage,
          isFix,
          flags: stats?.flags,
        })),
      };
      writeFileSync(join(directory, `${jobId}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    } catch {
      // a debug aid must never fail a job
    }
  };
}

/** What every deployed job needs of the real world, with the sandbox's settings, or null when generation is not configured. */
function createSharedJobDeps(config: CreatureConfig) {
  const { mubitApiKey, snapshotId } = config;
  if (!generationAvailable(config) || mubitApiKey === null || snapshotId === null) {
    return null;
  }
  const expectedBundleSha = runnerBundleSha(readRunnerFiles(pipelineDirectory()));
  const deps = {
    now: () => new Date(),
    model: createMubitClient({ apiKey: mubitApiKey }),
    render: (request: RenderRequest, signal?: AbortSignal) =>
      renderSafely(request, { snapshotId, expectedBundleSha }, signal),
    entropy: randomEntropy,
    budgetMilliseconds: JOB_BUDGET_SECONDS * MILLISECONDS_PER_SECOND,
    candidates: config.candidates,
    ...(config.debugDirectory ? { onOutcome: debugSink(config.debugDirectory) } : {}),
  };
  return { deps, sandbox: { snapshotId, expectedBundleSha } };
}

/** The deployed creature job's dependencies, or null when generation is not configured. */
function createJobDeps(config: CreatureConfig, store: CreatureStore): JobDeps | null {
  const shared = createSharedJobDeps(config);
  if (!shared) {
    return null;
  }
  return {
    ...shared.deps,
    store,
    // a creature's 75 frames (five directions of 15) in one VM, a frame per vCPU at a time
    renderBatch: (requests, signal) =>
      renderBatchSafely(requests, { ...shared.sandbox, vcpus: FRAME_BATCH_VCPUS }, signal),
    prompts: {
      creature: readPrompt("creature.md"),
      generator: readPrompt("generator.md"),
      verifier: readPrompt("verifier.md"),
    },
  };
}

/** The deployed building job's dependencies, or null when generation is not configured. */
function createBuildingJobDeps(config: CreatureConfig, store: BuildingStore): BuildingJobDeps | null {
  const shared = createSharedJobDeps(config);
  if (!shared) {
    return null;
  }
  return {
    ...shared.deps,
    store,
    prompts: {
      building: readPrompt("building.md"),
      generator: readPrompt("generator.md"),
      verifier: readPrompt("verifier.md"),
    },
  };
}

/** `schedule` runs work after the response has gone out: `after` from next/server in a route. */
// runs a job of either kind, when generation is set up for it
async function runJob(config: CreatureConfig, store: GalleryStore, jobId: string, kind: JobKind) {
  if (kind === "building") {
    const buildingDeps = createBuildingJobDeps(config, store);
    if (buildingDeps) {
      await runBuildingJob(buildingDeps, jobId);
    }
    return;
  }
  const jobDeps = createJobDeps(config, store);
  if (jobDeps) {
    await runCreatureJob(jobDeps, jobId);
  }
}

export function createServiceDeps(schedule: (work: () => Promise<unknown>) => void): ServiceDeps {
  // ENV holds null, not undefined, for an unset item; the reader treats both as unset
  const config = readCreatureConfig(ENV);
  const store = createBlobStore(config.blobPrefix, config.buildingBlobPrefix);
  return {
    store,
    now: () => new Date(),
    config,
    newJobId: () => crypto.randomUUID(),
    maxDurationSeconds: JOB_MAX_DURATION_SECONDS,
    startJob: (jobId, kind) =>
      schedule(async () => {
        try {
          await runJob(config, store, jobId, kind);
        } catch (error) {
          // a job that cannot even start (a file missing from the deployment, say) must not sit "queued" holding the slot
          console.error(
            JSON.stringify({
              event: `${kind}-job-start-failed`,
              jobId,
              kind: error instanceof Error ? error.name : "unknown",
            }),
          );
          await store.putJob({
            jobId,
            ...(kind === "building" ? { kind } : {}),
            step: "failed",
            error: "something went wrong",
            updatedAt: new Date().toISOString(),
          });
        }
      }),
  };
}
