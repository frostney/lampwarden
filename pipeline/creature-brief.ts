// The brief writer: one Mubit call (pipeline/prompts/creature.md) that invents the next creature as JSON, validated with
// the game's contract. The model picks a name, a lore line, a sprite brief, an archetype and four modifiers in
// {-1, 0, 1}; it never writes a stat number (creatureStats derives them from the archetype and the modifiers).
import { type Creature, creatureSchema } from "../src/game/creature";
import {
  type BriefResult as BriefOutcome,
  type BriefWriterBase,
  parseBrief,
  pickOne,
  writeValidatedBrief,
} from "./brief-writer";

const NAME_LIST_LIMIT = 80;
/** The monsters the game already has, which a new creature must not copy. */
const BUILT_IN_NAMES = ["Satyr", "Cyclops", "Harpy"];

/** What the model decides about a creature, and nothing else. */
const creatureBriefSchema = creatureSchema.pick({
  name: true,
  lore: true,
  brief: true,
  archetype: true,
  modifiers: true,
});
export type CreatureBrief = Pick<Creature, "name" | "lore" | "brief" | "archetype" | "modifiers">;

/** The first `{ ... }` span of a reply as a validated brief, or null. Fences and chatter around the JSON are tolerated. */
export function parseCreatureBrief(text: string | null): CreatureBrief | null {
  return parseBrief(creatureBriefSchema, text);
}

// Mubit takes no temperature, so the same prompt gets much the same creature every time. A thread of myth picked at
// random and offered as loose inspiration is what makes one night's creature differ from the next.
const INSPIRATIONS = [
  "Charybdis and her whirlpool",
  "Scylla's many dog-heads",
  "the Sirens' shore",
  "Proteus the shape-changer",
  "Triton and his conch",
  "the Nereids",
  "Glaucus the sea-god, half fish",
  "the Graeae sharing one eye",
  "the Telchines of Rhodes",
  "Echidna and her brood",
  "Poseidon's horses of the surf",
  "Cetus, the sea-beast of Andromeda",
  "Karkinos, the giant crab",
  "a drowned sailor still at his oar",
  "a wrecked trireme's ghost",
  "the Stymphalian birds",
  "Lamia and Empusa, the night-stalkers",
  "the Gorgons' sisters",
  "a sponge-diver's tale of the deep",
  "Thetis and her silver feet",
  "the Hydra's drowned cousin",
  "a lighthouse keeper's nightmare",
  "the Keres, spirits of doom",
  "Pontus, the old sea itself",
];

/** One thread of myth to start from, chosen with `random` (a number in [0, 1)). */
export function pickInspiration(random: () => number): string {
  return pickOne(INSPIRATIONS, random, "the Aegean at night");
}

export function briefRequestMessage(existingNames: readonly string[], inspiration: string): string {
  const names = [...BUILT_IN_NAMES, ...existingNames.slice(0, NAME_LIST_LIMIT)];
  return `Creatures that already exist (do not repeat or rename any of them):\n${names.map((name) => `- ${name}`).join("\n")}\n\nStart from this thread of myth, taking it as loosely as you like: ${inspiration}.\n\nInvent the next creature.`;
}

export type BriefResult = BriefOutcome<CreatureBrief>;

export interface BriefWriter extends BriefWriterBase {
  /** Picks the inspiration; defaults to Math.random. */
  random?: () => number;
}

/** Asks for a creature and validates the answer; one more try if the reply is not a valid brief or repeats a name. */
export function writeCreatureBrief(
  writer: BriefWriter,
  existingNames: readonly string[],
  session: string,
): Promise<BriefResult> {
  const inspiration = pickInspiration(writer.random ?? Math.random);
  return writeValidatedBrief(
    writer,
    {
      task: "brief",
      schema: creatureBriefSchema,
      nameOf: (brief) => brief.name,
      takenNames: [...BUILT_IN_NAMES, ...existingNames],
      message: briefRequestMessage(existingNames, inspiration),
    },
    session,
  );
}
