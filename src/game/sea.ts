// What the sea sends tonight, as the game knows it: one question to the gallery (src/game/creature-api.ts) at a time,
// asked with the ids the line has met, and the job that answers it followed for as long as the answer still matters.
//
// The game asks when a night begins as well as when it ends. A night that begins asks for the NEXT night's creature,
// so a job that takes about a minute is generated while the player plays: ready by dawn on the longer nights, and
// while the dawn panel is up on the 28 to 40 s ones (the night never waits for it). Asking
// again about the same question (the same ids met) keeps the running one: a job that is still being made when a night
// begins is not dropped, it carries on through the night. It never blocks play: while it is asking, when nothing is
// coming and when the network fails, the answer is "none" and the night simply has no new creature.
import type { JobStep } from "./creature";
import { askForCreature, waitForJob } from "./creature-api";
import type { CreatureRecord } from "./creature-frames";

export type Tonight =
  | { kind: "none" }
  | { kind: "ready"; creature: CreatureRecord }
  | { kind: "generating"; step: JobStep };

const NONE: Tonight = { kind: "none" };

export interface SeaDeps {
  askForCreature: typeof askForCreature;
  waitForJob: typeof waitForJob;
}

interface Asking {
  /** The question: the ids the line has met. */
  key: string;
  /** False once it ended with nothing to show (none coming, the job failed, the network failed, the sprite broke). */
  alive: boolean;
  creatureId: string | null;
}

export function createSea(deps: SeaDeps = { askForCreature, waitForJob }) {
  let tonight: Tonight = NONE;
  let generation = 0; // which asking is current; an older one's answer is dropped
  let current: Asking | null = null;
  const listeners = new Set<() => void>();

  const show = (next: Tonight) => {
    tonight = next;
    for (const listener of listeners) listener();
  };

  /**
   * Asks the sea which creature comes next, given the ids the line has met. The same question while its asking is
   * still alive (in flight, being made, or ready) changes nothing; otherwise what it answers replaces what was shown.
   */
  const ask = (seen: readonly string[]) => {
    const key = [...seen].sort().join(",");
    if (current?.key === key && current.alive) return;
    const mine = ++generation;
    const isCurrent = () => mine === generation;
    const asking: Asking = { key, alive: true, creatureId: null };
    current = asking;
    show(NONE);
    const answering = (async () => {
      const answer = await deps.askForCreature([...seen]);
      if (!isCurrent()) return;
      if (!answer || answer.kind === "none") {
        asking.alive = false;
        return;
      }
      if (answer.kind === "ready") {
        asking.creatureId = answer.creature.id;
        show({ kind: "ready", creature: answer.creature });
        return;
      }
      show({ kind: "generating", step: "queued" });
      const creature = await deps.waitForJob(answer.jobId, {
        onStep: (step) => isCurrent() && show({ kind: "generating", step }),
        isCurrent,
      });
      if (!isCurrent()) return;
      asking.creatureId = creature?.id ?? null;
      asking.alive = creature !== null;
      show(creature ? { kind: "ready", creature } : NONE);
    })();
    // the game's own calls never throw, but whatever is injected may: the asking ends and the next one is a new one
    answering.catch(() => {
      if (!isCurrent()) return;
      asking.alive = false;
      show(NONE);
    });
  };

  // The creature cannot come after all (its sprite did not load): nothing is announced, and the next asking is a new one.
  const withdraw = (creatureId: string) => {
    if (current?.creatureId === creatureId) current.alive = false;
    if (tonight.kind === "ready" && tonight.creature.id === creatureId) show(NONE);
  };

  // The page goes: whatever is still being made is no longer waited for.
  const dispose = () => {
    generation++;
    current = null;
  };

  const get = () => tonight;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, subscribe, ask, withdraw, dispose };
}
