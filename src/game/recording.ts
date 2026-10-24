// Play recording for testing and balancing. A night is fully determined by its seed, the legacy it started from and the
// warden's inputs at a fixed 60 Hz step, so a recording is just those inputs (only when they change) plus a per-second
// timeline that the balance analysis can read without replaying anything. Nothing here decides how a night plays out
// (that is the sim and replay.ts), so editing this file does not change the sim fingerprint (tools/sim-fingerprint).
import type { RecordedCreature } from "./creature";
import type { Legacy } from "./legacy";
import { type Input, litCount, type State } from "./sim";

// [step, moveX, moveY, melee, ranged, aimX, aimY]   (aim -1,-1 = no aim)
type InputRow = [number, number, number, number, number, number, number];
// [second, kills, lampsLit, health, monsters, lampsLost]
type TimelineRow = [number, number, number, number, number, number];

export interface Play {
  v: 1;
  id: string;
  session: string; // random per browser, no personal data
  build: string; // git sha of the deployment, when known
  sim?: string; // fingerprint of the sim sources the night was played on (tools/sim-fingerprint); old plays have none
  startedAt: string;
  seed: number;
  // levels as recorded: a play from before an upgrade existed has no entry for it (level 0, see legacyOf). The director
  // is the decision the night was played under (mix and creature share); a play from before it has none (the rules').
  legacy: Pick<Legacy, "night" | "generation" | "tide" | "heir"> & {
    levels: Partial<Legacy["levels"]>;
    director?: unknown;
  };
  // the creature from the sea that joined the night, when one did; a play from before creatures has none
  creature?: RecordedCreature;
  inputs: InputRow[];
  timeline: TimelineRow[];
  steps: number;
  outcome: string | null; // dawn | dark | fallen | null when abandoned
  // hp and maxHp are the warden's health and maxHealth; the keys stay as recorded so stored plays still read
  stats: State["stats"] & { oilEarned: number; hp: number; maxHp: number; lit: number };
  // Real seconds from the night's start to its end, from a monotonic clock. The sim stops when the tab is hidden, so this
  // minus steps / 60 is the time away (src/game/engagement.ts). Plays from before it was kept have none.
  wallSeconds?: number;
  replay?: { endsMatch: boolean }; // filled in when a recording is verified by replay
}

const randomId = () => Math.random().toString(36).slice(2, 10);
function sessionId(): string {
  try {
    let session = localStorage.getItem("lampwarden:session");
    if (!session) {
      session = randomId() + randomId();
      localStorage.setItem("lampwarden:session", session);
    }
    return session;
  } catch {
    return "anon";
  }
}

export class Recorder {
  play: Play;
  private last: InputRow | null = null;
  private readonly startedClock = performance.now();
  constructor(
    legacy: Legacy,
    seed: number,
    build: string,
    creature: RecordedCreature | null = null,
    sim: string | undefined = undefined,
  ) {
    const { night, generation, tide, levels, heir, director } = legacy;
    this.play = {
      v: 1,
      id: `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${randomId()}`,
      session: sessionId(),
      build,
      ...(sim ? { sim } : {}),
      startedAt: new Date().toISOString(),
      seed,
      legacy: structuredClone({ night, generation, tide, levels, heir, director }),
      ...(creature ? { creature: structuredClone(creature) } : {}),
      inputs: [],
      timeline: [],
      steps: 0,
      outcome: null,
      stats: { kills: 0, lampsLost: 0, hpLost: 0, time: 0, oilEarned: 0, hp: 0, maxHp: 0, lit: 0 },
    };
  }
  // call once per sim step with the input about to be applied; state is the state after steps 0..stepIndex-1
  input(stepIndex: number, input: Input, state: State) {
    this.play.steps = stepIndex + 1;
    if (stepIndex > 0 && stepIndex % 60 === 0)
      this.play.timeline.push([
        stepIndex / 60,
        state.stats.kills,
        litCount(state),
        Math.ceil(state.hero.health),
        state.monsters.length,
        state.stats.lampsLost,
      ]);
    const row: InputRow = [
      stepIndex,
      input.moveX,
      input.moveY,
      input.melee ? 1 : 0,
      input.ranged ? 1 : 0,
      input.aim ? input.aim.x : -1,
      input.aim ? input.aim.y : -1,
    ];
    const last = this.last;
    if (!last || row[3] || row[4] || last[1] !== row[1] || last[2] !== row[2]) {
      this.play.inputs.push(row);
      this.last = row;
    }
  }
  finish(state: State): Play {
    const play = this.play;
    play.wallSeconds = Math.round((performance.now() - this.startedClock) / 100) / 10;
    play.outcome = state.outcome;
    play.stats = {
      ...state.stats,
      oilEarned: state.oilEarned,
      hp: Math.ceil(state.hero.health),
      maxHp: state.hero.maxHealth,
      lit: litCount(state),
    };
    return play;
  }
}

export async function upload(play: Play): Promise<boolean> {
  try {
    const body = JSON.stringify(play);
    const response = await fetch("/api/plays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: body.length < 60000,
    });
    return response.ok;
  } catch {
    return false;
  }
}
