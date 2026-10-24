// What the model is told about a night: numbers worked out from the recorded play the server itself holds (never from a
// client's claim), in a compact JSON object. The play has no positions, so "where the warden was when a lamp went dark"
// is not here; what the timeline does give is when each lamp went dark, how the crowd grew and how health fell.
import { z } from "zod";
import { recordedCreatureSchema } from "@/game/creature";
import { directorFrom, tideRange } from "@/game/director";
import { levelsOf, UPGRADE_IDS } from "@/game/legacy";
import { PLAY_ID } from "@/game/plays";
import { LAMP_SPOTS, nightLength, rulesTide } from "@/game/sim";

const finite = z.number().finite();
const TIMELINE_SAMPLE_SECONDS = 5;

/** The parts of a stored recording the director reads. Everything else in it is ignored. */
export const storedPlaySchema = z.looseObject({
  id: z.string().regex(PLAY_ID),
  session: z.string().max(80),
  legacy: z.looseObject({
    night: z.number().int().min(1),
    generation: z.number().int().min(1),
    tide: finite,
    heir: z.looseObject({ trait: z.string().regex(/^[a-z]{1,20}$/) }),
    levels: z.unknown().optional(),
    director: z.unknown().optional(),
  }),
  creature: recordedCreatureSchema.optional(),
  // [second, kills, lampsLit, health, monsters, lampsLost]
  timeline: z.array(z.tuple([finite, finite, finite, finite, finite, finite])).max(1000),
  outcome: z.enum(["dawn", "dark", "fallen"]).nullable(),
  stats: z.looseObject({
    kills: finite,
    lampsLost: finite,
    hpLost: finite,
    time: finite,
    hp: finite,
    maxHp: finite,
    lit: finite,
  }),
});
export type StoredPlay = z.infer<typeof storedPlaySchema>;

/** What the model said last time, from the log of the play that decision answered. */
export interface PreviousReasoning {
  reasoning: string;
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/** The tide the rules would pick after this night, and the range the model may move it within. */
export function rulesTideAfter(play: StoredPlay): number {
  return rulesTide(play.legacy.tide, {
    outcome: play.outcome,
    kills: play.stats.kills,
    seconds: play.stats.time,
    lampsLost: play.stats.lampsLost,
    health: play.stats.hp,
    maxHealth: play.stats.maxHp,
  });
}

export function summarise(play: StoredPlay, previous: PreviousReasoning | null) {
  const { legacy, stats, timeline } = play;
  const lampCount = LAMP_SPOTS.length;
  const minutes = Math.max(1 / 60, stats.time / 60);

  // lamps going dark: each second whose lit count is lower than the one before it
  const wentDark: { atSecond: number; lampsLitAfter: number }[] = [];
  let relit = 0;
  let lampSecondsDark = 0;
  let before = lampCount;
  for (const [second, , lit] of timeline) {
    if (lit < before) wentDark.push({ atSecond: second, lampsLitAfter: lit });
    else if (lit > before) relit += lit - before;
    lampSecondsDark += lampCount - lit;
    before = lit;
  }

  let peakMonsters = 0;
  let lowestHealth = { atSecond: 0, health: stats.maxHp };
  for (const [second, , , health, monsters] of timeline) {
    peakMonsters = Math.max(peakMonsters, monsters);
    if (health < lowestHealth.health) lowestHealth = { atSecond: second, health };
  }
  const monstersAtFifteen = timeline.find(([second]) => second === 15)?.[4] ?? null;

  const upgrades = levelsOf(legacy.levels);
  const upgradeLevels = Object.fromEntries(
    UPGRADE_IDS.filter((id) => upgrades[id] > 0).map((id) => [id, upgrades[id]]),
  );

  // what governed this night: the director's decision it was played under, validated again here (it travelled through
  // the client), and, if it was the model's, what the model wrote about it
  const governing = directorFrom(legacy.director, legacy.tide, legacy.night);
  const previousDecision =
    governing.source === "mubit"
      ? {
          source: "mubit",
          decidedAfterNight: governing.decidedAfterNight,
          tide: governing.tide,
          rulesTideThen: governing.rulesTide,
          mix: governing.mix,
          creatureShare: governing.creatureShare,
          line: governing.line,
          ...(previous ? { yourReasoning: previous.reasoning } : {}),
        }
      : {
          source: "rules",
          note: "no model decision applied to this night (the rules set the tide, an even mix, creature share 0.25)",
        };

  const rules = rulesTideAfter(play);
  return {
    night: legacy.night,
    plannedSeconds: nightLength(legacy.night),
    playedSeconds: oneDecimal(stats.time),
    tidePlayed: legacy.tide,
    warden: { trait: legacy.heir.trait, generation: legacy.generation, maxHealth: stats.maxHp },
    upgradeLevels,
    creatureFromTheSea: play.creature
      ? { archetype: play.creature.archetype, modifiers: play.creature.modifiers }
      : null,
    outcome: play.outcome ?? "abandoned",
    kills: stats.kills,
    killsPerMinute: oneDecimal(stats.kills / minutes),
    lamps: {
      total: lampCount,
      litAtEnd: stats.lit,
      lostCount: stats.lampsLost,
      relightedCount: relit,
      wentDark: wentDark.slice(0, 12),
      lampSecondsDark,
    },
    health: {
      lost: stats.hpLost,
      atEnd: stats.hp,
      max: stats.maxHp,
      lowest: lowestHealth,
    },
    crowd: { peakMonstersAlive: peakMonsters, monstersAliveAt15s: monstersAtFifteen },
    // [second, kills, lampsLit, health, monstersAlive] every five seconds
    timelineEvery5s: timeline
      .filter(([second]) => second % TIMELINE_SAMPLE_SECONDS === 0)
      .map(([second, kills, lit, health, monsters]) => [second, kills, lit, health, monsters]),
    previousDecision,
    ifTheRulesDecided: {
      tideForNextNight: rules,
      allowedTideRange: tideRange(rules),
    },
  };
}
