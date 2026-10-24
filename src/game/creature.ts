// A creature the sea sends: generated live through Mubit (brief, sprite code, render, verify) and kept in a shared
// gallery, so most nights meet one that is already made. This module is the contract between the server that makes
// them (src/app/api/creatures) and the game that meets them: the record, how its stats follow from an archetype, and
// the API's request and response shapes. Stats are derived here, from the archetype and bounded modifiers, never taken
// from the model as numbers, so a creature can't come out unbeatable.
import { z } from "zod";

// Each archetype plays like one of the hand-made monsters, which sets its base stats.
export const ARCHETYPES = ["skulker", "brute", "flyer"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface CreatureStats {
  speed: number;
  health: number;
  damage: number;
  snuff: number; // seconds of clawing to put a lamp out
  oil: number; // what a kill leaves when it drops oil at all
  fly: boolean;
  recoil: number; // how far a blow throws it
}

const ARCHETYPE_BASE: Record<Archetype, CreatureStats> = {
  skulker: { speed: 50, health: 1, damage: 8, snuff: 2.6, oil: 1, fly: false, recoil: 1 }, // the satyr
  brute: { speed: 30, health: 3, damage: 16, snuff: 1.5, oil: 2, fly: false, recoil: 0.6 }, // the cyclops
  flyer: { speed: 76, health: 1, damage: 6, snuff: 3.2, oil: 1, fly: true, recoil: 1.3 }, // the harpy
};

// The model picks each modifier from -1 (weaker on that axis) to 1 (stronger); a step moves the stat by its share.
export const MODIFIER_NAMES = ["speed", "toughness", "bite", "snuffing"] as const;
type ModifierName = (typeof MODIFIER_NAMES)[number];
export type Modifiers = Record<ModifierName, -1 | 0 | 1>;

const STEP = { speed: 0.15, bite: 0.2, snuffing: 0.2 };

export function creatureStats(archetype: Archetype, modifiers: Modifiers): CreatureStats {
  const base = ARCHETYPE_BASE[archetype];
  return {
    ...base,
    speed: Math.round(base.speed * (1 + STEP.speed * modifiers.speed)),
    // toughness adds or removes one hit, never below one
    health: Math.max(1, base.health + modifiers.toughness),
    damage: Math.round(base.damage * (1 + STEP.bite * modifiers.bite)),
    // stronger snuffing puts a lamp out faster
    snuff: Math.round(base.snuff * (1 - STEP.snuffing * modifiers.snuffing) * 10) / 10,
  };
}

const modifierSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

export const creatureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{8,80}$/),
  name: z.string().min(2).max(40), // "Brine hound"
  lore: z.string().min(8).max(160), // one line shown before the night it comes
  brief: z.string().min(8).max(400), // the sprite brief the generator drew from
  archetype: z.enum(ARCHETYPES),
  modifiers: z.object({
    speed: modifierSchema,
    toughness: modifierSchema,
    bite: modifierSchema,
    snuffing: modifierSchema,
  }),
  anchorY: z.number().min(0.5).max(1), // where its feet touch the ground, as a fraction of the 128 px frame
  score: z.number().min(0).max(10), // the verifier's score for the accepted sprite
  createdAt: z.string(), // ISO time
});
export type Creature = z.infer<typeof creatureSchema>;

export const statsOf = (creature: Pick<Creature, "archetype" | "modifiers">) =>
  creatureStats(creature.archetype, creature.modifiers);

// --- the API ------------------------------------------------------------------------------------------------------

export const CREATURE_API = "/api/creatures";
export const creatureSpritePath = (id: string) => `${CREATURE_API}/${id}/sprite.png`;
export const creatureJobPath = (jobId: string) => `${CREATURE_API}/jobs/${jobId}`;

// POST /api/creatures/next: the newest gallery creature this player hasn't met. When there is none, the server may
// start making one (within its rate limits) and answers with the job to poll.
export const nextCreatureRequestSchema = z.object({ seen: z.array(z.string()).max(500) });
export type NextCreatureRequest = z.infer<typeof nextCreatureRequestSchema>;

export const JOB_STEPS = ["queued", "writing", "drawing", "rendering", "judging", "fixing", "done", "failed"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export type NextCreatureResponse =
  | { kind: "ready"; creature: Creature }
  | { kind: "generating"; jobId: string }
  | { kind: "none"; reason: "rate-limited" | "unavailable"; retryAfterSeconds?: number };

// GET /api/creatures/jobs/:jobId
export interface CreatureJob {
  jobId: string;
  step: JobStep;
  creature?: Creature; // when done
  error?: string; // when failed: a short reason, never model output or a stack trace
  updatedAt: string;
}
