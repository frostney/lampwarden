// One building generation job, the creature job's sibling (../creatures/job.ts): brief writer -> generator -> tripwire ->
// render in the sandbox -> engine flags -> verifier -> one fix -> best-of (pipeline/loop.ts, the same loop), accept by the
// same rule, then measure where the accepted sprite's pixels are and store it. A building has no animation, so there is no
// frame set: the job ends once the record is written. Model output is text and a PNG here; the code it wrote reaches only
// the renderer (a Vercel Sandbox in production).

import type { Building, BuildingBrief, BuildingJob } from "@/game/building";
import { ignore } from "@/lib/ignore";

import { writeBuildingBrief } from "../../../pipeline/building-brief";
import { type CandidateOutcome, isAccepted, type LoopStage, runCandidateLoop } from "../../../pipeline/loop";
import type { MubitClient } from "../../../pipeline/mubit";
import type { Renderer } from "../../../pipeline/render-types";
import { galleryId, judgedEvent, runJobShell } from "../creatures/job-shell";
import type { BuildingStore } from "../creatures/store";
import { measurePlacement } from "./placement";

const NAME_HISTORY = 60;

/** Ids start with their creation time in seconds (base 36, fixed width), so sorting them sorts by age. */
export const buildingId = (now: Date, name: string, entropy: string) => galleryId(now, name, entropy, "building");

type BuildingFailure =
  | "generation is unavailable"
  | "no building was written"
  | "no sprite could be drawn"
  | "the sprite was not good enough"
  | "its size could not be measured";

export interface BuildingJobDeps {
  store: BuildingStore;
  now: () => Date;
  model: MubitClient;
  render: Renderer;
  prompts: { building: string; generator: string; verifier: string };
  /** Random hex for ids. */
  entropy: () => string;
  /** The job gives up after this long and records a timeout. */
  budgetMilliseconds: number;
  /** How many candidate sprites to draw side by side from the brief (the best one is kept and gets the fix turn). */
  candidates: number;
  /** Dev only: told how a finished loop went, accepted or not, with every candidate. Must not throw. */
  onOutcome?: (summary: {
    jobId: string;
    id: string;
    brief: BuildingBrief;
    accepted: boolean;
    outcome: CandidateOutcome;
  }) => void;
  /** Progress and call summaries (never model output). Defaults to the console. */
  log?: (event: Record<string, unknown>) => void;
}

// why no building was written: generation is off, or the model gave nothing usable
const unwrittenReason = (reason: string): BuildingFailure =>
  reason === "unavailable" ? "generation is unavailable" : "no building was written";

/** Runs one job to its end. Never throws: every outcome is recorded in the job. */
export async function runBuildingJob(deps: BuildingJobDeps, jobId: string): Promise<BuildingJob> {
  const job = await runJobShell<BuildingFailure>(deps, jobId, "building", "building-job", async (context) => {
    await context.report("writing");
    const names = await namesOfNewestBuildings(deps.store);
    const written = await writeBuildingBrief(
      { model: context.model, prompt: deps.prompts.building, onCall: context.onCall },
      names,
      `lampwarden-building-${jobId}`,
    );
    if (!written.ok) {
      return context.fail(unwrittenReason(written.reason));
    }

    const id = buildingId(deps.now(), written.brief.name, deps.entropy());
    const outcome = await runCandidateLoop(
      {
        model: context.model,
        render: context.render,
        pose: "",
        generatorPrompt: deps.prompts.generator,
        verifierPrompt: deps.prompts.verifier,
        store: { logCall: context.onCall, saveAttemptCode: ignore, saveAttemptPng: ignore },
        print: ignore,
        onStage: (stage: LoopStage) => context.report(stage),
      },
      { id, category: "building", text: written.brief.brief },
      deps.candidates,
      isAccepted,
    );
    if (context.ended()) {
      return;
    }
    if (!outcome) {
      return context.fail("no sprite could be drawn");
    }
    const accepted = isAccepted(outcome.winner);
    deps.onOutcome?.({ jobId, id, brief: written.brief, accepted, outcome });
    context.log(judgedEvent("building-job", jobId, accepted, outcome));
    if (!accepted) {
      return context.fail("the sprite was not good enough");
    }

    // everything the placer needs is measured here, from the accepted picture, and kept in the record
    const placement = measurePlacement(outcome.winner.png, outcome.winner.stats.bbox);
    if (!placement) {
      return context.fail("its size could not be measured");
    }

    if (context.ended()) {
      return; // timed out while measuring: do not put a building in the gallery for a job that failed
    }
    const building: Building = {
      id,
      ...written.brief,
      ...placement,
      score: outcome.winner.verdict.score ?? 0,
      createdAt: deps.now().toISOString(),
    };
    await deps.store.putBuilding(building, outcome.winner.png, outcome.winner.code);
    await context.conclude({ building });
  });
  return {
    jobId: job.jobId,
    step: job.step,
    ...(job.building ? { building: job.building } : {}),
    ...(job.error ? { error: job.error } : {}),
    updatedAt: job.updatedAt,
  };
}

async function namesOfNewestBuildings(store: BuildingStore): Promise<string[]> {
  const ids = (await store.listBuildingIds()).slice(0, NAME_HISTORY);
  const buildings = await Promise.all(ids.map((id) => store.getBuilding(id)));
  return buildings.flatMap((building) => (building ? [building.name] : []));
}
