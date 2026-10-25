// One night in Lychnos: monsters come out of the sea to snuff the town's lamps; the warden fights and relights them until dawn.
// Pure game state and step(); no Pixi, so scripts/balance.ts can run it headless.
import {
  FRAMES,
  FRAMES_PER_SECOND,
  type HeroAnimation,
  octantOf,
  octantVector,
  offsetFromOctant,
} from "../scene/assets";
import { type Creature, type CreatureStats, statsOf } from "./creature";
import type { Mix } from "./director-decision";
import type { Legacy, TraitId } from "./legacy";
import { nextRandom, UINT32_RANGE } from "./random";

export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 600;
export const CENTRE_X = 480;
export const CENTRE_Y = 320;
export const PLAZA_HALF_WIDTH = 384; // plaza diamond half width (12 tiles of 64x32)
export const PLAZA_HALF_HEIGHT = 192;

// "creature" is the night's creature from the sea (see NightCreature), when one joined this night.
export type HandMadeKind = "satyr" | "cyclops" | "harpy";
export type MonsterKind = HandMadeKind | "creature";
// snuff: seconds of clawing to put a lamp out. oil: what a kill leaves when it drops oil at all (see OIL_CHANCE).
// recoil: how far a blow throws it (the cyclops is heavy, the harpy light).
export const MONSTER: Record<HandMadeKind, CreatureStats> = {
  satyr: { speed: 50, health: 1, damage: 8, snuff: 2.6, oil: 1, fly: false, recoil: 1 },
  cyclops: { speed: 30, health: 3, damage: 16, snuff: 1.5, oil: 2, fly: false, recoil: 0.6 },
  harpy: { speed: 76, health: 1, damage: 6, snuff: 3.2, oil: 1, fly: true, recoil: 1.3 },
};

// The oil economy: a kill leaves its oil only OIL_CHANCE of the time (the seeded rand, so a night still replays), and
// the dawn bonus is small, so a night earns about one level-1 upgrade. The Oil seeker upgrade raises the chance. It was
// 0.3 when a night lasted 40 s and held 13 to 16 kills; a 16 s night holds about 5, so the chance is higher to keep a
// night's oil, and the upgrades a run buys, where they were.
const OIL_CHANCE = 0.5;
const OIL_CHANCE_PER_LEVEL = 0.1;

// A swing reaches only the 120 degrees in front of the warden (measured on the ground, where the plaza is foreshortened
// 2:1), so it has to be aimed: hold a direction while striking to turn that way. The warden faces one of eight
// directions (his octant, which is also the sprite he is drawn with) and the arc is centred on it.
const HALF_TURN_DEGREES = 180;
const DEGREE = Math.PI / HALF_TURN_DEGREES;
const SWING_HALF_ARC_DEGREES = 60;
export const SWING_HALF_ARC = SWING_HALF_ARC_DEGREES * DEGREE;
// a stick held a little past the middle of an octant's edge keeps the warden facing the way he was, so a thumb resting
// near the edge does not flicker him between two frames
const FACING_HYSTERESIS = 0.12;
const OCTANTS = 8;
const HALF_OCTANT = Math.PI / OCTANTS; // half of an eighth of a turn
// How a blow lands. A hit freezes the monster for `stun` seconds, then throws it `push` ground px/s away from the
// blow; a swing also holds the warden's own animation for a beat, which is what makes it feel solid.
const MELEE_BLOW = { push: 380, stun: 0.08 };
const SHOT_BLOW = { push: 160, stun: 0.04 };
const SWING_HOLD = 0.06;
const KNOCK_DRAG = 9; // per second: a push of 380 carries about 42 px
const KNOCK_LIMIT = 0.95; // how near the plaza's rim a push may leave a monster, in plaza units
// The monster flashes white for the first FLASH_TIME of HURT_TIME after a hit, then red until it has shaken it off.
export const HURT_TIME = 0.25;
export const FLASH_TIME = 0.06;
export const GHOST_TIME = 0.16; // a killed monster's white silhouette is flung back for this long

// How a monster's blow lands on the warden, with the same weight as the warden's on a monster: a hit-stop of `stun`
// seconds, then a push of `push` ground px/s away from the attacker (about 33 px). The mercy frames after a blow keep a
// crowd from chain-hitting: nothing wounds the warden again until they are over.
const HERO_BLOW = { push: 300, stun: 0.07 };
export const MERCY_TIME = 0.5;
// The warden flashes white for the first HERO_FLASH_TIME of HERO_HURT_TIME after a blow, then red until it fades.
export const HERO_HURT_TIME = 0.4;
export const HERO_FLASH_TIME = 0.08;
const HERO_KNOCK_LIMIT = 0.92; // the plaza's walking margin (inPlaza)

// The creature the sea sends this night, when there is one (src/game/creature.ts). It is part of the night's setup, so a
// recording carries it and a replay builds the same night. Its stats follow from its archetype and modifiers, never
// from the model; anchorY is for the scene.
export interface NightCreature {
  id: string;
  anchorY: number;
  stats: CreatureStats;
}
export const nightCreature = (
  creature: Pick<Creature, "id" | "archetype" | "modifiers" | "anchorY">,
): NightCreature => ({ id: creature.id, anchorY: creature.anchorY, stats: statsOf(creature) });
// From CREATURE_FROM_SHARE of the night in, about State.creatureShare of the spawns (the director's;
// DEFAULT_CREATURE_SHARE, a quarter, without one) are the creature, with at most CREATURE_CAP alive. The draw for it is
// made only when it can come, so a night without a creature draws exactly what it always did. It is a share of the
// night, not a count of seconds, so the creature still meets the warden early enough to matter on a short night.
const CREATURE_FROM_SHARE = 0.2;
const CREATURE_CAP = 2;
// The first monster rises this many seconds in, on every night (it was tuned on 40 s nights and kept on the shorter ones).
const FIRST_SPAWN = 2.5;
export const creatureFrom = (length: number) => length * CREATURE_FROM_SHARE;

