// Wires the creature service and job to the real world: environment, Blob, Mubit and the Vercel Sandbox. The only module
// that reads process.env, the prompt files and the kit; everything it builds is a plain object the tests replace.
//
// Files read at runtime (the prompts, and the kit and runner to compute the digest a snapshot must match) are listed in
// next.config.ts under outputFileTracingIncludes, so a deployed function has them; the kit and runner themselves
// are in the sandbox snapshot, not read for rendering.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMubitClient } from "../../../pipeline/mubit";
import { renderBatchSafely, renderSafely } from "../../../pipeline/render-vercel-sandbox";
import { readRunnerFiles, runnerBundleSha } from "../../../pipeline/runner-bundle";
import {
  type CreatureConfig,
  generationAvailable,
  JOB_BUDGET_SECONDS,
  JOB_MAX_DURATION_SECONDS,
  readCreatureConfig,
} from "./config";
import { type JobDeps, randomEntropy, runCreatureJob } from "./job";
import type { ServiceDeps } from "./service";
import type { CreatureStore } from "./store";
import { createBlobStore } from "./store.blob";

const FRAME_BATCH_VCPUS = 4;

const pipelineDirectory = () => join(process.cwd(), "pipeline");
const readPrompt = (name: string) =>
  readFileSync(join(/*turbopackIgnore: true*/ pipelineDirectory(), "prompts", name), "utf8");

/** Dev only (CREATURE_DEBUG_DIR): every candidate's PNG and a summary of the scores, to look at a run afterwards. */
function debugSink(directory: string): NonNullable<JobDeps["onOutcome"]> {
  return ({ jobId, id, brief, accepted, outcome }) => {
    try {
      mkdirSync(directory, { recursive: true });
      for (const candidate of outcome.candidates) {
        if (candidate.png) writeFileSync(join(directory, `${jobId}-${candidate.name}.png`), candidate.png);
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

/** The deployed job's dependencies, or null when generation is not configured. */
function createJobDeps(config: CreatureConfig, store: CreatureStore): JobDeps | null {
  const { mubitApiKey, snapshotId } = config;
  if (!generationAvailable(config) || mubitApiKey === null || snapshotId === null) return null;
  const expectedBundleSha = runnerBundleSha(readRunnerFiles(pipelineDirectory()));
  return {
    store,
    now: () => new Date(),
    model: createMubitClient({ apiKey: mubitApiKey }),
    render: (request) => renderSafely(request, { snapshotId, expectedBundleSha }),
    // a creature's 15 frames in one VM, a frame per vCPU at a time
    renderBatch: (requests) => renderBatchSafely(requests, { snapshotId, expectedBundleSha, vcpus: FRAME_BATCH_VCPUS }),
    prompts: {
      creature: readPrompt("creature.md"),
      generator: readPrompt("generator.md"),
      verifier: readPrompt("verifier.md"),
    },
    entropy: randomEntropy,
    budgetMilliseconds: JOB_BUDGET_SECONDS * 1000,
    candidates: config.candidates,
    ...(config.debugDirectory ? { onOutcome: debugSink(config.debugDirectory) } : {}),
  };
}

/** `schedule` runs work after the response has gone out: `after` from next/server in a route. */
export function createServiceDeps(schedule: (work: () => Promise<unknown>) => void): ServiceDeps {
  const config = readCreatureConfig(process.env);
  const store = createBlobStore(config.blobPrefix);
  return {
    store,
    now: () => new Date(),
    config,
    newJobId: () => crypto.randomUUID(),
    maxDurationSeconds: JOB_MAX_DURATION_SECONDS,
    startJob: (jobId) =>
      schedule(async () => {
        try {
          const jobDeps = createJobDeps(config, store);
          if (jobDeps) await runCreatureJob(jobDeps, jobId);
        } catch (error) {
          // a job that cannot even start (a file missing from the deployment, say) must not sit "queued" holding the slot
          console.error(
            JSON.stringify({
              event: "creature-job-start-failed",
              jobId,
              kind: error instanceof Error ? error.name : "unknown",
            }),
          );
          await store.putJob({
            jobId,
            step: "failed",
            error: "something went wrong",
            updatedAt: new Date().toISOString(),
          });
        }
      }),
  };
}
