// A human-paced warden for scripts/balance.ts: the same game as the perfect bot plays, with the limits a person has.
// It reads the night the way a player's eyes do (monsters as they were a reaction time ago), and acts the way hands do
// (held keys, a mouse click, a press that reaches one sim step), by writing to a Controls object that the driver turns
// into the sim's input with liveInput(): the path live play takes. It never touches the state.
//
// Every draw comes from the bot's own seeded generator, apart from the sim's rand(state), so a run reproduces and the
// sim's randomness is untouched.
import { type Controls, shootAt } from "../src/game/controls";
import { nextRandom } from "../src/game/random";
import { bodyHeight, ground, type Lamp, type MonsterKind, type State } from "../src/game/sim";
import { octantOf, octantVector, offsetFromOctant } from "../src/scene/assets";

// What makes this warden human. Times are seconds, distances ground px, angles degrees.
export interface HumanTraits {
  reactionMin: number; // how long ago the warden sees the night: a new threat is acted on this late
  reactionMax: number;
  clumsinessSpread: number; // how much players differ night to night (the spread of the log of clumsiness)
  trackingLag: number; // a monster already noticed is followed with this lag
  thinkInterval: number; // how often the keys and buttons are reconsidered
  turnDelayMin: number; // a direction is held this long before the strike, so the warden has turned to it
  turnDelayMax: number;
  headingError: number; // each target is approached a little off line (spread of an angle)
  aimError: number; // a shot is aimed a little off the target (spread of an angle)
  sloppiness: number; // the chance a target is whichever monster catches the eye
  lampFocus: number; // the chance it is the monster nearest a lit lamp; otherwise the one nearest the warden
  lockMin: number; // a target is kept for this long once chosen, even when another becomes the better one
  lockMax: number;
  hesitationPerSecond: number; // the chance per second of stopping, unsure, for a moment
  hesitationMin: number;
  hesitationMax: number;
  lapsePerSecond: number; // the chance per second of looking away altogether (the HUD, a distraction) for a while
  lapseMin: number;
  lapseMax: number;
  reachMarginMin: number; // a swing is started this far inside the reach, or just short of it
  reachMarginMax: number;
  shotChance: number; // the chance a shot is taken when one is possible
  shotRange: number; // a monster this far off is shot at, nearer it is fought
  engageRange: number; // a monster this near the warden is fought before any lamp is tended
  relightIgnore: number; // the chance a dark lamp is never gone back to
  relightLateMin: number; // how long after a lamp is seen dark that the warden turns to it
  relightLateMax: number;
}

export const HUMAN: HumanTraits = {
  reactionMin: 0.25,
  reactionMax: 0.4,
  clumsinessSpread: 0.7,
  trackingLag: 0.15,
  thinkInterval: 0.1,
  turnDelayMin: 0.05,
  turnDelayMax: 0.15,
  headingError: 12,
  aimError: 12,
  sloppiness: 0.3,
  lampFocus: 0.25,
  lockMin: 0.8,
  lockMax: 2,
  hesitationPerSecond: 0.25,
  hesitationMin: 0.2,
  hesitationMax: 0.6,
  lapsePerSecond: 0.06,
  lapseMin: 2,
  lapseMax: 5,
  reachMarginMin: 0,
  reachMarginMax: 12,
  shotChance: 0.3,
  shotRange: 150,
  engageRange: 170,
  relightIgnore: 0.2,
  relightLateMin: 0.5,
  relightLateMax: 3.5,
};

interface Seen {
  id: number;
  kind: MonsterKind;
  x: number;
  y: number;
}
interface Glimpse {
  time: number;
  monsters: Seen[];
  dark: boolean[]; // per lamp
}
interface RelightPlan {
  startAt: number;
  ignore: boolean;
}
const CLUMSINESS_LIMIT = 4; // the clumsiest night is four times the typical one: a reaction of about 1.6 s
const HISTORY_SECONDS = 2; // what the eye can look back on: longer than the slowest reaction
const RELIGHT_STANDING = 30; // the warden stands this close to a lamp to relight it (the sim asks for 40)
const HOME = { x: 480, y: 350 }; // where an idle warden drifts back to: the middle of the plaza
const HALF_TURN_DEGREES = 180;
const DEGREES = Math.PI / HALF_TURN_DEGREES;
const OCTANTS = 8;
const HEADING_SLACK = 0.2;
// radians off the held direction before the hands change it: past the edge of its octant, and some
const KEEP_HEADING = Math.PI / OCTANTS + HEADING_SLACK;
const SHOT_HEIGHT = 40; // where a shot leaves the warden, above his feet

export interface HumanBot {
  // Reconsiders the night for one sim step and writes the keys, mouse and buttons a person would, to `controls`.
  act: (state: State, controls: Controls, deltaTime: number) => void;
}