// Lamps around the plaza (screen px; ground y). The statue stands in the middle.
export const LAMP_SPOTS: [number, number][] = [
  { x: 262, y: 318 },
  { x: 698, y: 318 },
  { x: 372, y: 414 },
  { x: 588, y: 414 },
  { x: 480, y: 246 },
].map(({ x, y }) => [x, y]);

export interface Lamp {
  x: number;
  y: number;
  lit: boolean;
  relight: number;
  flicker: number;
}
export interface Monster {
  id: number;
  kind: MonsterKind;
  x: number;
  y: number;
  health: number;
  age: number;
  wobble: number;
  snuff: number;
  attackCooldown: number;
  hurt: number;
  stun: number; // frozen by a hit
  knockX: number; // thrown by a hit: ground velocity, px/s
  knockY: number;
}
interface Shot {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  hit: number[];
}
// What a kill leaves for the renderer: the dead monster as a white silhouette, thrown back along the blow.
interface Ghost {
  monster: MonsterKind;
  x: number;
  y: number;
  monsterAge: number;
}
export interface Puff {
  id: number;
  x: number;
  y: number;
  age: number;
  kind: "kill" | "snuff" | "light" | "hurt" | "hit";
  directionX: number; // the blow's direction on the ground (0, 0 for a puff that has none)
  directionY: number;
  ghost: Ghost | null;
}
export interface Hero {
  x: number;
  y: number;
  animation: HeroAnimation;
  frameTime: number;
  directionX: number; // the way he last walked or was told to turn, a unit vector on the ground
  directionY: number;
  octant: number; // the eight-way direction he faces, 0 east and clockwise on the screen (see scene/assets.ts)
  fired: boolean;
  aim: { x: number; y: number } | null;
  health: number;
  maxHealth: number;
  hurt: number; // counts down from HERO_HURT_TIME after a blow: the flash, then the red tint
  shotCooldown: number;
  hold: number; // the animation waits a beat after a swing connects
  hits: number; // blows taken this night (the scene reads it to start the shake and the HUD flash)
  stun: number; // hit-stop: frozen by a blow
  mercy: number; // mercy frames: no further blow lands while this runs
  knockX: number; // thrown by a blow: ground velocity, px/s
  knockY: number;
}
export type Outcome = "dawn" | "dark" | "fallen";
interface Stats {
  kills: number;
  lampsLost: number;
  hpLost: number;
  time: number;
}
interface Rules {
  speed: number;
  meleeReach: number;
  meleeDamage: number;
  shotCooldown: number;
  spread: boolean;
  pierce: boolean;
  relight: number; // seconds standing at a dark lamp to relight it
  snuffMultiplier: number;
  lightRadius: number;
  pushScale: number; // how far the warden's blows throw a monster, against the base push
  oilChance: number; // the chance a kill leaves its oil
}
export interface State {
  hero: Hero;
  monsters: Monster[];
  shots: Shot[];
  puffs: Puff[];
  lamps: Lamp[];
  night: number;
  length: number;
  elapsed: number;
  spawnTimer: number;
  nextId: number;
  tide: number;
  mix: Mix; // the director's weights on the hand-made monsters (1 each: the sim's own)
  creatureShare: number; // the director's share of the spawns that are the night's creature
  creature: NightCreature | null;
  randomState: number; // mulberry32 state: a night replays exactly from its seed and inputs
  rules: Rules;
  stats: Stats;
  oilEarned: number;
  outcome: Outcome | null;
}

// A night lasts NIGHT_BASE seconds, and NIGHT_STEP more for every night after the first, up to the night NIGHT_CAP_NIGHT
// (the seventh); the nights after it are as long as that one.
const NIGHT_BASE = 16;
const NIGHT_STEP = 6;
const NIGHT_CAP_NIGHT = 7;
export const nightLength = (night: number) => NIGHT_BASE + NIGHT_STEP * Math.min(night - 1, NIGHT_CAP_NIGHT - 1);

// What the rules start from, and what a level of an upgrade (or a trait) does to them.
const WARDEN = {
  speed: 150, // ground px/s
  swiftSpeed: 1.25, // the swift trait's
  strideSpeed: 0.08, // a level of stride's, of the speed
  reach: 64,
  bladeReach: 10, // a level of blade's
  longarmReach: 16, // the longarm trait's
  shotCooldown: 0.55, // seconds
  quiverQuickening: 0.15, // a level of quiver's, of the cooldown
  relight: 1, // seconds standing by a dark lamp
  lamplighterRelight: 0.5, // the lamplighter trait's
  tinderRelight: 0.8, // each level of tinder a fifth quicker, on top of the trait
  wickSnuff: 0.35, // a level of wick's: how much longer a monster takes to snuff a lamp
  lightRadius: 92,
  wickLight: 12, // a level of wick's
  knockbackPush: 0.4, // a level of knockback's
  health: 100,
  heartHealth: 20, // a level of heart's
  hideHealth: 30, // a level of hide's
  stoutHealth: 30, // the stout trait's
  startBelowCentre: 62, // where he stands at dusk, below the statue
};

