// Play recording for testing and balancing. A night is fully determined by its seed, the legacy it started from and the
// warden's inputs at a fixed 60 Hz step, so a recording is just those inputs (only when they change) plus a per-second
// timeline that the balance analysis can read without replaying anything.
import { type Legacy, levelsOf } from "./legacy";
import { type Input, litCount, newNight, type State, step } from "./sim";

export const STEP = 1 / 60;

// [step, moveX, moveY, melee, ranged, aimX, aimY]   (aim -1,-1 = no aim)
type InputRow = [number, number, number, number, number, number, number];
// [second, kills, lampsLit, health, monsters, lampsLost]
type TimelineRow = [number, number, number, number, number, number];

export interface Play {
  v: 1;
  id: string;
  session: string; // random per browser, no personal data
  build: string; // git sha of the deployment, when known
  startedAt: string;
  seed: number;
  // levels as recorded: a play from before an upgrade existed has no entry for it (level 0, see legacyOf)
  legacy: Pick<Legacy, "night" | "generation" | "tide" | "heir"> & { levels: Partial<Legacy["levels"]> };
  inputs: InputRow[];
  timeline: TimelineRow[];
  steps: number;
  outcome: string | null; // dawn | dark | fallen | null when abandoned
  // hp and maxHp are the warden's health and maxHealth; the keys stay as recorded so stored plays still read
  stats: State["stats"] & { oilEarned: number; hp: number; maxHp: number; lit: number };
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

// Inputs are quantised before they reach the sim, so live play and replay see identical numbers.
export function quantise(input: Input): Input {
  return input.aim ? { ...input, aim: { x: Math.round(input.aim.x), y: Math.round(input.aim.y) } } : input;
}

export class Recorder {
  play: Play;
  private last: InputRow | null = null;
  constructor(legacy: Legacy, seed: number, build: string) {
    const { night, generation, tide, levels, heir } = legacy;
    this.play = {
      v: 1,
      id: `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${randomId()}`,
      session: sessionId(),
      build,
      startedAt: new Date().toISOString(),
      seed,
      legacy: structuredClone({ night, generation, tide, levels, heir }),
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

// Feeds a recording's inputs back step by step.
export class Replayer {
  private nextRow = 0;
  private current: Input = { moveX: 0, moveY: 0, melee: false, ranged: false, aim: null };
  constructor(public play: Play) {}
  input(stepIndex: number): Input {
    const rows = this.play.inputs;
    let edge = false;
    let row = rows[this.nextRow];
    while (row && row[0] <= stepIndex) {
      const [rowStep, moveX, moveY, melee, ranged, aimX, aimY] = row;
      this.current = {
        moveX,
        moveY,
        melee: melee === 1,
        ranged: ranged === 1,
        aim: aimX >= 0 ? { x: aimX, y: aimY } : null,
      };
      edge = rowStep === stepIndex;
      this.nextRow++;
      row = rows[this.nextRow];
    }
    return edge ? this.current : { ...this.current, melee: false, ranged: false };
  }
}

export function legacyOf(play: Play): Legacy {
  return {
    ...play.legacy,
    levels: levelsOf(play.legacy.levels),
    offerSeed: 0,
    offers: [],
    bestNight: 0,
    oil: 0,
    fallen: [],
  };
}

// Replays a recording headlessly and reports whether it ends where the live play ended.
export function verifyPlay(play: Play): { state: State; endsMatch: boolean } {
  const state = newNight(legacyOf(play), play.seed);
  const replayer = new Replayer(play);
  for (let stepIndex = 0; stepIndex < play.steps && !state.outcome; stepIndex++)
    step(state, STEP, replayer.input(stepIndex));
  const endsMatch =
    state.outcome === play.outcome &&
    state.stats.kills === play.stats.kills &&
    state.stats.lampsLost === play.stats.lampsLost;
  return { state, endsMatch };
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
