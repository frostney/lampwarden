// Headless balance check: plays nights with an idle warden, a perfect bot and a human-paced bot, prints outcome rates.
// usage: bun scripts/balance.ts [runs=200] [only=all|idle|bot|human|creatures]; seeded, so two builds are compared on the same
// nights. The perfect bot (reads the state, 150 ms reaction) is the ceiling; the human-paced one (scripts/human-bot.ts)
// is what the difficulty curve is tuned on.
import { consumePresses, liveInput, newControls } from "../src/game/controls";
import { ARCHETYPES, type Modifiers } from "../src/game/creature";
import { buy, type Legacy, MAX_LEVEL, newLegacy, openShop, UPGRADE_IDS, upgradeCost } from "../src/game/legacy";
import { STEP } from "../src/game/replay";
import {
  bodyHeight,
  dawnBonus,
  ground,
  type Input,
  litCount,
  type Monster,
  type NightCreature,
  NO_INPUT,
  newNight,
  nextTide,
  nightCreature,
  type Outcome,
  type State,
  step,
} from "../src/game/sim";
import { humanBot } from "./human-bot";

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
  if (nearest && nearestDistance < state.rules.meleeReach - 8) {
    // swing towards the monster: a direction held with the strike turns the warden to face it
    const towardX = nearest.x - hero.x;
    const towardY = (nearest.y - hero.y) * 2;
    return { ...NO_INPUT, melee: true, moveX: towardX / nearestDistance, moveY: towardY / nearestDistance };
  }
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
  if (threat && hero.shotCooldown <= 0 && ground(threat.x, threat.y, hero.x, hero.y) > 180)
    return { ...NO_INPUT, ranged: true, aim: { x: threat.x, y: threat.y - bodyHeight(state, threat.kind) } };
  if (!goal) return NO_INPUT;
  const towardX = goal.x - hero.x;
  const towardY = goal.y - hero.y;
  return {
    ...NO_INPUT,
    moveX: Math.abs(towardX) > 10 ? Math.sign(towardX) : 0,
    moveY: Math.abs(towardY) > 5 ? Math.sign(towardY) : 0,
  };
}

type Policy = "idle" | "bot" | "human";

function playNight(legacy: Legacy, policy: Policy, seed: number, creature: NightCreature | null = null) {
  const state = newNight(legacy, seed, creature);
  let input = NO_INPUT;
  let think = 0;
  // the human-paced bot works the controls, and the input is what live play would read from them
  const controls = newControls();
  const human = policy === "human" ? humanBot(seed) : null;
  while (!state.outcome) {
    if (human) {
      human.act(state, controls, STEP);
      input = liveInput(controls);
    } else {
      think -= STEP;
      if (think <= 0) {
        // ~150 ms reaction time
        input = policy === "bot" ? bot(state) : NO_INPUT;
        think = 0.15;
      }
    }
    step(state, STEP, input);
    if (input.melee || input.ranged) {
      consumePresses(controls);
      input = { ...input, melee: false, ranged: false };
    }
  }
  return {
    outcome: state.outcome,
    time: state.elapsed,
    lit: litCount(state),
    kills: state.stats.kills,
    oil: state.oilEarned,
    income: state.oilEarned + (state.outcome === "dawn" ? dawnBonus(state) : 0), // what the warden banks for the night
    healthLost: state.stats.hpLost,
    lampsLost: state.stats.lampsLost,
    nextTide: nextTide(legacy.tide, state),
  };
}

function play(night: number, tide: number, policy: Policy, seed: number, creature: NightCreature | null = null) {
  const legacy = newLegacy(seed);
  legacy.night = night;
  legacy.tide = tide;
  return playNight(legacy, policy, seed, creature);
}

