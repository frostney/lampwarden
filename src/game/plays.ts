// Recorded plays: what the API routes that store and serve them share.
import { z } from "zod";
import { creatureSchema } from "./creature";

export const PLAY_ID = /^[0-9-]{19}-[a-z0-9]{1,10}$/;

// The creature a night met, as the recording keeps it: enough to build the same night again (id, archetype, modifiers,
// anchorY) and to name it in reports. A play from before creatures existed has none.
export const recordedCreatureSchema = creatureSchema.pick({
  id: true,
  name: true,
  archetype: true,
  modifiers: true,
  anchorY: true,
});
export type RecordedCreature = ReturnType<typeof recordedCreatureSchema.parse>;

// The shape a client must send to /api/plays; everything else in the recording is stored as sent.
export const incomingPlay = z.looseObject({
  v: z.literal(1),
  id: z.string().regex(PLAY_ID),
  seed: z.number().int(),
  inputs: z.array(z.array(z.number()).length(7)),
  creature: recordedCreatureSchema.optional(), // the creature from the sea the night met; plays from before have none
});
