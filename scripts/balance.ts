// Headless balance check: plays nights with an idle warden and a simple bot, prints outcome rates.
// usage: bun scripts/balance.ts [runs=200]
import { newLegacy } from "../lib/legacy";
import { ground, type Input, litCount, MONSTER, type Monster, NO_INPUT, newNight, type State, step } from "../lib/sim";

function bot(state: State): Input {
  const hero = state.hero;
  let nearest: Monster | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const monster of state.monsters) {
    const distance = ground(monster.x, monster.y, hero.x, hero.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = monster;
    }
  }
  if (nearest && nearestDistance < state.rules.meleeReach - 8) return { ...NO_INPUT, melee: true };
  const dark = state.lamps
    .filter((lamp) => !lamp.lit)
    .sort((first, second) => ground(first.x, first.y, hero.x, hero.y) - ground(second.x, second.y, hero.x, hero.y))[0];
  // threat: the monster closest to a lit lamp
  let threat: Monster | null = null;
  let threatDistance = Number.POSITIVE_INFINITY;
  for (const monster of state.monsters)
    for (const lamp of state.lamps)
      if (lamp.lit) {
        const distance = ground(monster.x, monster.y, lamp.x, lamp.y);
        if (distance < threatDistance) {
          threatDistance = distance;
          threat = monster;
        }
      }
  const goal = dark && nearestDistance > 120 ? { x: dark.x, y: dark.y } : (threat ?? nearest);
  if (threat && hero.shotCd <= 0 && ground(threat.x, threat.y, hero.x, hero.y) > 180)
    return { ...NO_INPUT, ranged: true, aim: { x: threat.x, y: threat.y - (MONSTER[threat.kind].fly ? 56 : 32) } };
  if (!goal) return NO_INPUT;
  const towardX = goal.x - hero.x;
  const towardY = goal.y - hero.y;
  return {
    ...NO_INPUT,
    dx: Math.abs(towardX) > 10 ? Math.sign(towardX) : 0,
    dy: Math.abs(towardY) > 5 ? Math.sign(towardY) : 0,
  };
}

function play(night: number, tide: number, policy: "idle" | "bot") {
  const legacy = newLegacy();
  legacy.night = night;
  legacy.tide = tide;
  const state = newNight(legacy);
  let input = NO_INPUT;
  let think = 0;
  const stepSeconds = 1 / 60;
  while (!state.outcome) {
    think -= stepSeconds;
    if (think <= 0) {
      // ~150 ms reaction time
      input = policy === "bot" ? bot(state) : NO_INPUT;
      think = 0.15;
    }
    step(state, stepSeconds, input);
    if (input.melee || input.ranged) input = { ...input, melee: false, ranged: false };
  }
  return {
    outcome: state.outcome,
    time: state.elapsed,
    lit: litCount(state),
    kills: state.stats.kills,
    oil: state.oilEarned,
  };
}

const runs = Number(process.argv[2] || 200);
const SCENARIOS = [
  [1, 1],
  [2, 1],
  [3, 1.1],
  [5, 1.2],
  [7, 1.4],
] as const;
for (const policy of ["idle", "bot"] as const) {
  for (const [night, tide] of SCENARIOS) {
    const results = Array.from({ length: runs }, () => play(night, tide, policy));
    const percent = (outcome: string) =>
      ((100 * results.filter((result) => result.outcome === outcome).length) / runs).toFixed(0);
    const average = (measure: (result: (typeof results)[number]) => number) =>
      (results.reduce((total, result) => total + measure(result), 0) / runs).toFixed(1);
    console.log(
      `${policy.padEnd(4)} night ${night} tide ${tide}: dawn ${percent("dawn")}%  dark ${percent("dark")}%  fallen ${percent("fallen")}%  | ends at ${average((result) => result.time)}s, lamps ${average((result) => result.lit)}, kills ${average((result) => result.kills)}, oil ${average((result) => result.oil)}`,
    );
  }
}
