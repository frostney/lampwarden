// The building brief writer: one Mubit call (pipeline/prompts/building.md, its own fixed system prompt and its own Mubit
// task) that invents the next building of the plaza as JSON, validated with the game's contract. The model picks a name and
// a sprite brief; where the building's pixels are is measured from what is drawn, never taken from the model.
import { type BuildingBrief, buildingBriefSchema } from "../src/game/building";
import { type BriefResult, type BriefWriterBase, parseBrief, pickOne, writeValidatedBrief } from "./brief-writer";

const NAME_LIST_LIMIT = 80;
/** The Mubit task a building brief is logged under: its own, apart from the creatures' "brief". */
export const BUILDING_BRIEF_TASK = "building-brief";
/** The buildings the plaza already has, which a new one must not copy. */
const COMMITTED_NAMES = ["Temple", "House", "Town house", "Stall", "Sea wall"];

/** The first `{ ... }` span of a reply as a validated brief, or null. Fences and chatter around the JSON are tolerated. */
export function parseBuildingBrief(text: string | null): BuildingBrief | null {
  return parseBrief(buildingBriefSchema, text);
}

// Mubit takes no temperature, so the same prompt gets much the same building every time. A kind of building picked at
// random and offered as loose inspiration is what makes one night's building differ from the next.
const INSPIRATIONS = [
  "a stoa where the harbour merchants meet",
  "a fountain house that serves the lower town",
  "a small shrine to Poseidon at the quay",
  "a granary beside the harbour",
  "a potter's workshop with its kiln and amphorae",
  "a watchtower over the harbour mouth",
  "a net-menders' shed on the shore",
  "a treasury of the sea-captains",
  "an inn for sailors",
  "a bakery that opens before dawn",
  "a customs house where cargoes are weighed",
  "a gymnasium porch where the young train",
  "a fisher's house with a tiled roof",
  "a shrine to Hermes of the travellers",
  "a wine merchant's store",
  "a ship-shed for the town's triremes",
  "a tavern under a vine",
  "a priest's house beside the temple",
  "a sponge-diver's guildhall",
  "a loom-house where the women weave sails",
  "a small shrine to Aphrodite of the sea-foam",
  "a bathhouse with a tiled roof",
  "an olive-press house",
  "a well-house with a stone roof",
];

/** One kind of building to start from, chosen with `random` (a number in [0, 1)). */
export function pickBuildingInspiration(random: () => number): string {
  return pickOne(INSPIRATIONS, random, "a house by the harbour");
}

export function buildingRequestMessage(existingNames: readonly string[], inspiration: string): string {
  const names = [...COMMITTED_NAMES, ...existingNames.slice(0, NAME_LIST_LIMIT)];
  return `Buildings that already exist (do not repeat or rename any of them):\n${names.map((name) => `- ${name}`).join("\n")}\n\nStart from this kind of building, taking it as loosely as you like: ${inspiration}.\n\nInvent the next building.`;
}

export interface BuildingBriefWriter extends BriefWriterBase {
  /** Picks the inspiration; defaults to Math.random. */
  random?: () => number;
}

/** Asks for a building and validates the answer; one more try if the reply is not a valid brief or repeats a name. */
export function writeBuildingBrief(
  writer: BuildingBriefWriter,
  existingNames: readonly string[],
  session: string,
): Promise<BriefResult<BuildingBrief>> {
  const inspiration = pickBuildingInspiration(writer.random ?? Math.random);
  return writeValidatedBrief(
    writer,
    {
      task: BUILDING_BRIEF_TASK,
      schema: buildingBriefSchema,
      nameOf: (brief) => brief.name,
      takenNames: [...COMMITTED_NAMES, ...existingNames],
      message: buildingRequestMessage(existingNames, inspiration),
    },
    session,
  );
}
