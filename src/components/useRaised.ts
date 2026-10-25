"use client";
// The building that goes up on the plaza tonight, as a hook; the asking itself is src/game/building-sea.ts. Like the
// creature (useTonight.ts) it never blocks play: while it is asking, when nothing is coming and when the network fails,
// the answer is "none" and the night has the plaza it always had.
import { useEffect, useState, useSyncExternalStore } from "react";

import { createBuildingSea } from "@/game/building-sea";

export function useRaised() {
  const [sea] = useState(() => createBuildingSea());
  const raised = useSyncExternalStore(sea.subscribe, sea.get, sea.get);
  useEffect(() => sea.dispose, [sea]);
  return { raised, ask: sea.ask, withdraw: sea.withdraw };
}
