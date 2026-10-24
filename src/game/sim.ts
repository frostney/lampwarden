// One night in Lychnos: monsters come out of the sea to snuff the town's lamps; the warden fights and relights them until dawn.
// Pure game state and step(); no Pixi, so scripts/balance.ts can run it headless.
import { FRAMES, FRAMES_PER_SECOND, type HeroAnimation } from "../scene/assets";
import type { Legacy, TraitId } from "./legacy";

export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 600;
export const CENTRE_X = 480;
export const CENTRE_Y = 320;
export const PLAZA_HALF_WIDTH = 384; // plaza diamond half width (12 tiles of 64x32)
export const PLAZA_HALF_HEIGHT = 192;

export type MonsterKind = "satyr" | "cyclops" | "harpy";
// snuff: seconds of clawing to put a lamp out. oil: reward per kill. recoil: how far a blow throws it (the cyclops is
// heavy, the harpy light).
export const MONSTER: Record<
  MonsterKind,
  { speed: number; health: number; damage: number; snuff: number; oil: number; fly: boolean; recoil: number }
> = {
  satyr: { speed: 50, health: 1, damage: 8, snuff: 2.6, oil: 1, fly: false, recoil: 1 },
  cyclops: { speed: 30, health: 3, damage: 16, snuff: 1.5, oil: 3, fly: false, recoil: 0.6 },
  harpy: { speed: 76, health: 1, damage: 6, snuff: 3.2, oil: 1, fly: true, recoil: 1.3 },
};

// A swing reaches only the 120 degrees in front of the warden (measured on the ground, where the plaza is foreshortened
// 2:1), so it has to be aimed: hold a direction while striking to turn that way.
export const SWING_HALF_ARC = Math.PI / 3;
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

// Lamps around the plaza (screen px; ground y). The statue stands in the middle.
export const LAMP_SPOTS: [number, number][] = [
  [262, 318],
  [698, 318],
  [372, 414],
  [588, 414],
  [480, 246],
];

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
  left: boolean;
  directionX: number;
  directionY: number;
  fired: boolean;
  aim: { x: number; y: number } | null;
  health: number;
  maxHealth: number;
  hurt: number;
  shotCooldown: number;
  hold: number; // the animation waits a beat after a swing connects
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
  relight: number;
  snuffMultiplier: number;
  lightRadius: number;
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
  randomState: number; // mulberry32 state: a night replays exactly from its seed and inputs
  rules: Rules;
  stats: Stats;
  oilEarned: number;
  outcome: Outcome | null;
}

const nightLength = (night: number) => 40 + 6 * Math.min(night - 1, 6);

function rulesFor(legacy: Pick<Legacy, "levels">, trait: TraitId): Rules {
  const { wick, blade, quiver } = legacy.levels;
  return {
    speed: 150 * (trait === "swift" ? 1.25 : 1),
    meleeReach: 64 + blade * 10 + (trait === "longarm" ? 16 : 0),
    meleeDamage: 2 + (blade >= 2 ? 1 : 0),
    shotCooldown: 0.55 * (1 - 0.15 * quiver),
    spread: quiver >= 2,
    pierce: trait === "keen",
    relight: trait === "lamplighter" ? 0.5 : 1.0,
    snuffMultiplier: 1 + 0.35 * wick,
    lightRadius: 92 + 12 * wick,
  };
}

