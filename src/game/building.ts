// A building the plaza is raised with: generated live through Mubit (brief, sprite code, render, verify) and kept in a
// shared gallery, exactly as creatures are (src/game/creature.ts), but scenery: it has no stats, no animation and no
// effect on play. This module is the contract between the server that makes them (src/app/api/buildings) and the game
// that places them: the record, with everything the placer needs to know about where its pixels are, the API's request
// and response shapes, and what a recording keeps of the building a night was played beside.
//
// Deliberately not part of the sim fingerprint (tools/sim-fingerprint): a building is only ever drawn. The sim never
// reads it and no replay path imports it as a value.
import { z } from "zod";
import type { SpriteExtents } from "../scene/extent";
import { JOB_STEPS, type JobStep } from "./creature";

const coordinate = z.number().int().min(-512).max(512);
const pointSchema = z.tuple([coordinate, coordinate]).readonly();
const outline = z.array(pointSchema).min(3).max(256).readonly();

// Where a building's pixels are, in the form the decor placer reads (src/scene/extent.ts): its base hulls, in pixels from
// its anchor, and the box of its opaque pixels. The server measures it from the accepted PNG; the client never does.
export const spriteExtentsSchema = z.object({
  hull: outline,
  solid: outline,
  band: z.number().int().min(1).max(128),
  sprite: z.object({ left: coordinate, right: coordinate, top: coordinate, bottom: coordinate }),
}) satisfies z.ZodType<SpriteExtents>;

const edge = z.number().int().min(0).max(128);

export const buildingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{8,80}$/),
  name: z.string().min(2).max(40), // "Fountain house of the Nymphs"
  brief: z.string().min(8).max(400), // the sprite brief the generator drew from
  anchorY: z.number().min(0.5).max(1), // where its base touches the ground, as a fraction of the 128 px frame
  bbox: z.tuple([edge, edge, edge, edge]), // left, top, right, bottom pixel of what was painted, as the render reported it
  extent: spriteExtentsSchema,
  score: z.number().min(0).max(10), // the verifier's score for the accepted sprite
  createdAt: z.string(), // ISO time
});
export type Building = z.infer<typeof buildingSchema>;

// What the model decides about a building, and nothing else: the rest is measured from what it drew.
export const buildingBriefSchema = buildingSchema.pick({ name: true, brief: true });
export type BuildingBrief = z.infer<typeof buildingBriefSchema>;

// The building a night was played beside, as a recording keeps it: enough to lay the same plaza out again without asking
// the gallery (its id, name, where its base is and where its pixels are). A play from before buildings existed has none.
export const recordedBuildingSchema = buildingSchema.pick({ id: true, name: true, anchorY: true, extent: true });
export type RecordedBuilding = z.infer<typeof recordedBuildingSchema>;

// --- the API ------------------------------------------------------------------------------------------------------

export const BUILDING_API = "/api/buildings";
export const buildingSpritePath = (id: string) => `${BUILDING_API}/${id}/sprite.png`;
export const buildingJobPath = (jobId: string) => `${BUILDING_API}/jobs/${jobId}`;

// POST /api/buildings/next: the newest gallery building this player hasn't seen. When there is none, the server may start
// making one (within its limits) and answers with the job to poll.
export const nextBuildingRequestSchema = z.object({ seen: z.array(z.string()).max(500) });
export type NextBuildingRequest = z.infer<typeof nextBuildingRequestSchema>;

export const BUILDING_JOB_STEPS = JOB_STEPS;
export type BuildingJobStep = JobStep;

export type NextBuildingResponse =
  | { kind: "ready"; building: Building }
  | { kind: "generating"; jobId: string }
  // "busy": another job holds the one slot (a creature's, or a creature is waiting for it); ask again after the delay
  | { kind: "none"; reason: "rate-limited" | "unavailable" | "busy"; retryAfterSeconds?: number };

// GET /api/buildings/jobs/:jobId
export interface BuildingJob {
  jobId: string;
  step: BuildingJobStep;
  building?: Building; // when done
  error?: string; // when failed: a short reason, never model output or a stack trace
  updatedAt: string;
}