function rulesFor(legacy: Pick<Legacy, "levels">, trait: TraitId): Rules {
  const { wick, blade, quiver, knockback, seeker, tinder, stride } = legacy.levels;
  return {
    speed: WARDEN.speed * (trait === "swift" ? WARDEN.swiftSpeed : 1) * (1 + WARDEN.strideSpeed * stride),
    meleeReach: WARDEN.reach + blade * WARDEN.bladeReach + (trait === "longarm" ? WARDEN.longarmReach : 0),
    meleeDamage: 2 + (blade >= 2 ? 1 : 0),
    shotCooldown: WARDEN.shotCooldown * (1 - WARDEN.quiverQuickening * quiver),
    spread: quiver >= 2,
    pierce: trait === "keen",
    relight: (trait === "lamplighter" ? WARDEN.lamplighterRelight : WARDEN.relight) * WARDEN.tinderRelight ** tinder,
    snuffMultiplier: 1 + WARDEN.wickSnuff * wick,
    lightRadius: WARDEN.lightRadius + WARDEN.wickLight * wick,
    pushScale: 1 + WARDEN.knockbackPush * knockback,
    oilChance: OIL_CHANCE + OIL_CHANCE_PER_LEVEL * seeker,
  };
}

// seeded RNG kept in the state (mulberry32)
function rand(state: State): number {
  const draw = nextRandom(state.randomState);
  state.randomState = draw.seed;
  return draw.value;
}
export const newSeed = () => (Math.random() * UINT32_RANGE) >>> 0; // any unsigned 32-bit number

const FLICKER_OFFSET = 1.7;

export function newNight(legacy: Legacy, seed = newSeed(), creature: NightCreature | null = null): State {
  const rules = rulesFor(legacy, legacy.heir.trait);
  const { heart, hide } = legacy.levels;
  const maxHealth =
    WARDEN.health +
    WARDEN.heartHealth * heart +
    WARDEN.hideHealth * hide +
    (legacy.heir.trait === "stout" ? WARDEN.stoutHealth : 0);
  const state: State = {
    hero: {
      x: CENTRE_X,
      y: CENTRE_Y + WARDEN.startBelowCentre,
      animation: "idle",
      frameTime: 0,
      directionX: 0,
      directionY: 1,
      octant: 2,
      fired: false,
      aim: null,
      health: maxHealth,
      maxHealth,
      hurt: 0,
      shotCooldown: 0,
      hold: 0,
      hits: 0,
      stun: 0,
      mercy: 0,
      knockX: 0,
      knockY: 0,
    },
    monsters: [],
    shots: [],
    puffs: [],
    // each lamp starts its flicker at its own point, so they do not breathe together
    lamps: LAMP_SPOTS.map(([x, y], index) => ({ x, y, lit: true, relight: 0, flicker: index * FLICKER_OFFSET })),
    night: legacy.night,
    length: nightLength(legacy.night),
    elapsed: 0,
    spawnTimer: FIRST_SPAWN,
    nextId: 1,
    tide: legacy.tide,
    mix: { ...legacy.director.mix },
    creatureShare: legacy.director.creatureShare,
    creature,
    randomState: seed | 0,
    rules,
    stats: { kills: 0, lampsLost: 0, hpLost: 0, time: 0 },
    oilEarned: 0,
    outcome: null,
  };
  return state;
}

const plazaRim = (x: number, y: number) =>
  Math.abs(x - CENTRE_X) / PLAZA_HALF_WIDTH + Math.abs(y - CENTRE_Y) / PLAZA_HALF_HEIGHT;
function inPlaza(x: number, y: number, margin = 0.92) {
  return plazaRim(x, y) <= margin;
}
// ground distance in iso: vertical is foreshortened 2:1
export const ground = (fromX: number, fromY: number, toX: number, toY: number) =>
  Math.hypot(fromX - toX, (fromY - toY) * 2);

// The seconds between spawns on night 1 at tide 1. It was 2.3 when night 1 lasted 40 s; on a shorter night a crowd has
// far less time to build, so the sea comes quicker to keep a night about as hard to hold (tuned on the human-paced bot).
const SPAWN_INTERVAL = 1.3;
// The sea quickens every night. The first nights are gentle, 12% quicker a night, because that is when a person is still
// learning the plaza (people kept up with about two monsters at a time and lost night 2); from the fourth night it is
// 30% quicker a night, which is the pace the perfect bot's ceiling was set on. Only the rate of spawns is gentled: the
// cap on monsters alive and their haste grow as before, because the retune on the human-paced bot did not need them.
const GENTLE_NIGHTS = 3;
const GENTLE_QUICKENING = 0.12;
const QUICKENING = 0.3;
const quickening = (night: number) =>
  GENTLE_QUICKENING * (Math.min(night, GENTLE_NIGHTS) - 1) + QUICKENING * Math.max(0, night - GENTLE_NIGHTS);