const runs = Number(process.argv[2] || 200);
const ONLY = ["all", "idle", "bot", "human", "creatures"];
const only = process.argv[3] ?? "all";
if (!ONLY.includes(only)) throw new Error(`usage: bun scripts/balance.ts [runs] [${ONLY.join("|")}], not "${only}"`);
const POLICIES = (["idle", "bot", "human"] as const).filter((policy) => only === "all" || only === policy);
const SCENARIOS = [
  [1, 1],
  [2, 1],
  [3, 1.1],
  [5, 1.2],
  [7, 1.4],
] as const;
for (const policy of POLICIES) {
  for (const [night, tide] of SCENARIOS) {
    // the same seeds on every run, so a change to the sim shows against the same nights
    const results = Array.from({ length: runs }, (_, run) => play(night, tide, policy, night * 100_000 + run));
    const percent = (outcome: string) =>
      ((100 * results.filter((result) => result.outcome === outcome).length) / runs).toFixed(0);
    const average = (measure: (result: (typeof results)[number]) => number) =>
      (results.reduce((total, result) => total + measure(result), 0) / runs).toFixed(1);
    const sum = (measure: (result: (typeof results)[number]) => number) =>
      results.reduce((total, result) => total + measure(result), 0);
    const killsPerMinute = (60 * sum((result) => result.kills)) / sum((result) => result.time);
    console.log(
      `${policy.padEnd(5)} night ${night} tide ${tide}: dawn ${percent("dawn")}%  dark ${percent("dark")}%  fallen ${percent("fallen")}%  | ends at ${average((result) => result.time)}s, lamps ${average((result) => result.lit)}, kills ${average((result) => result.kills)}, kills/min ${killsPerMinute.toFixed(1)}, health lost ${average((result) => result.healthLost)}, lamps lost ${average((result) => result.lampsLost)}, oil ${average((result) => result.oil)}, income ${average((result) => result.income)}`,
    );
  }
}

// A campaign: a fresh line plays nights 1..CAMPAIGN_NIGHTS in a row the way a player's first line does, banking each
// night's oil and spending it in the shop (the cheapest level on offer it can afford, until nothing is affordable), the
// tide following the director's read of each night. A line stops at the first night it does not hold. Per night this
// shows how the nights that are reached end (dawn, dark or fallen: rates of the lines that reach the night), and
// whether the oil buys about one level a night and keeps the top levels out of early reach.
const CAMPAIGN_NIGHTS = 8;
const levelsOwned = (legacy: Legacy) => UPGRADE_IDS.reduce((total, id) => total + legacy.levels[id], 0);
const highestLevel = (legacy: Legacy) => Math.max(...UPGRADE_IDS.map((id) => legacy.levels[id]));
interface Row {
  outcome: Outcome;
  time: number;
  kills: number;
  healthLost: number;
  lampsLost: number;
  tide: number;
  income: number;
  bought: number; // levels bought in the shop after a night that dawned
  ownedAfter: number;
  highest: number;
}
const campaignOf = (policy: Policy) =>
  Array.from({ length: runs }, (_, run) => {
    const legacy = newLegacy(run + 1);
    const rows: Row[] = [];
    for (let night = 1; night <= CAMPAIGN_NIGHTS; night++) {
      legacy.night = night;
      const tide = legacy.tide;
      const result = playNight(legacy, policy, night * 100_000 + run);
      const row: Row = {
        outcome: result.outcome,
        time: result.time,
        kills: result.kills,
        healthLost: result.healthLost,
        lampsLost: result.lampsLost,
        tide,
        income: result.income,
        bought: 0,
        ownedAfter: levelsOwned(legacy),
        highest: highestLevel(legacy),
      };
      rows.push(row);
      if (result.outcome !== "dawn") break;
      legacy.oil += result.income;
      legacy.tide = result.nextTide;
      openShop(legacy);
      const owned = levelsOwned(legacy);
      for (;;) {
        const affordable = legacy.offers
          .map((id) => ({ id, cost: upgradeCost(legacy, id) }))
          .filter((offer) => offer.cost !== null && offer.cost <= legacy.oil)
          .sort((first, second) => (first.cost ?? 0) - (second.cost ?? 0))[0];
        if (!affordable || !buy(legacy, affordable.id)) break;
      }
      row.bought = levelsOwned(legacy) - owned;
      row.ownedAfter = levelsOwned(legacy);
      row.highest = highestLevel(legacy);
    }
    return rows;
  });