// the movement keys that walk the warden along an octant
function keysForOctant(octant: number): string[] {
  const [x, y] = octantVector(octant);
  const horizontal = Math.round(x);
  const vertical = Math.round(y);
  const keys: string[] = [];
  if (horizontal > 0) {
    keys.push("d");
  }
  if (horizontal < 0) {
    keys.push("a");
  }
  if (vertical > 0) {
    keys.push("s");
  }
  if (vertical < 0) {
    keys.push("w");
  }
  return keys;
}

export function humanBot(seed: number, traits: HumanTraits = HUMAN): HumanBot {
  // its own stream: a different constant from the sim's seed, so the two never run in step
  let randomState = (seed ^ 0x5bd1e995) | 0;
  const random = () => {
    const draw = nextRandom(randomState);
    randomState = draw.seed;
    return draw.value;
  };
  const between = (low: number, high: number) => low + (high - low) * random();
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  let clock = 0;
  let nextThink = 0;
  // how clumsy this player is tonight: one number, centred on 1, that scales how late they react, how far off they aim
  // and steer, and how often they look away. A night's player is sometimes much better or worse than the next.
  const clumsiness = Math.min(CLUMSINESS_LIMIT, Math.exp(traits.clumsinessSpread * gaussian()));
  const newReaction = () => between(traits.reactionMin, traits.reactionMax) * clumsiness;
  let reaction = newReaction();
  let nextReaction = 1;
  const history: Glimpse[] = [];
  const plans = new Map<number, RelightPlan>();
  const noticed = new Set<number>();
  let pausedUntil = 0;
  let targetId: number | null = null;
  let targetUntil = 0;
  let targetBias = 0; // radians off the line to the target, kept for as long as the target is
  let heading: number | null = null; // the octant the keys are held to, null for none
  let headingSince = 0; // since when the keys have been held to this heading, or since the last strike
  const newTurnDelay = () => between(traits.turnDelayMin, traits.turnDelayMax) * clumsiness;
  let turnDelay = newTurnDelay();
  let reachMargin = between(traits.reachMarginMin, traits.reachMarginMax);

  const glimpse = (state: State) => {
    history.push({
      time: clock,
      monsters: state.monsters.map((monster) => ({ id: monster.id, kind: monster.kind, x: monster.x, y: monster.y })),
      dark: state.lamps.map((lamp) => !lamp.lit),
    });
    while (history.length > 1 && (history[0]?.time ?? clock) < clock - HISTORY_SECONDS) {
      history.shift();
    }
  };
  const glimpseAt = (time: number) => {
    let found = history[0];
    for (const candidate of history) {
      if (candidate.time <= time) {
        found = candidate;
      }
    }
    return found;
  };
  // What the eye has of the night: a monster is noticed when it shows in the night as it was a reaction time ago (its
  // lamps are read the same way); once noticed it is followed with a shorter lag; one that has died is already gone.
  const seenNow = (state: State): Glimpse => {
    const noticing = glimpseAt(clock - reaction);
    for (const monster of noticing?.monsters ?? []) {
      noticed.add(monster.id);
    }
    const following = glimpseAt(clock - traits.trackingLag);
    const alive = new Set(state.monsters.map((monster) => monster.id));
    return {
      time: noticing?.time ?? clock,
      monsters: (following?.monsters ?? []).filter((monster) => alive.has(monster.id) && noticed.has(monster.id)),
      dark: noticing?.dark ?? [],
    };
  };

  const hold = (controls: Controls, octant: number | null) => {
    for (const key of ["a", "d", "w", "s"]) {
      controls.keys.delete(key);
    }
    for (const key of octant === null ? [] : keysForOctant(octant)) {
      controls.keys.add(key);
    }
    if (octant !== heading) {
      heading = octant;
      headingSince = clock;
    }
  };
  // the octant to hold to walk towards a point, off line by the bias; the keys already held stay while they are near
  // enough, so a monster crowding the warden does not make his hands twitch
  const octantTowards = (state: State, x: number, y: number, bias: number) => {
    const angle = Math.atan2((y - state.hero.y) * 2, x - state.hero.x) + bias;
    if (heading !== null && offsetFromOctant(Math.cos(angle), Math.sin(angle), heading) < KEEP_HEADING) {
      return heading;
    }
    return octantOf(Math.cos(angle), Math.sin(angle));
  };

  const chooseTarget = (state: State, monsters: Seen[]): Seen | null => {
    const kept = monsters.find((monster) => monster.id === targetId);
    if (kept && clock < targetUntil) {
      return kept;
    }
    if (monsters.length === 0) {
      targetId = null;
      return null;
    }
    // which monster the eye settles on: any at all, or the one nearest a lit lamp (the one that matters), or, mostly,
    // the one nearest the warden
    const roll = random();
    const nearestTo = (score: (monster: Seen) => number) =>
      monsters.reduce((best, monster) => (score(monster) < score(best) ? monster : best));
    let chosen: Seen | undefined;
    if (roll < traits.sloppiness) {
      chosen = monsters[Math.floor(random() * monsters.length)];
    } else if (roll < traits.sloppiness + traits.lampFocus) {
      chosen = nearestTo((monster) =>
        Math.min(...state.lamps.filter((lamp) => lamp.lit).map((lamp) => ground(monster.x, monster.y, lamp.x, lamp.y))),
      );
    } else {
      chosen = nearestTo((monster) => ground(monster.x, monster.y, state.hero.x, state.hero.y));
    }
    targetId = chosen?.id ?? null;
    targetUntil = clock + between(traits.lockMin, traits.lockMax);
    targetBias = gaussian() * traits.headingError * clumsiness * DEGREES;
    reachMargin = between(traits.reachMarginMin, traits.reachMarginMax);
    return chosen ?? null;
  };

  // lamps: a dark one gets a plan when the warden first sees it dark, and loses it when it is lit again
  const planLamps = (state: State, seenDark: readonly boolean[]) => {
    state.lamps.forEach((lamp, index) => {
      if (lamp.lit) {
        plans.delete(index);
      } else if (seenDark[index] && !plans.has(index)) {
        plans.set(index, {
          startAt: clock + between(traits.relightLateMin, traits.relightLateMax),
          ignore: random() < traits.relightIgnore,
        });
      }
    });
  };

  // whether the warden's hands are idle this thought: still in a lapse or a hesitation, or just falling into one
  const paused = () => {
    if (clock < pausedUntil) {
      return true;
    }
    if (random() < traits.lapsePerSecond * clumsiness * traits.thinkInterval) {
      pausedUntil = clock + between(traits.lapseMin, traits.lapseMax);
      return true;
    }
    if (random() < traits.hesitationPerSecond * clumsiness * traits.thinkInterval) {
      pausedUntil = clock + between(traits.hesitationMin, traits.hesitationMax);
      return true;
    }
    return false;
  };

  // the nearest dark lamp whose plan has come due (and is not to be ignored), and how far it is
  const dueLamp = (state: State): { lamp: Lamp; distance: number } | null => {
    let due: { lamp: Lamp; distance: number } | null = null;
    state.lamps.forEach((lamp, index) => {
      const plan = plans.get(index);
      if (!plan || plan.ignore || plan.startAt > clock || lamp.lit) {
        return;
      }
      const distance = ground(lamp.x, lamp.y, state.hero.x, state.hero.y);
      if (distance < (due?.distance ?? Number.POSITIVE_INFINITY)) {
        due = { lamp, distance };
      }
    });
    return due;
  };

  const think = (state: State, controls: Controls) => {
    const hero = state.hero;
    const seen = seenNow(state);

    planLamps(state, seen.dark);
    if (paused()) {
      hold(controls, null);
      return;
    }

    const target = chooseTarget(state, seen.monsters);
    const targetDistance = target ? ground(target.x, target.y, hero.x, hero.y) : Number.POSITIVE_INFINITY;
    const due = dueLamp(state);

    const fighting = target !== null && targetDistance < traits.engageRange;
    if (!fighting && due) {
      hold(controls, due.distance < RELIGHT_STANDING ? null : octantTowards(state, due.lamp.x, due.lamp.y, 0));
      return;
    }
    if (target) {
      engage(state, controls, target, targetDistance);
      return;
    }
    // nothing to do: drift back to the middle
    const home = ground(HOME.x, HOME.y, hero.x, hero.y) > 60 ? octantTowards(state, HOME.x, HOME.y, 0) : null;
    hold(controls, home);
  };

  // at a target: a shot when it is far off, if the hands are free and the mind is made up; else walk at it and strike
  const engage = (state: State, controls: Controls, target: Seen, targetDistance: number) => {
    const hero = state.hero;
    const busy = hero.animation === "melee" || hero.animation === "ranged" || hero.stun > 0;
    if (!busy && targetDistance > traits.shotRange && hero.shotCooldown <= 0 && random() < traits.shotChance) {
      const originY = hero.y - SHOT_HEIGHT;
      const bodyY = target.y - bodyHeight(state, target.kind);
      const angle =
        Math.atan2(bodyY - originY, target.x - hero.x) + gaussian() * traits.aimError * clumsiness * DEGREES;
      const length = Math.hypot(target.x - hero.x, bodyY - originY);
      shootAt(controls, hero.x + Math.cos(angle) * length, originY + Math.sin(angle) * length);
      return;
    }
    hold(controls, octantTowards(state, target.x, target.y, targetBias));
    // near enough, and the direction held long enough to have turned him to it: strike, holding it
    if (!busy && targetDistance < state.rules.meleeReach - reachMargin && clock - headingSince >= turnDelay) {
      controls.melee = true;
      headingSince = clock;
      turnDelay = newTurnDelay();
    }
  };

  return {
    act(state, controls, deltaTime) {
      clock += deltaTime;
      if (clock >= nextReaction) {
        reaction = newReaction();
        nextReaction = clock + 1;
      }
      glimpse(state);
      if (clock < nextThink) {
        return;
      }
      nextThink = clock + traits.thinkInterval;
      think(state, controls);
    },
  };
}