const spawnInterval = (state: State) => SPAWN_INTERVAL / (state.tide * (1 + quickening(state.night)));
// how many monsters may be alive at once: a few, and more every night, scaled by the tide
const ALIVE_BASE = 3;
const ALIVE_PER_NIGHT = 1.6;
const maxAlive = (state: State) => Math.round((ALIVE_BASE + ALIVE_PER_NIGHT * state.night) * state.tide);
const HASTE_PER_NIGHT = 0.05; // the sea's creatures get bolder every night
const haste = (state: State) => 1 + HASTE_PER_NIGHT * (state.night - 1);
// how often each kind rises: the satyr by the mix alone, the harpy and the cyclops (from night 2) more every night
const KIND_WEIGHTS = {
  harpy: { base: 0.4, perNight: 0.1 },
  cyclops: { base: 0.15, perNight: 0.1, from: 2 },
};

function pickKind(state: State, roll: number): MonsterKind {
  const weights: [MonsterKind, number][] = [
    ["satyr", Number(state.mix.satyr)],
    ["harpy", (KIND_WEIGHTS.harpy.base + KIND_WEIGHTS.harpy.perNight * state.night) * state.mix.harpy],
    [
      "cyclops",
      state.night >= KIND_WEIGHTS.cyclops.from
        ? (KIND_WEIGHTS.cyclops.base + KIND_WEIGHTS.cyclops.perNight * state.night) * state.mix.cyclops
        : 0,
    ],
  ];
  let remaining = roll * weights.reduce((total, [, weight]) => total + weight, 0);
  for (const [kind, weight] of weights) {
    remaining -= weight;
    if (remaining < 0) {
      return kind;
    }
  }
  return "satyr";
}

// The stats a kind of monster plays by tonight: the creature's, or the hand-made monster's.
export function monsterStats(state: Pick<State, "creature">, kind: MonsterKind): CreatureStats {
  if (kind !== "creature") {
    return MONSTER[kind];
  }
  return state.creature?.stats ?? MONSTER.satyr;
}

const creaturesAlive = (state: State) => state.monsters.filter((monster) => monster.kind === "creature").length;

// Where a monster rises: on the ellipse just inside the rim, and how far it may wobble from side to side.
const SPAWN_RISE = {
  harbourChance: 0.6, // how often it comes from the harbour side
  harbourFrom: 0.15, // that side's arc, in half-turns from the right
  harbourSpan: 0.7,
  rim: 0.9, // the ellipse, as a share of the plaza's half-width and half-height
  wobbleSpread: 18, // px of wobble above the least, 10
};

function spawn(state: State) {
  let kind = pickKind(state, rand(state));
  if (
    state.creature &&
    state.elapsed >= creatureFrom(state.length) &&
    creaturesAlive(state) < CREATURE_CAP &&
    rand(state) < state.creatureShare
  ) {
    kind = "creature";
  }
  // out of the sea: anywhere on the rim, a little more often from the harbour side (bottom)
  const angle =
    rand(state) < SPAWN_RISE.harbourChance
      ? Math.PI * (SPAWN_RISE.harbourFrom + rand(state) * SPAWN_RISE.harbourSpan)
      : rand(state) * Math.PI * 2;
  state.monsters.push({
    id: state.nextId++,
    kind,
    x: CENTRE_X + Math.cos(angle) * PLAZA_HALF_WIDTH * SPAWN_RISE.rim,
    y: CENTRE_Y + Math.sin(angle) * PLAZA_HALF_HEIGHT * SPAWN_RISE.rim,
    health: monsterStats(state, kind).health,
    age: rand(state) * 10,
    wobble: 10 + rand(state) * SPAWN_RISE.wobbleSpread,
    snuff: 0,
    attackCooldown: 0,
    hurt: 0,
    stun: 0,
    knockX: 0,
    knockY: 0,
  });
}

export interface Input {
  moveX: number;
  moveY: number;
  melee: boolean;
  ranged: boolean;
  aim: { x: number; y: number } | null;
}
// A shot leaves the warden's hand on the third frame of the draw, `height` px above his feet, and flies `speed` px/s;
// a spread looses three, `spread` radians apart. It hits what is within `hitRadius` of it, and is dropped once it is
// `offStage` px off the stage.
const SHOT = { loosedOnFrame: 3, height: 40, speed: 420, spread: 0.16, hitRadius: 30, offStage: 50 };
const PUFF_TIME = 0.5; // seconds a puff lasts
const SCREEN_PER_GROUND_Y = 0.5; // the plaza is foreshortened 2:1: a ground step down is half as far down the screen
const RELIGHT_REACH = 40; // how near a dark lamp the warden stands to relight it
const LANTERN_HEIGHT = 40; // where a lamp's puff shows, above its foot
const KILL_PUFF_HEIGHT = 30; // where a kill's puff shows, above the monster's feet
// A monster claws the warden from `wardenReach` away, once every `cooldown` seconds.
const CLAW = { wardenReach: 26, cooldown: 1.1 };
// Where the claw lands on the warden: on the near side of his chest, `chest` px up, pushed along the blow.
const CLAWED_AT = { across: 8, chest: 30, down: 4 };
// A monster in the light goes at 70% of its speed, a wounded one at 30%; its wobble swings at `wobbleRate` and fades
// in the last `wobbleFade` px to its target.
const MONSTER_PACE = { inLight: 0.7, hurt: 0.3, wobbleRate: 2.2, wobbleFade: 80 };

export const NO_INPUT: Input = { moveX: 0, moveY: 0, melee: false, ranged: false, aim: null };