for (const policy of POLICIES) {
  if (policy === "idle") continue;
  const campaigns = campaignOf(policy);
  console.log(
    `\ncampaign (${policy} warden holds nights in a row, buys the cheapest affordable level; ${runs} lines; outcome rates are of the lines that reach the night):`,
  );
  for (let night = 1; night <= CAMPAIGN_NIGHTS; night++) {
    const rows = campaigns.flatMap((line) => line[night - 1] ?? []);
    if (rows.length === 0) break;
    const total = (measure: (row: Row) => number) => rows.reduce((sum, row) => sum + measure(row), 0);
    const average = (measure: (row: Row) => number) => (total(measure) / rows.length).toFixed(1);
    const percent = (outcome: Outcome) =>
      ((100 * rows.filter((row) => row.outcome === outcome).length) / rows.length).toFixed(0).padStart(3);
    const killsPerMinute = (60 * total((row) => row.kills)) / total((row) => row.time);
    const held = rows.filter((row) => row.outcome === "dawn");
    const mean = (measure: (row: Row) => number) =>
      held.length ? (held.reduce((sum, row) => sum + measure(row), 0) / held.length).toFixed(1) : "-";
    const atTop = held.length
      ? ((100 * held.filter((row) => row.highest >= MAX_LEVEL).length) / held.length).toFixed(0)
      : "-";
    console.log(
      `  night ${night}: reached by ${((100 * rows.length) / runs).toFixed(0).padStart(3)}% (${String(rows.length).padStart(3)}), tide ${average((row) => row.tide)} | dawn ${percent("dawn")}%  dark ${percent("dark")}%  fallen ${percent("fallen")}% | kills/min ${killsPerMinute.toFixed(1)}, health lost ${average((row) => row.healthLost)}, lamps lost ${average((row) => row.lampsLost)} | income ${average((row) => row.income)}, levels bought ${mean((row) => row.bought)}, levels owned ${mean((row) => row.ownedAfter)}, an upgrade at top level in ${atTop}%`,
    );
  }
}

// Creatures from the sea: the same seeded nights with one creature of each archetype, neutral and with every modifier at
// its extreme either way. The first row is the same nights with no creature, to read the others against; the creature
// joins about one spawn in four from 8 s in, at most two alive.
const NEUTRAL: Modifiers = { speed: 0, toughness: 0, bite: 0, snuffing: 0 };
const STRONGEST: Modifiers = { speed: 1, toughness: 1, bite: 1, snuffing: 1 };
const WEAKEST: Modifiers = { speed: -1, toughness: -1, bite: -1, snuffing: -1 };
const CREATURE_SCENARIOS = [
  [3, 1.1],
  [5, 1.2],
] as const;
const MODIFIER_SETS = [
  ["neutral", NEUTRAL],
  ["strongest", STRONGEST],
  ["weakest", WEAKEST],
] as const;
const withCreatures = only === "all" || only === "creatures";
if (withCreatures)
  console.log(`\nwith a creature from the sea (bot warden, ${runs} nights each, the same seeds as above):`);
for (const [night, tide] of withCreatures ? CREATURE_SCENARIOS : []) {
  const variants: [string, NightCreature | null][] = [["no creature", null]];
  for (const archetype of ARCHETYPES)
    for (const [label, modifiers] of MODIFIER_SETS)
      variants.push([
        `${archetype} ${label}`,
        nightCreature({ id: `balance-${archetype}-${label}`, archetype, modifiers, anchorY: 0.8 }),
      ]);
  for (const [label, creature] of variants) {
    const results = Array.from({ length: runs }, (_, run) => play(night, tide, "bot", night * 100_000 + run, creature));
    const percent = (outcome: string) =>
      ((100 * results.filter((result) => result.outcome === outcome).length) / runs).toFixed(0);
    const average = (measure: (result: (typeof results)[number]) => number) =>
      (results.reduce((total, result) => total + measure(result), 0) / runs).toFixed(1);
    console.log(
      `  night ${night} tide ${tide} ${label.padEnd(17)}: dawn ${percent("dawn").padStart(3)}%  dark ${percent("dark").padStart(3)}%  fallen ${percent("fallen").padStart(3)}%  | lamps ${average((result) => result.lit)}, kills ${average((result) => result.kills)}, health lost ${average((result) => result.healthLost)}, oil ${average((result) => result.oil)}, income ${average((result) => result.income)}`,
    );
  }
}
