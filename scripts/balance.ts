// Headless balance check: plays nights with an idle warden and a simple bot, prints outcome rates.
// usage: bun scripts/balance.ts [runs=200] [--director]; seeded, so two builds are compared on the same nights.
// --director: only the live director's section, with stub decisions in place of the model (see directorReport).
import { ARCHETYPES, type Modifiers } from "../src/game/creature";
import { clampProposal, type Director, EVEN_MIX, type Mix } from "../src/game/director";
import {
  applyDirector,
  buy,
  type Legacy,
  MAX_LEVEL,
  newLegacy,
  openShop,
  setRulesDirector,
  UPGRADE_IDS,
  upgradeCost,
} from "../src/game/legacy";
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
  type State,
  step,
} from "../src/game/sim";

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

// "novice": the bot with a slow reaction and no bow, standing in for a first-time player (see directorReport)
type Policy = "idle" | "bot" | "novice";
const REACTION: Record<Policy, number> = { idle: 0.15, bot: 0.15, novice: 0.45 };

function playNight(legacy: Legacy, policy: Policy, seed: number, creature: NightCreature | null = null) {
  const state = newNight(legacy, seed, creature);
  let input = NO_INPUT;
  let think = 0;
  const stepSeconds = 1 / 60;
  while (!state.outcome) {
    think -= stepSeconds;
    if (think <= 0) {
      // ~150 ms reaction time (the novice's is 450 ms, and he never shoots)
      input = policy === "idle" ? NO_INPUT : bot(state);
      if (policy === "novice") input = { ...input, ranged: false, aim: null };
      think = REACTION[policy];
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
    income: state.oilEarned + (state.outcome === "dawn" ? dawnBonus(state) : 0), // what the warden banks for the night
    healthLost: state.stats.hpLost,
    nextTide: nextTide(legacy.tide, state),
  };
}

function play(night: number, tide: number, policy: Policy, seed: number, creature: NightCreature | null = null) {
  const legacy = newLegacy(seed);
  legacy.night = night;
  legacy.tide = tide;
  return playNight(legacy, policy, seed, creature);
}

// The live director, with fixed stub decisions in place of the model: what each does to the same seeded nights, so the
// effect of the bounds can be read. The tide moves 0.15 either way from the rules' tide, the mix weights go to their ends
// (0.5 and 2), and the creature's share to 0.1 or 0.4: the most the director may do, and the most it may do in one night.
interface Stub {
  label: string;
  tideShift: number;
  mix: Mix;
  creatureShare: number;
}
const STUBS: Stub[] = [
  { label: "eased", tideShift: -0.15, mix: { satyr: 1, cyclops: 0.5, harpy: 0.5 }, creatureShare: 0.1 },
  { label: "pushed", tideShift: 0.15, mix: { satyr: 1, cyclops: 2, harpy: 2 }, creatureShare: 0.4 },
  { label: "eased, tide only", tideShift: -0.15, mix: EVEN_MIX, creatureShare: 0.25 },
  { label: "pushed, tide only", tideShift: 0.15, mix: EVEN_MIX, creatureShare: 0.25 },
  { label: "eased, mix only", tideShift: 0, mix: { satyr: 1, cyclops: 0.5, harpy: 0.5 }, creatureShare: 0.1 },
  { label: "pushed, mix only", tideShift: 0, mix: { satyr: 1, cyclops: 2, harpy: 2 }, creatureShare: 0.4 },
];

function stubDecision(stub: Stub, rulesTide: number, endedNight: number): Director {
  const decision = clampProposal(
    {
      reasoning: "",
      expectedEffect: "",
      tide: rulesTide + stub.tideShift,
      mix: stub.mix,
      creatureShare: stub.creatureShare,
      line: `The sea is ${stub.label}.`,
    },
    rulesTide,
    endedNight,
    "2026-10-24-00-00-00-balance",
  );
  if (!decision) throw new Error("stub decision rejected");
  return decision;
}

function directorReport(runs: number) {
  console.log(
    `the live director with stub decisions (${runs} seeded nights each; the same seeds under every decision)`,
  );
  console.log("novice = 450 ms reaction, melee only; bot = 150 ms reaction, bow and sword\n");
  for (const policy of ["novice", "bot"] as const) {
    for (const [night, tide] of [
      [1, 1],
      [2, 1],
      [3, 1.1],
      [5, 1.2],
    ] as const) {
      const variants: [string, Stub | null][] = [
        ["rules", null],
        ...STUBS.map((stub): [string, Stub] => [stub.label, stub]),
      ];
      for (const [label, stub] of variants) {
        const results = Array.from({ length: runs }, (_, run) => {
          const legacy = newLegacy(run + 1);
          legacy.night = night;
          setRulesDirector(legacy, tide, night - 1, "2026-10-24-00-00-00-balance");
          if (stub && !applyDirector(legacy, stubDecision(stub, tide, night - 1))) throw new Error("stub not applied");
          return playNight(legacy, policy, night * 100_000 + run);
        });
        const percent = (outcome: string) =>
          ((100 * results.filter((result) => result.outcome === outcome).length) / runs).toFixed(0).padStart(3);
        const average = (measure: (result: (typeof results)[number]) => number) =>
          (results.reduce((total, result) => total + measure(result), 0) / runs).toFixed(1);
        const killsPerMinute =
          (60 * results.reduce((total, result) => total + result.kills, 0)) /
          results.reduce((total, result) => total + result.time, 0);
        console.log(
          `${policy.padEnd(6)} night ${night} (rules' tide ${tide}) ${label.padEnd(18)}: dawn ${percent("dawn")}%  dark ${percent("dark")}%  fallen ${percent("fallen")}%  | lamps lit ${average((result) => result.lit)}, kills/min ${killsPerMinute.toFixed(1)}, health lost ${average((result) => result.healthLost)}`,
        );
      }
      console.log("");
    }
  }
}

const runs = Number(process.argv.slice(2).find((argument) => /^[0-9]+$/.test(argument)) || 200);
if (process.argv.includes("--director")) {
  directorReport(runs);
  process.exit(0);
}
const SCENARIOS = [
  [1, 1],
  [2, 1],
  [3, 1.1],
  [5, 1.2],
  [7, 1.4],
] as const;
for (const policy of ["idle", "bot"] as const) {
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
      `${policy.padEnd(4)} night ${night} tide ${tide}: dawn ${percent("dawn")}%  dark ${percent("dark")}%  fallen ${percent("fallen")}%  | ends at ${average((result) => result.time)}s, lamps ${average((result) => result.lit)}, kills ${average((result) => result.kills)}, kills/min ${killsPerMinute.toFixed(1)}, health lost ${average((result) => result.healthLost)}, oil ${average((result) => result.oil)}, income ${average((result) => result.income)}`,
    );
  }
}