export const litCount = (state: State) => state.lamps.reduce((count, lamp) => count + (lamp.lit ? 1 : 0), 0);
const inLight = (state: State, x: number, y: number) =>
  state.lamps.some((lamp) => lamp.lit && ground(lamp.x, lamp.y, x, y) < state.rules.lightRadius);
const AGGRO = 80;

// Whether a point is inside the warden's swing: within reach and within the arc in front of the direction he faces.
function inSwing(hero: Hero, targetX: number, targetY: number, reach: number): boolean {
  const offsetX = targetX - hero.x;
  const offsetY = (targetY - hero.y) * 2;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance >= reach) {
    return false;
  }
  const [facingX, facingY] = octantVector(hero.octant);
  return offsetX * facingX + offsetY * facingY >= distance * Math.cos(SWING_HALF_ARC);
}

// Faces a heading (ground space); false when there is none.
function turn(hero: Hero, moveX: number, moveY: number): boolean {
  const length = Math.hypot(moveX, moveY);
  if (length === 0) {
    return false;
  }
  hero.directionX = moveX / length;
  hero.directionY = moveY / length;
  // he takes the nearest of the eight directions, once the heading is clearly past the edge of the one he faces
  if (offsetFromOctant(moveX, moveY, hero.octant) > HALF_OCTANT + FACING_HYSTERESIS) {
    hero.octant = octantOf(moveX, moveY);
  }
  return true;
}

// where on screen a monster's body is, above its feet: what a shot aims at and a blow lands on
const BODY_HEIGHT = { flying: 56, walking: 32 };
export const bodyHeight = (state: Pick<State, "creature">, kind: MonsterKind) =>
  monsterStats(state, kind).fly ? BODY_HEIGHT.flying : BODY_HEIGHT.walking;

function addPuff(
  state: State,
  x: number,
  y: number,
  kind: Puff["kind"],
  blow?: Pick<Puff, "directionX" | "directionY">,
): Puff {
  const puff: Puff = {
    id: state.nextId++,
    x,
    y,
    age: 0,
    kind,
    directionX: blow?.directionX ?? 0,
    directionY: blow?.directionY ?? 0,
    ghost: null,
  };
  state.puffs.push(puff);
  return puff;
}

export function step(state: State, deltaTime: number, input: Input) {
  if (state.outcome) {
    return;
  }
  state.elapsed += deltaTime;
  state.stats.time += deltaTime;
  const hero = state.hero;
  const stunned = tickHero(hero, deltaTime);
  startAttack(hero, input, stunned);
  const attacking = hero.animation === "melee" || hero.animation === "ranged";
  if (!attacking && !stunned) {
    walk(hero, input, state.rules.speed, deltaTime);
  }
  const frame = animateHero(hero, deltaTime, stunned, attacking);

  // attack effects land mid-animation
  if (hero.animation === "melee" && !hero.fired && frame >= 2) {
    landSwing(state);
  }
  if (hero.animation === "ranged" && !hero.fired && frame >= SHOT.loosedOnFrame) {
    fireShots(state);
  }
  moveShots(state, deltaTime);
  tendLamps(state, deltaTime);
  for (const monster of state.monsters.slice()) {
    actMonster(state, monster, deltaTime);
  }

  for (const puff of state.puffs) {
    puff.age += deltaTime;
  }
  state.puffs = state.puffs.filter((puff) => puff.age < PUFF_TIME);

  if (state.elapsed < state.length) {
    state.spawnTimer -= deltaTime;
    if (state.spawnTimer <= 0 && state.monsters.length < maxAlive(state)) {
      spawn(state);
      state.spawnTimer = spawnInterval(state);
    }
  }
  settle(state);
}

// Runs down the warden's timers and his push; true when he was stunned at the start of this step.
function tickHero(hero: Hero, deltaTime: number): boolean {
  hero.hurt = Math.max(0, hero.hurt - deltaTime);
  hero.mercy = Math.max(0, hero.mercy - deltaTime);
  hero.shotCooldown = Math.max(0, hero.shotCooldown - deltaTime);
  const stunned = hero.stun > 0;
  hero.stun = Math.max(0, hero.stun - deltaTime);
  if (hero.knockX !== 0 || hero.knockY !== 0) {
    knock(hero, deltaTime, HERO_KNOCK_LIMIT);
  }
  return stunned;
}

// A swing or a shot starts when he is free to: not stunned, and not already in one.
function startAttack(hero: Hero, input: Input, stunned: boolean) {
  const busy = stunned || hero.animation === "melee" || hero.animation === "ranged";
  if (busy) {
    return;
  }
  if (input.melee) {
    hero.animation = "melee";
    hero.frameTime = 0;
    hero.fired = false;
    turn(hero, input.moveX, input.moveY);
  } else if (input.ranged && hero.shotCooldown <= 0) {
    hero.animation = "ranged";
    hero.frameTime = 0;
    hero.fired = false;
    hero.aim = input.aim;
    // a shot with a mouse aim faces the aim, from the first frame of the draw (the ground's y is twice the screen's)
    if (input.aim) {
      const aimX = input.aim.x - hero.x;
      const aimY = (input.aim.y - (hero.y - SHOT.height)) * 2;
      if (aimX !== 0 || aimY !== 0) {
        hero.octant = octantOf(aimX, aimY);
      }
    }
  }
}

