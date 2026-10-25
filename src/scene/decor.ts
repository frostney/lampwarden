// The scene's decorations, laid out afresh for every night: the temple, the house, the stall, the olives and the wall on
// the plaza, the galley's dock and the trireme on the sea beside it. Pure and render-only: the sim never reads it, and a
// night's layout comes from the night's seed through a stream of its own, so nothing here draws from the sim's
// rand(state) and a replay, which starts from the recorded seed, lays out the same plaza.
//
// What can be placed is data, DECOR below: a sprite key, where it may stand, how many and how they group. The placer
// tries spots for each kind in turn and keeps one only where the kind's base (its sprite's real pixels, measured into
// decor-extents.ts) lies inside the plaza with a margin and clear of everything that must stay clear: the lamps and the
// warden's way between them, the statue, the warden's start, where monsters come ashore, and the props already placed.
// Props have no collision, so none of this touches play.
import { nextRandom } from "../game/random";
import {
  CENTRE_X,
  CENTRE_Y,
  LAMP_SPOTS,
  PLAZA_HALF_HEIGHT,
  PLAZA_HALF_WIDTH,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from "../game/sim";
import { SPRITE_EXTENTS } from "./decor-extents";
import { type Box, convexHull, type Point, type SpriteExtents } from "./extent";
import { boxAt, boxesNear, groundShape, nearPoint, nearShape, type Shape, toGround } from "./footprint";
import { plazaInset, shoreDistance } from "./plaza";

// --- what can be placed ---------------------------------------------------------------------------------------------

type Where =
  | "centre" // the middle of the plaza, where the statue stands
  | "back" // the far half, behind the lamps: the big pieces, so they do not hide the play area
  | "front" // the near half, towards the middle
  | "anywhere" // anywhere on the stone
  | "edge" // along a rim that runs the way its sprite does (see `edges`)
  | "shore-left" // on the sea by the plaza's front left rim
  | "shore-right"; // on the sea by its front right rim
type Rim = "back-right" | "front-left"; // the rims that run from the top left to the bottom right, as the wall does

// a ring of water that spreads from a boat or a post, in canvas pixels (see water.ts)
export interface Ripple {
  x: number;
  y: number;
  radiusX: number; // 2:1, like the ground
  radiusY: number;
  growth: number; // how much wider a ring is when it fades than when it starts
  dashes: number; // breaks around a ring
  phase: number;
}

export interface DecorKind {
  key: string; // the sprite (assets.ts SINGLE) and its extents (decor-extents.ts, which `bun run decor` writes for it)
  where: Where;
  groups: readonly [min: number, max: number]; // how many groups of it: one temple, two or three clusters of olives
  pieces?: readonly [min: number, max: number]; // how many props in a group, one when left out
  // how a group's later pieces follow its first: `run` is the step from one to the next, along the ground; `cluster` is
  // how far a piece may stand from the first, in x and y
  arrange?: { run: Point } | { cluster: Point };
  margin?: number; // iso steps its base keeps from the plaza's rim; MARGIN when left out
  lampRing?: number; // ground px its base keeps from every lamp's foot; LAMP_RING when left out (a flame wants more)
  edges?: readonly Rim[]; // for "edge": the rims it may stand along
  chance?: number; // the odds that each of its groups is laid out at all (always, and tried hard, when left out)
  pool?: string; // a night draws at most POOL_LIMITS[pool] groups from the kinds that share a pool, in a random order
  slot?: "building"; // a building slot: a night's live building (decorFor's second argument) stands here instead
  replacedBy?: { key: string; chance: number }; // the odds that a group is this other sprite of the same kind of thing
  bobs?: boolean; // afloat: the scene rocks it on the water
  ripples?: readonly Ripple[]; // for the sea: rings round it, as offsets from its anchor
  bridge?: Point; // for the sea: the tip of its pier, as an offset from its anchor, from which planks lead to the plaza
}

// How many groups a night may draw from the kinds of each pool
const POOL_LIMITS: Readonly<Record<string, number>> = { small: 2 };

// Placed in this order, so what comes first has the pick of the plaza (the kinds of a pool, which follow one another, in a
// random order among themselves). Adding a kind is one entry here and its sprite. The odds and the counts are data too.
export const DECOR: readonly DecorKind[] = [
  { key: "zeus-statue", where: "centre", groups: [1, 1] },
  { key: "temple", where: "back", groups: [1, 1] },
  // the second house is sometimes the ochre one: a replacement, never an extra
  { key: "house", where: "back", groups: [1, 1], slot: "building", replacedBy: { key: "house-ochre", chance: 0.35 } },
  { key: "stall", where: "front", groups: [1, 1], chance: 0.85 },
  // one cluster of one or two trees
  { key: "olive", where: "anywhere", groups: [1, 1], pieces: [1, 2], arrange: { cluster: [70, 34] } },
  // at most one short run, and often none
  {
    key: "wall",
    where: "edge",
    groups: [1, 1],
    chance: 0.35,
    pieces: [1, 2],
    arrange: { run: [72, 36] },
    margin: 4,
    edges: ["back-right", "front-left"],
  },
  // the small decorations: a night draws at most two of these four, whichever the dice give first
  { key: "olive-young", where: "anywhere", groups: [1, 1], chance: 0.35, pool: "small" },
  {
    key: "amphora-stack",
    where: "edge",
    groups: [1, 1],
    chance: 0.35,
    pool: "small",
    edges: ["front-left", "back-right"],
  },
  { key: "broken-column", where: "anywhere", groups: [1, 1], chance: 0.35, pool: "small" },
  // it carries its own flame, so it stands on open flagstone, clear of the lamps' brightest light
  { key: "votive-altar", where: "anywhere", groups: [1, 1], chance: 0.35, pool: "small", lampRing: 70 },
  {
    key: "trireme",
    where: "shore-left",
    groups: [1, 1],
    bobs: true,
    ripples: [
      // the hull, its bow and the tips of its oars
      { x: 10, y: -3, radiusX: 40, radiusY: 12, growth: 0.25, dashes: 11, phase: 0 },
      { x: 40, y: 4, radiusX: 6, radiusY: 3, growth: 0.8, dashes: 3, phase: 4 },
      { x: -44, y: -10, radiusX: 4, radiusY: 2, growth: 0.8, dashes: 2, phase: 2 },
      { x: -35, y: -5, radiusX: 4, radiusY: 2, growth: 0.8, dashes: 2, phase: 7 },
      { x: -26, y: -1, radiusX: 4, radiusY: 2, growth: 0.8, dashes: 2, phase: 10 },
    ],
  },
  {
    key: "galley-dock",
    where: "shore-right",
    groups: [1, 1],
    bridge: [-48, -26],
    ripples: [
      // the galley at the dock and the dock's posts
      { x: 15, y: -10, radiusX: 22, radiusY: 8, growth: 0.35, dashes: 7, phase: 3 },
      { x: -49, y: -26, radiusX: 6, radiusY: 3, growth: 0.8, dashes: 2, phase: 1 },
      { x: -35, y: -12, radiusX: 6, radiusY: 3, growth: 0.8, dashes: 2, phase: 6 },
      { x: -21, y: -4, radiusX: 6, radiusY: 3, growth: 0.8, dashes: 2, phase: 9 },
      { x: -8, y: 5, radiusX: 6, radiusY: 3, growth: 0.8, dashes: 2, phase: 4 },
    ],
  },
];

// The sprites whose extents the placer reads from decor-extents.ts: the lamps it keeps clear of, every kind in DECOR and
// the kinds a group is sometimes replaced by. This is the set `bun run decor` measures (tools/decor-extents), so nothing
// else the scene draws (the monsters, the hero, the hand-written stand-ins for the buildings, which take their building's
// extents) is in the table. A live building's extents come in at run time (`LiveBuilding`) and are not in it either.
const LAMP_SPRITE = "lamp-lit";
export const PLACED_SPRITES: readonly string[] = [
  ...new Set([
    LAMP_SPRITE,
    ...DECOR.flatMap((kind) => (kind.replacedBy ? [kind.key, kind.replacedBy.key] : [kind.key])),
  ]),
];

// --- the rules --------------------------------------------------------------------------------------------------------

const MARGIN = 8; // iso steps a prop's base keeps from the plaza's rim
const SEA_GAP = 10; // iso steps a boat keeps from the stone and its walls
const LAMP_RING = 40; // ground px between a base and a lamp's foot: the warden relights from within 40 of it
const PLAY_GAP = 10; // ground px a base keeps from the lamps' pentagon: the warden's way between them and his start
const SPAWN_GAP = 26; // ground px a base keeps from where monsters come ashore
const PIECE_GAP = 6; // ground px between the pieces of a cluster
const PROP_GAP = 12; // ground px between two bases that are not the pieces of one run or cluster
const HEADROOM = 64; // px a prop in front of the lamps may rise into the ground they surround
const SIGHT_GAP = 4; // px a prop's whole sprite keeps from a lamp's lantern, and from its pole when it stands in front
const BODY_GAP = -14; // px the whole sprites of two props may overlap by
const EDGE_DEPTH = 100; // px in from a rim that a prop meant for the edge is looked for
const TRIES = 200; // spots tried for a group that may go unplaced
const TRIES_REQUIRED = 4000; // and for one that may not: a layout always has its temple, its house and its stall
const PIECE_TRIES = 16;

// the lamps' feet, and the ground they stand round: the pentagon the warden walks, a lamp to the next, and fights in
const LAMP_FEET: readonly Point[] = LAMP_SPOTS.map(toGround);
const LAMP_PENTAGON: Shape = groundShape(convexHull(LAMP_SPOTS), 0, 0);

// where a monster can come ashore: sim.ts spawn() puts it on this ellipse (decor.test.ts checks it against the sim)
const SPAWN_REACH = 0.9;
const SPAWN_SAMPLES = 96; // 23 ground px apart
export const SPAWN_POINTS: readonly Point[] = Array.from({ length: SPAWN_SAMPLES }, (_, index) => {
  const angle = (index / SPAWN_SAMPLES) * Math.PI * 2;
  return [
    CENTRE_X + Math.cos(angle) * PLAZA_HALF_WIDTH * SPAWN_REACH,
    CENTRE_Y + Math.sin(angle) * PLAZA_HALF_HEIGHT * SPAWN_REACH,
  ];
});
const SPAWN_GROUND = SPAWN_POINTS.map(toGround);
const FRONT_LAMP = Math.max(...LAMP_SPOTS.map(([, y]) => y));
const LAMPS_LEFT = Math.min(...LAMP_SPOTS.map(([x]) => x));
const LAMPS_RIGHT = Math.max(...LAMP_SPOTS.map(([x]) => x));
// where the warden starts (newNight in sim.ts) and the box he fills there
const WARDEN_START: Point = [CENTRE_X, CENTRE_Y + 62];
const WARDEN_IN_VIEW: Box = {
  left: CENTRE_X - 24,
  right: CENTRE_X + 24,
  top: WARDEN_START[1] - 72,
  bottom: WARDEN_START[1],
};

// each lamp as the scene draws it: its lantern, which glows, and its pole under it
const LANTERN_DEPTH = 40;
const POLE_HALF_WIDTH = 5;

function extentsOf(key: string): SpriteExtents {
  const extents = SPRITE_EXTENTS[key];
  if (!extents) {
    throw new Error(`no extents for the sprite ${key}: run bun run decor`);
  }
  return extents;
}

const LAMPS_DRAWN: readonly { lantern: Box; pole: Box }[] = LAMP_SPOTS.map(([x, y]) => {
  const lamp = boxAt(extentsOf(LAMP_SPRITE).sprite, x, y);
  return {
    lantern: { ...lamp, bottom: lamp.top + LANTERN_DEPTH },
    pole: { left: x - POLE_HALF_WIDTH, right: x + POLE_HALF_WIDTH, top: lamp.top + LANTERN_DEPTH, bottom: lamp.bottom },
  };
});

// The boards of a bridge from a pier's tip to the plaza: one every BOARD_STEP px along the way that goes straight to the
// stone, which on the ground is across the front rim and on the screen is up and to the left, two across for every one up.
// The last board lies against the rim's wall. Null when the pier's tip is too near the stone or too far from it to bridge.
const BOARD_STEP = 12;
const BOARD_RISE = 7; // up for every 14 across: the bridge's way, and what the iso steps to the stone fall by
const MIN_REACH = 1; // iso steps (of BOARD_RISE * 2 across) from the tip to the stone, least and most
const MAX_REACH = 12;
function bridgeBoards(tipX: number, tipY: number): Point[] | null {
  const reach = shoreDistance(tipX, tipY) / (BOARD_RISE * 2);
  if (reach < MIN_REACH || reach > MAX_REACH) {
    return null;
  }
  const end = reach - 0.2;
  const count = Math.max(2, Math.round((end * BOARD_RISE * 2) / BOARD_STEP) + 1);
  return Array.from({ length: count }, (_, index): Point => {
    const along = (end * index) / (count - 1);
    return [Math.round(tipX - BOARD_RISE * 2 * along), Math.round(tipY - BOARD_RISE * along)];
  });
}

// --- the layout ---------------------------------------------------------------------------------------------------------

export interface Placed {
  key: string;
  x: number; // where its base touches the ground (its sprite's anchor)
  y: number;
}
export interface Layout {
  props: Placed[]; // standing on the plaza or moored by it, depth-sorted by the scene with everything else
  boats: Placed[]; // afloat, rocked by the scene
  ripples: Ripple[]; // rings on the water, in canvas pixels
  planks: Point[]; // the centre of each board of a pier's bridge, in canvas pixels, from the dock to the plaza's rim
}

// a stream of numbers for decor alone: the night's seed, run through the generator once and salted, so it is neither the
// sim's stream nor a shifted copy of it
const DECOR_SALT = 0x4c616d70; // "Lamp"
function decorStream(seed: number): () => number {
  let state = nextRandom((seed ^ DECOR_SALT) | 0).seed;
  return () => {
    const draw = nextRandom(state);
    state = draw.seed;
    return draw.value;
  };
}

interface Standing {
  base: Shape; // the opaque base, on the ground
  body: Box; // the whole sprite, on the screen
  group: number; // what a prop may touch: the others of its group
}

// Why a land prop's base may not stand where it is: too near a lamp's foot, a spawn point or the play area; or null.
function groundRejection(kind: DecorKind, base: Shape): string | null {
  if (LAMP_FEET.some((foot) => nearPoint(base, foot, kind.lampRing ?? LAMP_RING))) {
    return "lamp";
  }
  if (SPAWN_GROUND.some((spawn) => nearPoint(base, spawn, SPAWN_GAP))) {
    return "spawn";
  }
  return nearShape(base, LAMP_PENTAGON, PLAY_GAP) ? "play" : null;
}

// Why a land prop's body, its anchor's y at `y`, would stand in the way of what has to be seen, or null.
function sightRejection(body: Box, y: number): string | null {
  // a lantern is not what a prop is seen behind, and a prop in front of a lamp is drawn over its pole
  for (const [index, lamp] of LAMPS_DRAWN.entries()) {
    if (boxesNear(body, lamp.lantern, SIGHT_GAP)) {
      return "lantern";
    }
    if (y >= (LAMP_SPOTS[index]?.[1] ?? 0) && boxesNear(body, lamp.pole, SIGHT_GAP)) {
      return "pole";
    }
  }
  // what stands in front of the lamps stays low, and leaves the warden in view where he starts
  if (y > FRONT_LAMP && body.right > LAMPS_LEFT && body.left < LAMPS_RIGHT && body.top < FRONT_LAMP - HEADROOM) {
    return "play";
  }
  if (y > WARDEN_START[1] && boxesNear(body, WARDEN_IN_VIEW, 0)) {
    return "warden";
  }
  return null;
}

class Placement {
  readonly layout: Layout = { props: [], boats: [], ripples: [], planks: [] };
  private readonly standing: Standing[] = [];
  private readonly random: () => number;
  private groups = 0;
  private readonly drawn = new Map<string, number>(); // groups laid out so far, by pool
  private readonly live: LiveBuilding | null;
  constructor(seed: number, live: LiveBuilding | null) {
    this.live = live;
    this.random = decorStream(seed);
  }

  // the extents of a sprite: the live building's, passed in, or the committed table's
  private extents(key: string): SpriteExtents {
    return this.live && this.live.key === key ? this.live.extents : extentsOf(key);
  }

  // the pooled kinds that follow one another, in a random order
  shuffled(kinds: readonly DecorKind[]): DecorKind[] {
    const order = [...kinds];
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(this.random() * (index + 1));
      const kept = order[index];
      const swapped = order[other];
      if (kept && swapped) {
        order[index] = swapped;
        order[other] = kept;
      }
    }
    return order;
  }

  private between(least: number, most: number) {
    return least + this.random() * (most - least);
  }
  private count(range: readonly [number, number]) {
    return range[0] + Math.floor(this.random() * (range[1] - range[0] + 1));
  }

  // Why a land prop may not stand with its anchor at (x, y) as a piece of group `group`, or null when it may.
  rejection(kind: DecorKind, x: number, y: number, group: number): string | null {
    const { hull, solid, sprite } = this.extents(kind.key);
    if (hull.some(([hullX, hullY]) => plazaInset(x + hullX, y + hullY) < (kind.margin ?? MARGIN))) {
      return "rim";
    }
    const base = groundShape(solid, x, y);
    const body = boxAt(sprite, x, y);
    return groundRejection(kind, base) ?? sightRejection(body, y) ?? this.crowdRejection(kind, base, body, group);
  }

  // Why a prop would crowd one already standing (`group` is the arrangement it is a piece of), or null when it would not.
  private crowdRejection(kind: DecorKind, base: Shape, body: Box, group: number): string | null {
    const clustered = kind.arrange !== undefined && "cluster" in kind.arrange;
    for (const other of this.standing) {
      if (other.group === group) {
        // the pieces of a run stand end to end, but those of a cluster keep a little ground apart
        if (clustered && nearShape(base, other.base, PIECE_GAP)) {
          return "piece";
        }
        continue;
      }
      if (nearShape(base, other.base, PROP_GAP)) {
        return "prop";
      }
      if (boxesNear(body, other.body, BODY_GAP)) {
        return "body";
      }
    }
    return null;
  }

  // whether a boat may lie with its anchor at (x, y): on the sea, off the stone and its walls, on the canvas and, when it
  // has a pier, near enough to the stone to bridge
  private seaworthy(kind: DecorKind, x: number, y: number): boolean {
    const { hull, solid, sprite } = this.extents(kind.key);
    if (kind.bridge && !bridgeBoards(x + kind.bridge[0], y + kind.bridge[1])) {
      return false;
    }
    if (hull.some(([hullX, hullY]) => shoreDistance(x + hullX, y + hullY) < SEA_GAP)) {
      return false;
    }
    const whole = boxAt(sprite, x, y);
    if (whole.left < 0 || whole.right > STAGE_WIDTH || whole.bottom > STAGE_HEIGHT) {
      return false;
    }
    const base = groundShape(solid, x, y);
    return this.standing.every((other) => !nearShape(base, other.base, PROP_GAP));
  }

  // a spot to try for the first piece of a group of `kind`, as the kind's zone has it
  private spot(kind: DecorKind, group: number): Point {
    switch (kind.where) {
      case "centre":
        return [CENTRE_X, CENTRE_Y + 14];
      case "back":
        return [this.between(CENTRE_X - 300, CENTRE_X + 300), this.between(CENTRE_Y - 130, CENTRE_Y - 10)];
      case "front":
        return [this.between(CENTRE_X - 170, CENTRE_X + 170), this.between(CENTRE_Y + 60, CENTRE_Y + 170)];
      case "anywhere":
        return [this.between(CENTRE_X - 340, CENTRE_X + 340), this.between(CENTRE_Y - 170, CENTRE_Y + 170)];
      case "edge": {
        // a point on one of the rims, then in from it a step at a time to the first place the prop fits
        const rims = kind.edges ?? [];
        const rim = rims[Math.floor(this.random() * rims.length)] ?? "back-right";
        const along = this.between(0.1, 0.9);
        const [rimX, rimY, inwards]: [number, number, number] =
          rim === "back-right"
            ? [CENTRE_X + PLAZA_HALF_WIDTH * along, CENTRE_Y - PLAZA_HALF_HEIGHT + PLAZA_HALF_HEIGHT * along, 1]
            : [CENTRE_X - PLAZA_HALF_WIDTH + PLAZA_HALF_WIDTH * along, CENTRE_Y + PLAZA_HALF_HEIGHT * along, -1];
        for (let depth = 0; depth <= EDGE_DEPTH; depth += 4) {
          if (this.rejection(kind, Math.round(rimX), Math.round(rimY + inwards * depth), group) === null) {
            return [rimX, rimY + inwards * depth];
          }
        }
        return [rimX, rimY];
      }
      case "shore-left": {
        const x = this.between(100, 300);
        return [x, 440 + (x - 130) / 2 + this.between(0, 18)];
      }
      case "shore-right": {
        const x = this.between(740, 850);
        return [x, 432 + (825 - x) / 2 + this.between(0, 18)];
      }
    }
  }

  private fits(kind: DecorKind, x: number, y: number, group: number): boolean {
    if (kind.where === "centre") {
      return true;
    }
    if (kind.where === "shore-left" || kind.where === "shore-right") {
      return this.seaworthy(kind, x, y);
    }
    return this.rejection(kind, x, y, group) === null;
  }

  private stand(kind: DecorKind, x: number, y: number, group: number) {
    const placed: Placed = { key: kind.key, x, y };
    (kind.bobs ? this.layout.boats : this.layout.props).push(placed);
    const { solid, sprite } = this.extents(kind.key);
    this.standing.push({ base: groundShape(solid, x, y), body: boxAt(sprite, x, y), group });
    for (const ripple of kind.ripples ?? []) {
      this.layout.ripples.push({ ...ripple, x: x + ripple.x, y: y + ripple.y });
    }
    if (kind.bridge) {
      this.layout.planks.push(...(bridgeBoards(x + kind.bridge[0], y + kind.bridge[1]) ?? []));
    }
  }

  // the first spot where a group of `kind` fits, in at most `tries` tries, or null
  private search(kind: DecorKind, group: number, tries: number): Point | null {
    for (let attempt = 0; attempt < tries; attempt++) {
      const [spotX, spotY] = this.spot(kind, group);
      const [x, y] = [Math.round(spotX), Math.round(spotY)];
      if (this.fits(kind, x, y, group)) {
        return [x, y];
      }
    }
    return null;
  }

  place(listed: DecorKind) {
    const required = listed.chance === undefined ? listed.groups[0] : 0;
    for (let wanted = this.count(listed.groups), left = required; wanted > 0; wanted--, left--) {
      if (listed.chance !== undefined && this.random() >= listed.chance) {
        continue;
      }
      if (!this.poolFull(listed)) {
        this.placeGroup(listed, left > 0);
      }
    }
  }

  // whether the pool a kind draws from has given all the groups it may tonight
  private poolFull(listed: DecorKind): boolean {
    if (listed.pool === undefined) {
      return false;
    }
    const limit = POOL_LIMITS[listed.pool];
    return limit !== undefined && (this.drawn.get(listed.pool) ?? 0) >= limit;
  }

  // The kinds a group of `listed` may be, in the order they are tried. A group is sometimes the listed sprite's
  // replacement; a live building takes the building slot from the committed sprite, which stands after all when the live
  // one fits nowhere tonight.
  private candidatesFor(listed: DecorKind): { committed: DecorKind; candidates: DecorKind[] } {
    const replaced = listed.replacedBy && this.random() < listed.replacedBy.chance ? listed.replacedBy.key : listed.key;
    const committed = replaced === listed.key ? listed : { ...listed, key: replaced };
    const candidates =
      this.live && listed.slot === "building" ? [{ ...listed, key: this.live.key }, committed] : [committed];
    return { committed, candidates };
  }

  // One group of `listed`: the first of its candidates that fits somewhere, then the rest of its arrangement. A group the
  // night requires gets more tries for its committed sprite.
  private placeGroup(listed: DecorKind, required: boolean) {
    const { committed, candidates } = this.candidatesFor(listed);
    const group = this.groups++;
    for (const kind of candidates) {
      const first = this.search(kind, group, kind === committed && required ? TRIES_REQUIRED : TRIES);
      if (first) {
        if (listed.pool !== undefined) {
          this.drawn.set(listed.pool, (this.drawn.get(listed.pool) ?? 0) + 1);
        }
        this.stand(kind, first[0], first[1], group);
        this.arrangePieces(kind, first, group);
        return;
      }
    }
  }

  // the pieces after the first: end to end along a run, or each somewhere in a cluster around the first
  private arrangePieces(kind: DecorKind, first: Point, group: number) {
    const arrange = kind.arrange;
    for (let piece = 1, pieces = this.count(kind.pieces ?? [1, 1]); piece < pieces && arrange; piece++) {
      if (!("run" in arrange)) {
        this.standClusterPiece(kind, first, arrange.cluster, group);
        continue;
      }
      const x = first[0] + arrange.run[0] * piece;
      const y = first[1] + arrange.run[1] * piece;
      if (!this.fits(kind, x, y, group)) {
        break;
      }
      this.stand(kind, x, y, group);
    }
  }

  private standClusterPiece(kind: DecorKind, first: Point, spread: readonly [number, number], group: number) {
    for (let attempt = 0; attempt < PIECE_TRIES; attempt++) {
      const x = Math.round(first[0] + this.between(-spread[0], spread[0]));
      const y = Math.round(first[1] + this.between(-spread[1], spread[1]));
      if (this.fits(kind, x, y, group)) {
        this.stand(kind, x, y, group);
        return;
      }
    }
  }
}

// A building from outside the committed set (a live gallery's), to stand in the building slot for a night: its sprite key
// (the scene draws that key's texture, at that key's anchor) and the extents of its pixels, measured by measureSprite.
export interface LiveBuilding {
  key: string;
  extents: SpriteExtents;
}

// The decorations of the night that starts from `seed`: the same layout every time, whoever asks. `live`, when there is
// one, takes the building slot instead of the committed house.
export function decorFor(seed: number, live: LiveBuilding | null = null): Layout {
  const placement = new Placement(seed, live);
  for (let index = 0; index < DECOR.length; ) {
    const pool = DECOR[index]?.pool;
    let end = index + 1;
    while (pool !== undefined && DECOR[end]?.pool === pool) {
      end++;
    }
    const run = DECOR.slice(index, end);
    for (const kind of pool === undefined ? run : placement.shuffled(run)) {
      placement.place(kind);
    }
    index = end;
  }
  return placement.layout;
}