// A campaign: the bot holds nights 1..CAMPAIGN_NIGHTS in a row, banking each night's oil and spending it in the shop
// (the cheapest level on offer it can afford, until nothing is affordable), the way a player who buys whatever is cheap
// would. It stops at the first night it does not hold. Shows whether the oil buys about one level a night and keeps
// the top levels out of early reach.
const CAMPAIGN_NIGHTS = 8;
const levelsOwned = (legacy: Legacy) => UPGRADE_IDS.reduce((total, id) => total + legacy.levels[id], 0);
interface Row {
  income: number;
  bought: number;
  ownedAfter: number;
  highest: number;
}
const campaigns = Array.from({ length: runs }, (_, run) => {
  const legacy = newLegacy(run + 1);
  const rows: Row[] = [];
  for (let night = 1; night <= CAMPAIGN_NIGHTS; night++) {
    legacy.night = night;
    const result = playNight(legacy, "bot", night * 100_000 + run);
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
    rows.push({
      income: result.income,
      bought: levelsOwned(legacy) - owned,
      ownedAfter: levelsOwned(legacy),
      highest: Math.max(...UPGRADE_IDS.map((id) => legacy.levels[id])),
    });
  }
  return rows;
});
console.log(`\ncampaign (the bot holds nights in a row, buys the cheapest affordable level; ${runs} lines):`);
for (let night = 1; night <= CAMPAIGN_NIGHTS; night++) {
  const rows = campaigns.flatMap((line) => line[night - 1] ?? []);
  if (rows.length === 0) break;
  const average = (measure: (row: Row) => number) =>
    (rows.reduce((total, row) => total + measure(row), 0) / rows.length).toFixed(1);
  const atTop = rows.filter((row) => row.highest >= MAX_LEVEL).length;
  console.log(
    `  night ${night}: held by ${((100 * rows.length) / runs).toFixed(0)}% | income ${average((row) => row.income)}, levels bought ${average((row) => row.bought)}, levels owned ${average((row) => row.ownedAfter)}, an upgrade at top level in ${((100 * atTop) / rows.length).toFixed(0)}%`,
  );
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
console.log(`\nwith a creature from the sea (bot warden, ${runs} nights each, the same seeds as above):`);
for (const [night, tide] of CREATURE_SCENARIOS) {
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