// Walks the way the input points at `speed`, sliding along the plaza's edge, or stands idle.
function walk(hero: Hero, input: Input, speed: number, deltaTime: number) {
  if (!turn(hero, input.moveX, input.moveY)) {
    if (hero.animation !== "idle") {
      hero.animation = "idle";
      hero.frameTime = 0;
    }
    return;
  }
  const nextX = hero.x + hero.directionX * speed * deltaTime;
  const nextY = hero.y + hero.directionY * speed * deltaTime * SCREEN_PER_GROUND_Y;
  if (inPlaza(nextX, nextY)) {
    hero.x = nextX;
    hero.y = nextY;
  } else if (inPlaza(nextX, hero.y)) {
    hero.x = nextX;
  } else if (inPlaza(hero.x, nextY)) {
    hero.y = nextY;
  }
  if (hero.animation !== "walk") {
    hero.animation = "walk";
    hero.frameTime = 0;
  }
}

// Advances his animation (held still by a hit-stop or a stun) and ends an attack that has played out; returns the
// frame the attack is on.
function animateHero(hero: Hero, deltaTime: number, stunned: boolean, attacking: boolean): number {
  hero.hold = Math.max(0, hero.hold - deltaTime);
  if (hero.hold <= 0 && !stunned) {
    hero.frameTime += deltaTime;
  }
  const frame = Math.floor(hero.frameTime * FRAMES_PER_SECOND[hero.animation]);
  if (attacking && frame >= FRAMES[hero.animation]) {
    hero.animation = "idle";
    hero.frameTime = 0;
  }
  return frame;
}

// The swing lands on everything inside it, each thrown straight away from the warden; a hit holds the swing a moment.
function landSwing(state: State) {
  const hero = state.hero;
  const rules = state.rules;
  hero.fired = true;
  let connected = false;
  for (const monster of state.monsters.slice()) {
    if (!inSwing(hero, monster.x, monster.y, rules.meleeReach)) {
      continue;
    }
    const awayX = monster.x - hero.x;
    const awayY = (monster.y - hero.y) * 2;
    const away = Math.hypot(awayX, awayY);
    const [facingX, facingY] = octantVector(hero.octant);
    strike(state, monster, {
      ...MELEE_BLOW,
      push: MELEE_BLOW.push * rules.pushScale,
      amount: rules.meleeDamage,
      directionX: away > 0 ? awayX / away : facingX,
      directionY: away > 0 ? awayY / away : facingY,
      x: monster.x,
      y: monster.y - bodyHeight(state, monster.kind),
    });
    connected = true;
  }
  if (connected) {
    hero.hold = SWING_HOLD;
  }
}

function fireShots(state: State) {
  const hero = state.hero;
  const rules = state.rules;
  hero.fired = true;
  hero.shotCooldown = rules.shotCooldown;
  // with no mouse aim the shot flies the way he faces on the ground (the ground's y is twice the screen's, so on the
  // screen its slope is halved), as the drawn sprite and the swing's wedge show
  const [facingX, facingY] = octantVector(hero.octant);
  let aimX = facingX;
  let aimY = facingY / 2;
  if (hero.aim) {
    aimX = hero.aim.x - hero.x;
    aimY = hero.aim.y - (hero.y - SHOT.height);
  }
  const base = Math.atan2(aimY, aimX);
  for (const offset of rules.spread ? [-SHOT.spread, 0, SHOT.spread] : [0]) {
    const angle = base + offset;
    state.shots.push({
      id: state.nextId++,
      x: hero.x,
      y: hero.y - SHOT.height,
      velocityX: Math.cos(angle) * SHOT.speed,
      velocityY: Math.sin(angle) * SHOT.speed,
      life: 1.2,
      hit: [],
    });
  }
}

// Flies every shot on, strikes what it passes through (once each), and drops the spent and the gone.
function moveShots(state: State, deltaTime: number) {
  for (const shot of state.shots) {
    shot.x += shot.velocityX * deltaTime;
    shot.y += shot.velocityY * deltaTime;
    shot.life -= deltaTime;
    for (const monster of state.monsters.slice()) {
      if (shot.hit.includes(monster.id)) {
        continue;
      }
      const bodyY = monster.y - bodyHeight(state, monster.kind);
      if (Math.hypot(monster.x - shot.x, bodyY - shot.y) >= SHOT.hitRadius) {
        continue;
      }
      shot.hit.push(monster.id);
      const speed = Math.hypot(shot.velocityX, shot.velocityY * 2);
      strike(state, monster, {
        ...SHOT_BLOW,
        push: SHOT_BLOW.push * state.rules.pushScale,
        amount: 1,
        directionX: shot.velocityX / speed,
        directionY: (shot.velocityY * 2) / speed,
        x: shot.x,
        y: shot.y,
      });
      if (!state.rules.pierce) {
        shot.life = 0;
        break;
      }
    }
  }
  state.shots = state.shots.filter(
    (shot) =>
      shot.life > 0 &&
      shot.x > -SHOT.offStage &&
      shot.x < STAGE_WIDTH + SHOT.offStage &&
      shot.y > -SHOT.offStage &&
      shot.y < STAGE_HEIGHT + SHOT.offStage,
  );
}

