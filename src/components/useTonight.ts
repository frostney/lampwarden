"use client";
// The sea's answer for the coming night as a hook; the asking itself, and when it is kept or made again, is in
// src/game/sea.ts. `settled` is for the building's question, which goes after the creature's.
import { useEffect, useState, useSyncExternalStore } from "react";

import { createSea } from "@/game/sea";

export function useTonight() {
  const [sea] = useState(() => createSea());
  const tonight = useSyncExternalStore(sea.subscribe, sea.get, sea.get);
  useEffect(() => sea.dispose, [sea]);
  return { tonight, ask: sea.ask, withdraw: sea.withdraw, settled: sea.settled };
}
