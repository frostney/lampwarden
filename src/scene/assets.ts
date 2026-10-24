// Sprite list for the scene. The pipeline renders the hero frames from these counts (pipeline/hero-animation.ts).
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];
export const HERO_ANIMATIONS = ["idle", "walk", "melee", "ranged"] as const;
export type HeroAnimation = (typeof HERO_ANIMATIONS)[number];

export const FRAMES: Record<HeroAnimation, number> = { idle: 4, walk: 6, melee: 5, ranged: 5 };
export const FRAMES_PER_SECOND: Record<HeroAnimation, number> = { idle: 6, walk: 10, melee: 14, ranged: 12 };

// The warden faces eight ways on the ground, by octant: 0 is east and each step turns 45 degrees clockwise on the screen
// (south is straight down it). The ground is foreshortened 2:1 on the screen, so these are the ground's compass points,
// measured with the screen's y doubled, as the swing's arc is.
export const DIRECTIONS = ["e", "se", "s", "sw", "w", "nw", "n", "ne"] as const;
type Direction = (typeof DIRECTIONS)[number];
// Five are drawn; the other three are those mirrored left to right (a sprite's mirror image looks the opposite way).
export const DRAWN_DIRECTIONS = ["e", "se", "s", "ne", "n"] as const;
export type DrawnDirection = (typeof DRAWN_DIRECTIONS)[number];
const DRAWN_AS: Record<Direction, DrawnDirection> = {
  e: "e",
  se: "se",
  s: "s",
  sw: "se",
  w: "e",
  nw: "ne",
  n: "n",
  ne: "ne",
};
const OCTANTS = DIRECTIONS.length;

// unit vectors along the ground for each octant (the diagonals are exactly 45 degrees, in the ground's own space)
const DIAGONAL = Math.SQRT1_2;
const OCTANT_VECTORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [DIAGONAL, DIAGONAL],
  [0, 1],
  [-DIAGONAL, DIAGONAL],
  [-1, 0],
  [-DIAGONAL, -DIAGONAL],
  [0, -1],
  [DIAGONAL, -DIAGONAL],
];
const OCTANT_ANGLE = Math.PI / 4;
const wrapOctant = (octant: number) => ((octant % OCTANTS) + OCTANTS) % OCTANTS;
// the unit vector along the ground an octant faces
export const octantVector = (octant: number): readonly [number, number] => OCTANT_VECTORS[wrapOctant(octant)] ?? [0, 1];
// the octant a heading on the ground (x, and y as the ground has it, at twice the screen's) falls in
export const octantOf = (groundX: number, groundY: number) =>
  wrapOctant(Math.round(Math.atan2(groundY, groundX) / OCTANT_ANGLE));
// how far a heading is from the middle of an octant, in radians (at most half an octant when it is the nearest)
export function offsetFromOctant(groundX: number, groundY: number, octant: number) {
  const turn = Math.atan2(groundY, groundX) - octant * OCTANT_ANGLE;
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
}

// which of the drawn frames shows an octant, and whether it is shown mirrored
export function heroView(octant: number): { drawn: DrawnDirection; mirrored: boolean } {
  const direction = DIRECTIONS[wrapOctant(octant)] ?? "s";
  const drawn = DRAWN_AS[direction];
  return { drawn, mirrored: drawn !== direction };
}

const SINGLE = [
  "satyr",
  "cyclops",
  "harpy",
  "zeus-statue",
  "olive",
  "galley-dock",
  "trireme",
  "temple",
  "house",
  "lamp-lit",
  "lamp-unlit",
  "wall",
  "stall",
] as const;
export type SingleKey = (typeof SINGLE)[number];

// Anchor y (fraction of the 128px frame) where each sprite's feet / base touch the ground.
export const ANCHOR_Y: Record<SingleKey | "hero", number> = {
  satyr: 0.8,
  cyclops: 0.82,
  harpy: 0.8,
  "zeus-statue": 0.94,
  olive: 0.86,
  "galley-dock": 0.92,
  trireme: 0.9,
  temple: 0.93,
  house: 0.91,
  "lamp-lit": 0.82,
  "lamp-unlit": 0.82,
  wall: 0.93,
  stall: 0.88,
  hero: 0.82,
};

// the anchor for any sprite key; hero frames and unknown keys fall back to sensible defaults
export function anchorYFor(key: string): number {
  if (key.startsWith("hero/")) return ANCHOR_Y.hero;
  for (const [name, anchorY] of Object.entries(ANCHOR_Y)) if (name === key) return anchorY;
  return 0.85;
}

// the key (and file name, under /sprites/) of one frame of a warden's animation, seen from one of the drawn directions
export function heroKey(sex: Sex, animation: HeroAnimation, frame: number, direction: DrawnDirection) {
  return `hero/${sex}_${animation}${frame + 1}_${direction}`;
}

export function assetList(): { alias: string; src: string; data: { scaleMode: "nearest" } }[] {
  const list: { alias: string; src: string; data: { scaleMode: "nearest" } }[] = [];
  for (const key of SINGLE) list.push({ alias: key, src: `/sprites/${key}.png`, data: { scaleMode: "nearest" } });
  for (const sex of SEXES)
    for (const animation of HERO_ANIMATIONS)
      for (let frame = 0; frame < FRAMES[animation]; frame++)
        for (const direction of DRAWN_DIRECTIONS) {
          const alias = heroKey(sex, animation, frame, direction);
          list.push({ alias, src: `/sprites/${alias}.png`, data: { scaleMode: "nearest" } });
        }
  return list;
}