// relight: stand by a dark lamp
function tendLamps(state: State, deltaTime: number) {
  const hero = state.hero;
  for (const lamp of state.lamps) {
    lamp.flicker += deltaTime;
    if (lamp.lit) {
      continue;
    }
    if (ground(lamp.x, lamp.y, hero.x, hero.y) < RELIGHT_REACH) {
      lamp.relight += deltaTime;
      if (lamp.relight >= state.rules.relight) {
        lamp.lit = true;
        lamp.relight = 0;
        addPuff(state, lamp.x, lamp.y - LANTERN_HEIGHT, "light");
      }
    } else {
      lamp.relight = Math.max(0, lamp.relight - deltaTime * 2);
    }
  }
}

// The nearest lit lamp to a monster, or null when every lamp is dark.
function nearestLitLamp(state: State, monster: Monster): Lamp | null {
  let lamp: Lamp | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of state.lamps) {
    if (candidate.lit) {
      const distance = ground(monster.x, monster.y, candidate.x, candidate.y);
      if (distance < best) {
        best = distance;
        lamp = candidate;
      }
    }
  }
  return lamp;
}

// One monster's step: it goes for the warden if he is close, else for the nearest lit lamp, and claws what it reaches.
function actMonster(state: State, monster: Monster, deltaTime: number) {
  const hero = state.hero;
  const stats = monsterStats(state, monster.kind);
  monster.age += deltaTime;
  monster.attackCooldown = Math.max(0, monster.attackCooldown - deltaTime);
  monster.hurt = Math.max(0, monster.hurt - deltaTime);
  if (monster.stun > 0) {
    monster.stun = Math.max(0, monster.stun - deltaTime);
    return;
  }
  if (monster.knockX !== 0 || monster.knockY !== 0) {
    knock(monster, deltaTime);
  }
  const lamp = ground(monster.x, monster.y, hero.x, hero.y) > AGGRO ? nearestLitLamp(state, monster) : null;
  const targetX = lamp ? lamp.x : hero.x;
  const targetY = lamp ? lamp.y : hero.y;
  const towardX = targetX - monster.x;
  const towardY = (targetY - monster.y) * 2;
  const distance = Math.hypot(towardX, towardY) || 1;
  if (!lamp && distance < CLAW.wardenReach) {
    // claw the warden
    // mercy frames: while they run the monster waits, and claws the moment they end
    if (monster.attackCooldown <= 0 && hero.mercy <= 0) {
      monster.attackCooldown = CLAW.cooldown;
      wound(state, stats.damage, towardX / distance, towardY / distance);
    }
    return;
  }
  if (lamp && distance < 24) {
    clawLamp(state, monster, lamp, stats.snuff * state.rules.snuffMultiplier, deltaTime);
    return;
  }
  monster.snuff = 0;
  advance(state, monster, stats.speed, towardX / distance, towardY / distance, distance, deltaTime);
}

// Moves a monster along (groundX, groundY) in ground space, `distance` from its target, with a sideways wobble; the
// light slows it, and so does a wound.
function advance(
  state: State,
  monster: Monster,
  baseSpeed: number,
  groundX: number,
  groundY: number,
  distance: number,
  deltaTime: number,
) {
  const speed =
    baseSpeed *
    haste(state) *
    (inLight(state, monster.x, monster.y) ? MONSTER_PACE.inLight : 1) *
    (monster.hurt > 0 ? MONSTER_PACE.hurt : 1);
  const lateral =
    Math.cos(monster.age * MONSTER_PACE.wobbleRate) * monster.wobble * Math.min(1, distance / MONSTER_PACE.wobbleFade);
  monster.x += (groundX * speed - groundY * lateral) * deltaTime;
  monster.y += (groundY * speed + groundX * lateral) * deltaTime * SCREEN_PER_GROUND_Y;
}

// A monster at a lamp claws at it; once it has clawed for `snuffTime` the lamp goes out.
function clawLamp(state: State, monster: Monster, lamp: Lamp, snuffTime: number, deltaTime: number) {
  monster.snuff += deltaTime;
  if (monster.snuff >= snuffTime) {
    lamp.lit = false;
    lamp.relight = 0;
    monster.snuff = 0;
    state.stats.lampsLost++;
    addPuff(state, lamp.x, lamp.y - LANTERN_HEIGHT, "snuff");
  }
}

// The night ends when the warden falls, the last lamp goes out, or dawn comes.
function settle(state: State) {
  if (state.hero.health <= 0) {
    state.outcome = "fallen";
  } else if (litCount(state) === 0) {
    state.outcome = "dark";
  } else if (state.elapsed >= state.length) {
    // dawn: the sun burns the stragglers away
    for (const monster of state.monsters) {
      addPuff(state, monster.x, monster.y - KILL_PUFF_HEIGHT, "kill");
    }
    state.monsters = [];
    state.outcome = "dawn";
  }
}

interface Blow {
  amount: number;
  push: number;
  stun: number;
  directionX: number; // unit, on the ground
  directionY: number;
  x: number; // where it lands on screen
  y: number;
}

// The one path every blow takes, melee or shot: damage, an impact burst where it lands, then either the monster is
// frozen and thrown back, or it dies and leaves its silhouette flying.
function strike(state: State, monster: Monster, blow: Blow) {
  addPuff(state, blow.x, blow.y, "hit", blow);
  monster.health -= blow.amount;
  monster.hurt = HURT_TIME;
  if (monster.health > 0) {
    const recoil = monsterStats(state, monster.kind).recoil;
    monster.stun = blow.stun;
    monster.knockX = blow.directionX * blow.push * recoil;
    monster.knockY = blow.directionY * blow.push * recoil;
    return;
  }
  state.monsters = state.monsters.filter((other) => other !== monster);
  addPuff(state, monster.x, monster.y - KILL_PUFF_HEIGHT, "kill", blow).ghost = {
    monster: monster.kind,
    x: monster.x,
    y: monster.y,
    monsterAge: monster.age,
  };
  state.stats.kills++;
  if (rand(state) < state.rules.oilChance) {
    state.oilEarned += monsterStats(state, monster.kind).oil;
  }
}

