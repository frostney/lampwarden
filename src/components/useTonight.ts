"use client";
// What the sea sends tonight, as the game knows it before a night: asks the gallery (src/game/creature-api.ts) with the
// ids the line has met and follows a job that is still making one. It never blocks play: while it is asking, when
// nothing is coming and when the network fails, the answer is "none" and the night simply has no new creature.
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobStep } from "@/game/creature";
import { askForCreature, waitForJob } from "@/game/creature-api";
import type { CreatureRecord } from "@/game/creature-frames";

export type Tonight =
  | { kind: "none" }
  | { kind: "ready"; creature: CreatureRecord }
  | { kind: "generating"; step: JobStep };

const NONE: Tonight = { kind: "none" };

export function useTonight() {
  const [tonight, setTonight] = useState<Tonight>(NONE);
  const asking = useRef(0); // which asking is current; an older one's answer is dropped

  // Asks the sea which creature comes tonight; what it answers replaces whatever was shown before.
  const ask = useCallback((seen: string[]) => {
    const mine = ++asking.current;
    const isCurrent = () => mine === asking.current;
    setTonight(NONE);
    void (async () => {
      const answer = await askForCreature(seen);
      if (!isCurrent() || !answer) return;
      if (answer.kind === "ready") setTonight({ kind: "ready", creature: answer.creature });
      if (answer.kind !== "generating") return;
      setTonight({ kind: "generating", step: "queued" });
      const creature = await waitForJob(answer.jobId, {
        onStep: (step) => isCurrent() && setTonight({ kind: "generating", step }),
        isCurrent,
      });
      if (isCurrent()) setTonight(creature ? { kind: "ready", creature } : NONE);
    })();
  }, []);

  // The night begins (or the page goes): whatever is still being made is no longer waited for.
  const stop = useCallback(() => {
    asking.current++;
  }, []);
  useEffect(() => stop, [stop]);

  // The creature cannot come after all (its sprite did not load): nothing is announced.
  const withdraw = useCallback(
    (creatureId: string) =>
      setTonight((current) => (current.kind === "ready" && current.creature.id === creatureId ? NONE : current)),
    [],
  );

  return { tonight, ask, stop, withdraw };
}
