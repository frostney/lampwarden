// What the sea sends tonight, as the game knows it: one question to the gallery (src/game/creature-api.ts) at a time,
// asked with the ids the line has met, and the job that answers it followed for as long as the answer still matters. The
// asking itself (when a night begins and ends, a job that outlives a night, a busy slot) is src/game/gallery-sea.ts, shared
// with the plaza's buildings (src/game/building-sea.ts).
import type { JobStep } from "./creature";
import { askForCreature, waitForJob } from "./creature-api";
import type { CreatureRecord } from "./creature-frames";
import { createGallerySea } from "./gallery-sea";

export type Tonight =
  | { kind: "none" }
  | { kind: "ready"; creature: CreatureRecord }
  | { kind: "generating"; step: JobStep };

export interface SeaDeps {
  askForCreature: typeof askForCreature;
  waitForJob: typeof waitForJob;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function createSea(deps: SeaDeps = { askForCreature, waitForJob }) {
  return createGallerySea<CreatureRecord, { kind: "ready"; creature: CreatureRecord }>({
    ask: async (seen) => {
      const answer = await deps.askForCreature(seen);
      if (answer?.kind === "ready") {
        return { kind: "ready", made: answer.creature };
      }
      return answer;
    },
    wait: deps.waitForJob,
    ready: (creature) => ({ kind: "ready", creature }),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
}