// A monster's blow on the warden: damage, a hit-stop, a push, mercy frames and the impact burst. (blowX, blowY) is the
// unit direction of the blow on the ground, from the attacker through the warden.
function wound(state: State, damage: number, blowX: number, blowY: number) {
  const hero = state.hero;
  hero.health = Math.max(0, hero.health - damage);
  hero.hurt = HERO_HURT_TIME;
  hero.hits++;
  hero.stun = HERO_BLOW.stun;
  hero.mercy = MERCY_TIME;
  hero.knockX = blowX * HERO_BLOW.push;
  hero.knockY = blowY * HERO_BLOW.push;
  state.stats.hpLost += damage;
  // the burst is where the claw lands, on the near side of the warden's chest, thrown along the blow
  addPuff(state, hero.x - blowX * CLAWED_AT.across, hero.y - CLAWED_AT.chest - blowY * CLAWED_AT.down, "hurt", {
    directionX: blowX,
    directionY: blowY,
  });
}

const KNOCK_STOP = 8; // ground px/s: a push slower than this has died away

// Slides a thrown body (a monster, or the warden) along its push and lets the push die away. It never ends up farther
// out than the rim it was on (or `edge`, how near the plaza's rim it may be left), so the sea stays where it is;
// against the edge it slides along it.
interface Thrown {
  x: number;
  y: number;
  knockX: number;
  knockY: number;
}
function knock(monster: Thrown, deltaTime: number, edge = KNOCK_LIMIT) {
  const nextX = monster.x + monster.knockX * deltaTime;
  const nextY = monster.y + monster.knockY * deltaTime * SCREEN_PER_GROUND_Y;
  const limit = Math.max(edge, plazaRim(monster.x, monster.y));
  if (plazaRim(nextX, nextY) <= limit) {
    monster.x = nextX;
    monster.y = nextY;
  } else if (plazaRim(nextX, monster.y) <= limit) {
    monster.x = nextX;
  } else if (plazaRim(monster.x, nextY) <= limit) {
    monster.y = nextY;
  }
  const drag = Math.max(0, 1 - KNOCK_DRAG * deltaTime);
  monster.knockX *= drag;
  monster.knockY *= drag;
  if (Math.hypot(monster.knockX, monster.knockY) < KNOCK_STOP) {
    monster.knockX = 0;
    monster.knockY = 0;
  }
}

// Dawn reward: a little oil, and a little more for every lamp still burning.
export const dawnBonus = (state: State) => 2 + litCount(state);

// How much a clean dawn raises the tide: more for a warden who killed fast, and about half as much after the first two
// nights, when the warden is still learning (the plaza, the aimed swing, which lamp to keep).
const TIDE_RISE = {
  learning: { fast: 1.1, steady: 1.06 },
  settled: { fast: 1.18, steady: 1.1 },
};
const LEARNING_NIGHTS = 2;

// What the rules read of a night that ended: all of it is in a recorded play's stats, so the live director's server
// can work out what the rules would have chosen without replaying anything.
export interface NightResult {
  night: number; // which night of the line it was
  outcome: Outcome | null;
  kills: number;
  seconds: number;
  lampsLost: number;
  health: number;
  maxHealth: number;
}

// A clean dawn keeps more than half the warden's health (and loses at most one lamp); a fast one kills more than 20 a
// minute. A lost night eases the tide by 15%. The tide stays between 0.6 and 2, in hundredths.
const TIDE_RULES = { cleanHealth: 0.5, fastKillsPerMinute: 20, lostEase: 0.85, floor: 0.6, precision: 100 };

// The rules-based director: read the night as implicit feedback and set the next tide.
// Clean dawn with most lamps and health kept → the sea pushes harder; a lost night → it eases off.
export function rulesTide(tide: number, night: NightResult): number {
  const killRate = night.kills / Math.max(1 / 60, night.seconds / 60); // kills per minute, however short the night
  let next = tide;
  if (night.outcome === "dawn") {
    const clean = night.lampsLost <= 1 && night.health > night.maxHealth * TIDE_RULES.cleanHealth;
    const rise = TIDE_RISE[night.night <= LEARNING_NIGHTS ? "learning" : "settled"];
    if (clean) {
      next *= killRate > TIDE_RULES.fastKillsPerMinute ? rise.fast : rise.steady;
    }
  } else {
    next *= TIDE_RULES.lostEase;
  }
  return Math.min(2, Math.max(TIDE_RULES.floor, Math.round(next * TIDE_RULES.precision) / TIDE_RULES.precision));
}

export function nextTide(tide: number, state: State): number {
  return rulesTide(tide, {
    night: state.night,
    outcome: state.outcome,
    kills: state.stats.kills,
    seconds: state.stats.time,
    lampsLost: state.stats.lampsLost,
    health: state.hero.health,
    maxHealth: state.hero.maxHealth,
  });
}
