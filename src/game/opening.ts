// The opening scene a new player sees before the title: a staged night (staged.ts) on the plaza, told in four lines.
// The lamps burn; the sea sends a satyr and a harpy, and a lamp goes out; the warden, played by code, fights them off and
// relights it; then the last line, and the title. Each line waits for what it tells of, within bounds, so the scene
// reads the same at any frame rate: everything runs on the sim's clock, one step at a time, from a fixed seed.

import type { Sex } from "../scene/assets";
import { newLegacy } from "./legacy";
import { emptyLevels } from "./levels";
import { CENTRE_X, CENTRE_Y, type HandMadeKind, type Input, litCount, NO_INPUT, type State, WARDEN } from "./sim";
import { spare, stagedNight, summon, toward, wardenAutopilot } from "./staged";

export const OPENING_LINES = [
  "Lychnos is a harbour of lamps.",
  "Every night the sea sends its creatures to put them out.",
  "A lampwarden fights them off and lights the lamps again.",
  "When a warden falls, an heir takes up the lamp.",
] as const;

// the night the opening is played on, so its plaza is always the same one
const OPENING_SEED = 0x5eed1;
// the lines, by their place in OPENING_LINES
const LINE = { harbour: 0, sea: 1, fight: 2, heir: 3 };
const FIRST_RISE = 2.2; // seconds in, the first creature comes out of the sea
// who comes out of the sea, when (seconds in) and where on the rim (in half turns): a satyr by the front left lamp, a
// harpy from the east
const SUMMONS: { at: number; kind: HandMadeKind; halfTurns: number }[] = [
  { at: FIRST_RISE, kind: "satyr", halfTurns: 0.66 },
  { at: 2.8, kind: "harpy", halfTurns: -0.04 },
];
// the second line comes as the sea's creatures do
const SEA_LINE_AFTER = 0.6;
const SEA_LINE_AT = FIRST_RISE + SEA_LINE_AFTER;
// the third line comes when a lamp goes out, but not before the second has been read, and not much after
const FIGHT_LINE = { earliest: 3.5, latest: 9 };
// the last line comes when the plaza is quiet again, after the fight has had time to be seen
const LAST_LINE = { earliest: 4, latest: 10 };
const LAST_LINE_HOLD = 4.5; // seconds the last line is read before the title
// where the warden stands while the lines are read: where a night starts him
const POST = { x: CENTRE_X, y: CENTRE_Y + WARDEN.startBelowCentre };
const AT_POST = 8; // how near his post counts as there

export interface Opening {
  state: State;
  line: number; // the line on screen, an index into OPENING_LINES
  lineFrom: number; // the sim seconds it came at
  summoned: number; // how many of SUMMONS have come ashore
  ended: boolean;
}

// The warden of the opening is a new line's, with the player's choice of son or daughter: no upgrades and the first
// heir's trait, so the fight plays the same for every player.
export const newOpening = (sex: Sex): Opening => ({
  state: stagedNight({ heir: { ...newLegacy(0).heir, sex }, levels: emptyLevels() }, OPENING_SEED),
  line: 0,
  lineFrom: 0,
  summoned: 0,
  ended: false,
});

const next = (opening: Opening) => {
  opening.line++;
  opening.lineFrom = opening.state.elapsed;
};

// Before each step: what comes ashore, which line is on screen, and the warden's input (still until the fight's line,
// then the autopilot, then back to his post).
export function stageOpening(opening: Opening): Input {
  const { state } = opening;
  spare(state);
  const seconds = state.elapsed;
  const since = seconds - opening.lineFrom;
  for (let entry = SUMMONS[opening.summoned]; entry && seconds >= entry.at; entry = SUMMONS[opening.summoned]) {
    summon(state, entry.kind, Math.PI * entry.halfTurns);
    opening.summoned++;
  }
  const quiet =
    opening.summoned === SUMMONS.length && state.monsters.length === 0 && litCount(state) === state.lamps.length;
  if (opening.line === LINE.harbour && seconds >= SEA_LINE_AT) {
    next(opening);
  } else if (
    opening.line === LINE.sea &&
    since >= FIGHT_LINE.earliest &&
    (litCount(state) < state.lamps.length || since >= FIGHT_LINE.latest)
  ) {
    next(opening);
  } else if (opening.line === LINE.fight && since >= LAST_LINE.earliest && (quiet || since >= LAST_LINE.latest)) {
    next(opening);
  } else if (opening.line === LINE.heir && since >= LAST_LINE_HOLD) {
    opening.ended = true;
  }
  if (opening.line < LINE.fight) {
    return NO_INPUT;
  }
  return wardenAutopilot(state) ?? toward(state, POST.x, POST.y, AT_POST);
}