// seeded RNG kept in the state (mulberry32)
function rand(state: State): number {
  state.randomState = (state.randomState + 0x6d2b79f5) | 0;
  let value = state.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
export const newSeed = () => (Math.random() * 4294967296) >>> 0;

export function newNight(legacy: Legacy, seed = newSeed()): State {
  const rules = rulesFor(legacy, legacy.heir.trait);
  const maxHealth = 100 + 20 * legacy.levels.heart + (legacy.heir.trait === "stout" ? 30 : 0);
  const state: State = {
    hero: {
      x: CENTRE_X,
      y: CENTRE_Y + 62,
      animation: "idle",
      frameTime: 0,
      left: false,
      directionX: 0,
      directionY: 1,
      fired: false,
      aim: null,
      health: maxHealth,
      maxHealth,
      hurt: 0,
      shotCooldown: 0,
      hold: 0,
    },
    monsters: [],
    shots: [],
    puffs: [],
    lamps: LAMP_SPOTS.map(([x, y], index) => ({ x, y, lit: true, relight: 0, flicker: index * 1.7 })),
    night: legacy.night,
    length: nightLength(legacy.night),
    elapsed: 0,
    spawnTimer: 2.5,
    nextId: 1,
    tide: legacy.tide,
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

const spawnInterval = (state: State) => 2.3 / (state.tide * (1 + 0.3 * (state.night - 1)));
const maxAlive = (state: State) => Math.round((3 + 1.6 * state.night) * state.tide);
const haste = (state: State) => 1 + 0.05 * (state.night - 1); // the sea's creatures get bolder every night

function pickKind(state: State, roll: number): MonsterKind {
  const weights: [MonsterKind, number][] = [
    ["satyr", 1],
    ["harpy", 0.4 + 0.1 * state.night],
    ["cyclops", state.night >= 2 ? 0.15 + 0.1 * state.night : 0],
  ];
  let remaining = roll * weights.reduce((total, [, weight]) => total + weight, 0);
  for (const [kind, weight] of weights) {
    remaining -= weight;
    if (remaining < 0) return kind;
  }
  return "satyr";
}

function spawn(state: State) {
  const kind = pickKind(state, rand(state));
  // out of the sea: anywhere on the rim, a little more often from the harbour side (bottom)
  const angle = rand(state) < 0.6 ? Math.PI * (0.15 + rand(state) * 0.7) : rand(state) * Math.PI * 2;
  state.monsters.push({
    id: state.nextId++,
    kind,
    x: CENTRE_X + Math.cos(angle) * PLAZA_HALF_WIDTH * 0.9,
    y: CENTRE_Y + Math.sin(angle) * PLAZA_HALF_HEIGHT * 0.9,
    health: MONSTER[kind].health,
    age: rand(state) * 10,
    wobble: 10 + rand(state) * 18,
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
export const NO_INPUT: Input = { moveX: 0, moveY: 0, melee: false, ranged: false, aim: null };

export const litCount = (state: State) => state.lamps.reduce((count, lamp) => count + (lamp.lit ? 1 : 0), 0);
const inLight = (state: State, x: number, y: number) =>
  state.lamps.some((lamp) => lamp.lit && ground(lamp.x, lamp.y, x, y) < state.rules.lightRadius);
const AGGRO = 80;

// Whether a point is inside the warden's swing: within reach and within the arc in front of the facing.
function inSwing(hero: Hero, targetX: number, targetY: number, reach: number): boolean {
  const offsetX = targetX - hero.x;
  const offsetY = (targetY - hero.y) * 2;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance >= reach) return false;
  return offsetX * hero.directionX + offsetY * hero.directionY >= distance * Math.cos(SWING_HALF_ARC);
}

// Faces a heading (ground space); false when there is none.
function turn(hero: Hero, moveX: number, moveY: number): boolean {
  const length = Math.hypot(moveX, moveY);
  if (length === 0) return false;
  hero.directionX = moveX / length;
  hero.directionY = moveY / length;
  if (moveX !== 0) hero.left = moveX < 0;
  return true;
}

const bodyHeight = (kind: MonsterKind) => (MONSTER[kind].fly ? 56 : 32);

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
  if (state.outcome) return;
  state.elapsed += deltaTime;
  state.stats.time += deltaTime;
  const hero = state.hero;
  const rules = state.rules;
  hero.hurt = Math.max(0, hero.hurt - deltaTime);
  hero.shotCooldown = Math.max(0, hero.shotCooldown - deltaTime);
  const busy = hero.animation === "melee" || hero.animation === "ranged";

  if (!busy && input.melee) {
    hero.animation = "melee";
    hero.frameTime = 0;
    hero.fired = false;
    turn(hero, input.moveX, input.moveY);
  } else if (!busy && input.ranged && hero.shotCooldown <= 0) {
    hero.animation = "ranged";
    hero.frameTime = 0;
    hero.fired = false;
    hero.aim = input.aim;
  }

  const attacking = hero.animation === "melee" || hero.animation === "ranged";
  if (!attacking) {
    if (turn(hero, input.moveX, input.moveY)) {
      const unitX = hero.directionX;
      const unitY = hero.directionY;
      const nextX = hero.x + unitX * rules.speed * deltaTime;
      const nextY = hero.y + unitY * rules.speed * deltaTime * 0.5;
      if (inPlaza(nextX, nextY)) {
        hero.x = nextX;
        hero.y = nextY;
      } else if (inPlaza(nextX, hero.y)) hero.x = nextX;
      else if (inPlaza(hero.x, nextY)) hero.y = nextY;
      if (hero.animation !== "walk") {
        hero.animation = "walk";
        hero.frameTime = 0;
      }
    } else if (hero.animation !== "idle") {
      hero.animation = "idle";
      hero.frameTime = 0;
    }
  }

  hero.hold = Math.max(0, hero.hold - deltaTime);
  if (hero.hold <= 0) hero.frameTime += deltaTime;
  const frame = Math.floor(hero.frameTime * FRAMES_PER_SECOND[hero.animation]);
  if (attacking && frame >= FRAMES[hero.animation]) {
    hero.animation = "idle";
    hero.frameTime = 0;
  }

  // attack effects land mid-animation
  if (hero.animation === "melee" && !hero.fired && frame >= 2) {
    hero.fired = true;
    let connected = false;
    for (const monster of state.monsters.slice()) {
      if (!inSwing(hero, monster.x, monster.y, rules.meleeReach)) continue;
      // thrown straight away from the warden
      const awayX = monster.x - hero.x;
      const awayY = (monster.y - hero.y) * 2;
      const away = Math.hypot(awayX, awayY);
      strike(state, monster, {
        ...MELEE_BLOW,
        amount: rules.meleeDamage,
        directionX: away > 0 ? awayX / away : hero.directionX,
        directionY: away > 0 ? awayY / away : hero.directionY,
        x: monster.x,
        y: monster.y - bodyHeight(monster.kind),
      });
      connected = true;
    }
    if (connected) hero.hold = SWING_HOLD;
  }
  if (hero.animation === "ranged" && !hero.fired && frame >= 3) {
    hero.fired = true;
    hero.shotCooldown = rules.shotCooldown;
    let aimX = hero.directionX;
    let aimY = hero.directionY;
    if (hero.aim) {
      aimX = hero.aim.x - hero.x;
      aimY = hero.aim.y - (hero.y - 40);
    }
    const base = Math.atan2(aimY, aimX);
    if (aimX !== 0) hero.left = aimX < 0;
    for (const offset of rules.spread ? [-0.16, 0, 0.16] : [0]) {
      const angle = base + offset;
      state.shots.push({
        id: state.nextId++,
        x: hero.x,
        y: hero.y - 40,
        velocityX: Math.cos(angle) * 420,
        velocityY: Math.sin(angle) * 420,
        life: 1.2,
        hit: [],
      });
    }
  }

  for (const shot of state.shots) {
    shot.x += shot.velocityX * deltaTime;
    shot.y += shot.velocityY * deltaTime;
    shot.life -= deltaTime;
    for (const monster of state.monsters.slice()) {
      if (shot.hit.includes(monster.id)) continue;
      const bodyY = monster.y - bodyHeight(monster.kind);
      if (Math.hypot(monster.x - shot.x, bodyY - shot.y) < 30) {
        shot.hit.push(monster.id);
        const speed = Math.hypot(shot.velocityX, shot.velocityY * 2);
        strike(state, monster, {
          ...SHOT_BLOW,
          amount: 1,
          directionX: shot.velocityX / speed,
          directionY: (shot.velocityY * 2) / speed,
          x: shot.x,
          y: shot.y,
        });
        if (!rules.pierce) {
          shot.life = 0;
          break;
        }
      }
    }
  }
  state.shots = state.shots.filter(
    (shot) => shot.life > 0 && shot.x > -50 && shot.x < STAGE_WIDTH + 50 && shot.y > -50 && shot.y < STAGE_HEIGHT + 50,
  );

  // relight: stand by a dark lamp
  for (const lamp of state.lamps) {
    lamp.flicker += deltaTime;
    if (lamp.lit) continue;
    if (ground(lamp.x, lamp.y, hero.x, hero.y) < 40) {
      lamp.relight += deltaTime;
      if (lamp.relight >= rules.relight) {
        lamp.lit = true;
        lamp.relight = 0;
        addPuff(state, lamp.x, lamp.y - 40, "light");
      }
    } else lamp.relight = Math.max(0, lamp.relight - deltaTime * 2);
  }

  for (const monster of state.monsters.slice()) {
    const kind = MONSTER[monster.kind];
    monster.age += deltaTime;
    monster.attackCooldown = Math.max(0, monster.attackCooldown - deltaTime);
    monster.hurt = Math.max(0, monster.hurt - deltaTime);
    if (monster.stun > 0) {
      monster.stun = Math.max(0, monster.stun - deltaTime);
      continue;
    }
    if (monster.knockX !== 0 || monster.knockY !== 0) knock(monster, deltaTime);
    // target: the warden if close, else the nearest lit lamp
    const heroDistance = ground(monster.x, monster.y, hero.x, hero.y);
    let targetX = hero.x;
    let targetY = hero.y;
    let lamp: Lamp | null = null;
    if (heroDistance > AGGRO) {
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of state.lamps)
        if (candidate.lit) {
          const distance = ground(monster.x, monster.y, candidate.x, candidate.y);
          if (distance < best) {
            best = distance;
            lamp = candidate;
          }
        }
      if (lamp) {
        targetX = lamp.x;
        targetY = lamp.y;
      }
    }
    const towardX = targetX - monster.x;
    const towardY = (targetY - monster.y) * 2;
    const distance = Math.hypot(towardX, towardY) || 1;
    if (!lamp && distance < 26) {
      // claw the warden
      if (monster.attackCooldown <= 0) {
        monster.attackCooldown = 1.1;
        hero.health = Math.max(0, hero.health - kind.damage);
        hero.hurt = 0.35;
        state.stats.hpLost += kind.damage;
        addPuff(state, hero.x, hero.y - 30, "hurt");
      }
      continue;
    }
    if (lamp && distance < 24) {
      // claw the lamp
      monster.snuff += deltaTime;
      if (monster.snuff >= kind.snuff * rules.snuffMultiplier) {
        lamp.lit = false;
        lamp.relight = 0;
        monster.snuff = 0;
        state.stats.lampsLost++;
        addPuff(state, lamp.x, lamp.y - 40, "snuff");
      }
      continue;
    }
    monster.snuff = 0;
    // move in ground space with a sideways wobble; the light slows them
    const speed =
      kind.speed * haste(state) * (inLight(state, monster.x, monster.y) ? 0.7 : 1) * (monster.hurt > 0 ? 0.3 : 1);
    const groundX = towardX / distance;
    const groundY = towardY / distance;
    const lateral = Math.cos(monster.age * 2.2) * monster.wobble * Math.min(1, distance / 80);
    monster.x += (groundX * speed - groundY * lateral) * deltaTime;
    monster.y += (groundY * speed + groundX * lateral) * deltaTime * 0.5;
  }

  for (const puff of state.puffs) puff.age += deltaTime;
  state.puffs = state.puffs.filter((puff) => puff.age < 0.5);

  if (state.elapsed < state.length) {
    state.spawnTimer -= deltaTime;
    if (state.spawnTimer <= 0 && state.monsters.length < maxAlive(state)) {
      spawn(state);
      state.spawnTimer = spawnInterval(state);
    }
  }

  if (hero.health <= 0) state.outcome = "fallen";
  else if (litCount(state) === 0) state.outcome = "dark";
  else if (state.elapsed >= state.length) {
    // dawn: the sun burns the stragglers away
    for (const monster of state.monsters) addPuff(state, monster.x, monster.y - 30, "kill");
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
    const recoil = MONSTER[monster.kind].recoil;
    monster.stun = blow.stun;
    monster.knockX = blow.directionX * blow.push * recoil;
    monster.knockY = blow.directionY * blow.push * recoil;
    return;
  }
  state.monsters = state.monsters.filter((other) => other !== monster);
  addPuff(state, monster.x, monster.y - 30, "kill", blow).ghost = {
    monster: monster.kind,
    x: monster.x,
    y: monster.y,
    monsterAge: monster.age,
  };
  state.stats.kills++;
  state.oilEarned += MONSTER[monster.kind].oil;
}

// Slides a thrown monster along its push and lets the push die away. It never ends up farther out than the rim it was
// on (or the plaza's edge), so the sea stays where it is; against the edge it slides along it.
function knock(monster: Monster, deltaTime: number) {
  const nextX = monster.x + monster.knockX * deltaTime;
  const nextY = monster.y + monster.knockY * deltaTime * 0.5;
  const limit = Math.max(KNOCK_LIMIT, plazaRim(monster.x, monster.y));
  if (plazaRim(nextX, nextY) <= limit) {
    monster.x = nextX;
    monster.y = nextY;
  } else if (plazaRim(nextX, monster.y) <= limit) monster.x = nextX;
  else if (plazaRim(monster.x, nextY) <= limit) monster.y = nextY;
  const drag = Math.max(0, 1 - KNOCK_DRAG * deltaTime);
  monster.knockX *= drag;
  monster.knockY *= drag;
  if (Math.hypot(monster.knockX, monster.knockY) < 8) {
    monster.knockX = 0;
    monster.knockY = 0;
  }
}

// Dawn reward: oil for every lamp still burning.
export const dawnBonus = (state: State) => 4 + 2 * litCount(state);

// The director: read the night as implicit feedback and set the next tide.
// Clean dawn with most lamps and health kept → the sea pushes harder; a lost night → it eases off.
export function nextTide(tide: number, state: State): number {
  const killRate = state.stats.kills / Math.max(1, state.stats.time / 60); // kills per minute
  let next = tide;
  if (state.outcome === "dawn") {
    const clean = state.stats.lampsLost <= 1 && state.hero.health > state.hero.maxHealth * 0.5;
    next *= clean ? (killRate > 20 ? 1.18 : 1.1) : 1.0;
  } else next *= 0.85;
  return Math.min(2, Math.max(0.6, Math.round(next * 100) / 100));
}
