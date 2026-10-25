// A stored play shaped like the nights real people lost on night 2 (the crowd piles up, the lamps go dark one by one, health
// collapses at the end), for the director's tests. Numbers are made up to that shape; no recorded play is committed.
import type { Director } from "@/game/director";

export const FIXTURE_PLAY_ID = "2026-10-24-16-11-46-juith2u0";

// [second, kills, lampsLit, health, monsters, lampsLost]
const LOST_TIMELINE: number[][] = [
  [1, 0, 5, 100, 0, 0],
  [2, 0, 5, 100, 0, 0],
  [3, 0, 5, 100, 1, 0],
  [4, 1, 5, 100, 1, 0],
  [5, 1, 5, 100, 2, 0],
  [6, 1, 5, 100, 3, 0],
  [7, 1, 5, 100, 3, 0],
  [8, 1, 4, 100, 4, 1],
  [9, 1, 4, 100, 5, 1],
  [10, 1, 4, 100, 5, 1],
  [11, 1, 3, 100, 6, 2],
  [12, 2, 2, 100, 6, 3],
  [13, 2, 2, 100, 7, 3],
  [14, 2, 1, 88, 6, 4],
  [15, 2, 1, 88, 6, 4],
  [16, 2, 1, 82, 7, 4],
  [17, 2, 1, 60, 7, 4],
  [18, 2, 0, 38, 7, 5],
];

export interface FixtureOverrides {
  id?: string;
  session?: string;
  night?: number;
  tide?: number;
  outcome?: "dawn" | "dark" | "fallen" | null;
  director?: Director;
  /** What the warden did: "engaged" (the default: moving most of the night, a strike or shot every few seconds) or "idle" (nothing). */
  hands?: "engaged" | "idle";
  /** Seconds the tab was hidden during the night, when the recording keeps them. */
  hiddenSeconds?: number;
}

// [step, moveX, moveY, strike, shot, aimX, aimY] every half second: walking, with a strike every third change and a shot every fourth
function engagedInputs(steps: number): number[][] {
  const rows: number[][] = [];
  for (let step = 0, index = 0; step < steps; step += 30, index++) {
    rows.push([
      step,
      index % 2 === 0 ? 1 : 0,
      index % 2 === 0 ? 0 : 1,
      index % 3 === 0 ? 1 : 0,
      index % 4 === 0 ? 1 : 0,
      400,
      300,
    ]);
  }
  return rows;
}

/** A recorded play as the plays store holds it (JSON), by default a night 2 lost to the dark in 18 seconds. */
export function lostNightTwo(overrides: FixtureOverrides = {}) {
  return {
    v: 1,
    id: overrides.id ?? FIXTURE_PLAY_ID,
    seed: 123,
    inputs: overrides.hands === "idle" ? [] : engagedInputs(1102),
    session: overrides.session ?? "soipj2xp240eqfxx",
    build: "test",
    startedAt: "2026-10-24T16:11:46.000Z",
    legacy: {
      night: overrides.night ?? 2,
      generation: 1,
      tide: overrides.tide ?? 1.1,
      levels: { wick: 0, blade: 2, quiver: 0, heart: 0 },
      heir: { name: "Lykos", sex: "male", trait: "swift" },
      ...(overrides.director ? { director: overrides.director } : {}),
    },
    timeline: LOST_TIMELINE,
    steps: 1102,
    outcome: overrides.outcome === undefined ? "dark" : overrides.outcome,
    stats: { kills: 2, lampsLost: 5, hpLost: 62, time: 18.37, oilEarned: 0, hp: 38, maxHp: 100, lit: 0 },
    ...(overrides.hiddenSeconds === undefined ? {} : { hiddenSeconds: overrides.hiddenSeconds }),
    receivedAt: "2026-10-24T16:12:12.000Z",
  };
}
