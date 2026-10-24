// Wires the creature service and job to the real world: environment, Blob, Mubit and the renderer. The only module that
// reads process.env and the prompt files; everything it builds is a plain object the tests replace.
//
// Files read at runtime (the prompts, and with the sandbox renderer the kit and runner to compute the digest a snapshot
// must match) are listed in next.config.ts under outputFileTracingIncludes, so a deployed function has them. The QuickJS
// renderer reads none: the prepared kit is in its bundle and the WebAssembly file is traced with it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signBuild } from "@/game/creature-signing";
import { createMubitClient } from "../../../pipeline/mubit";
import { renderInQuickJsWorker } from "../../../pipeline/render-quickjs";
import type { Renderer, RendererName } from "../../../pipeline/render-types";
import { renderSafely } from "../../../pipeline/render-vercel-sandbox";
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

/** The renderer the job judges sprites with: QuickJS in a worker thread, or a Vercel Sandbox from the pinned snapshot. */
function createRenderer(
  config: CreatureConfig,
): { render: Renderer; rendererName: RendererName; drawCheck?: Renderer } | null {
  if (config.renderer === "quickjs") return { render: renderInQuickJsWorker, rendererName: "quickjs" };
  const { snapshotId } = config;
  if (config.renderer !== "sandbox" || snapshotId === null) return null;
  const expectedBundleSha = runnerBundleSha(readRunnerFiles(pipelineDirectory()));
  return {
    render: (request) => renderSafely(request, { snapshotId, expectedBundleSha }),
    rendererName: "vercel",
    // the browser draws with QuickJS: a creature the sandbox judged is stored only if QuickJS draws the same pixels
    drawCheck: renderInQuickJsWorker,
  };
}

/** The deployed job's dependencies, or null when generation is not configured. */
function createJobDeps(config: CreatureConfig, store: CreatureStore): JobDeps | null {
  const { mubitApiKey, signingKey } = config;
  const renderer = createRenderer(config);
  if (!generationAvailable(config) || mubitApiKey === null || renderer === null) return null;
  return {
    store,
    now: () => new Date(),
    model: createMubitClient({ apiKey: mubitApiKey }),
    ...renderer,
    prompts: {
      creature: readPrompt("creature.md"),
      generator: readPrompt("generator.md"),
      verifier: readPrompt("verifier.md"),
    },
    entropy: randomEntropy,
    budgetMilliseconds: JOB_BUDGET_SECONDS * 1000,
    candidates: config.candidates,
    ...(config.debugDirectory ? { onOutcome: debugSink(config.debugDirectory) } : {}),
    ...(signingKey === null ? {} : { sign: (id, build) => signBuild(signingKey, id, build) }),
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
