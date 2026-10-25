// The building that goes up on the plaza tonight, as the game knows it: the same asking as the creature from the sea
// (src/game/gallery-sea.ts), against the buildings API (src/game/building-api.ts), with the ids of the buildings the line
// has seen. A building is scenery: it never blocks play, and a night without one has the plaza it always had.
import type { Building } from "./building";
import { askForBuilding, waitForBuildingJob } from "./building-api";
import type { JobStep } from "./creature";
import { createGallerySea } from "./gallery-sea";

export type RaisedTonight =
  | { kind: "none" }
  | { kind: "ready"; building: Building }
  | { kind: "generating"; step: JobStep };

export interface BuildingSeaDeps {
  askForBuilding: typeof askForBuilding;
  waitForBuildingJob: typeof waitForBuildingJob;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function createBuildingSea(deps: BuildingSeaDeps = { askForBuilding, waitForBuildingJob }) {
  return createGallerySea<Building, { kind: "ready"; building: Building }>({
    ask: async (seen) => {
      const answer = await deps.askForBuilding(seen);
      if (answer?.kind === "ready") {
        return { kind: "ready", made: answer.building };
      }
      return answer;
    },
    wait: deps.waitForBuildingJob,
    ready: (building) => ({ kind: "ready", building }),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
}
