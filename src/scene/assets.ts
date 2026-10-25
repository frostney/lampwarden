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

// The sprites the scene cannot do without: loading them fails the whole load. The hand-written building sprites are
// here, as the stand-ins for the scenery below.
const SINGLE = [
  "satyr",
  "cyclops",
  "harpy",
  "zeus-statue",
  "olive",
  "galley-dock",
  "trireme",
  "lamp-lit",
  "lamp-unlit",
  "temple-handwritten",
  "house-handwritten",
  "wall-handwritten",
  "stall-handwritten",
] as const;
type SingleKey = (typeof SINGLE)[number];

// The scenery: the buildings and decorations a model drew through Mubit (the manifest's rows with source "mubit"). They
// load one by one, and one that fails to load is only missing: a building is drawn from its hand-written sprite instead
// (`sceneryKeyFor`) and a decoration draws nothing.
const SCENERY = [
  "temple",
  "house",
  "wall",
  "stall",
  "house-ochre",
  "olive-young",
  "broken-column",
  "votive-altar",
  "amphora-stack",
] as const;
export type SceneryKey = (typeof SCENERY)[number];

// the buildings that have a hand-written sprite to fall back on, drawn from the same kit builder with the same look
const HANDWRITTEN_BUILDINGS = ["temple", "house", "wall", "stall"] as const;
const handwrittenKey = (building: (typeof HANDWRITTEN_BUILDINGS)[number]) => `${building}-handwritten` as const;
function isHandwrittenBuilding(key: string): key is (typeof HANDWRITTEN_BUILDINGS)[number] {
  return HANDWRITTEN_BUILDINGS.some((building) => building === key);
}
// the key whose texture draws a scenery sprite: its own, or for a building that did not load its hand-written one
export function sceneryKeyFor(key: string, loaded: (key: string) => boolean): string {
  return loaded(key) || !isHandwrittenBuilding(key) ? key : handwrittenKey(key);
}

// Anchor y (fraction of the 128px frame) where each sprite's feet / base touch the ground. The scenery's are measured
// from the committed PNG's lowest opaque row (`anchorYFromBbox`, the rule the live creatures use), and a test holds
// them to it; the other sprites' are tuned by eye.
export const ANCHOR_Y: Record<SingleKey | SceneryKey | "hero", number> = {
  satyr: 0.8,
  cyclops: 0.82,
  harpy: 0.8,
  "zeus-statue": 0.94,
  olive: 0.86,
  "galley-dock": 0.92,
  trireme: 0.9,
  "lamp-lit": 0.82,
  "lamp-unlit": 0.82,
  "temple-handwritten": 0.95,
  "house-handwritten": 0.92,
  "wall-handwritten": 0.95,
  "stall-handwritten": 0.88,
  temple: 0.95,
  house: 0.92,
  wall: 0.95,
  stall: 0.88,
  "house-ochre": 0.92,
  "olive-young": 0.81,
  "broken-column": 0.87,
  "votive-altar": 0.9,
  "amphora-stack": 0.89,
  hero: 0.82,
};

// the anchor for any sprite key; hero frames and unknown keys fall back to sensible defaults
export function anchorYFor(key: string): number {
  if (key.startsWith("hero/")) {
    return ANCHOR_Y.hero;
  }
  for (const [name, anchorY] of Object.entries(ANCHOR_Y)) {
    if (name === key) {
      return anchorY;
    }
  }
  return 0.85;
}

// the key of one frame of a warden's animation, seen from one of the drawn directions
export function heroKey(sex: Sex, animation: HeroAnimation, frame: number, direction: DrawnDirection) {
  return `hero/${sex}_${animation}${frame + 1}_${direction}`;
}

// A warden's frames come as one picture, an atlas of 128 px cells: a column for each drawn direction and a row for each
// frame of each animation in turn (idle, walk, melee, ranged), so the game asks for two files and not two hundred.
// pipeline/hero-frames.ts paints it from the kit; the scene cuts it into one texture per frame when it loads.
export const HERO_FRAME_SIZE = 128;
export const heroAtlasPath = (sex: Sex) => `/sprites/hero/${sex}.png`;
export const heroAtlasKey = (sex: Sex) => `hero-atlas/${sex}`;
export const HERO_ATLAS_SIZE = {
  width: DRAWN_DIRECTIONS.length * HERO_FRAME_SIZE,
  height: HERO_ANIMATIONS.reduce((total, animation) => total + FRAMES[animation], 0) * HERO_FRAME_SIZE,
};
// where a frame's cell is in the atlas, in pixels
export function heroAtlasCell(animation: HeroAnimation, frame: number, direction: DrawnDirection) {
  let row = frame;
  for (const earlier of HERO_ANIMATIONS) {
    if (earlier === animation) {
      break;
    }
    row += FRAMES[earlier];
  }
  return { x: DRAWN_DIRECTIONS.indexOf(direction) * HERO_FRAME_SIZE, y: row * HERO_FRAME_SIZE };
}
// every frame of a sex with its key and its cell
export function heroFrames(sex: Sex) {
  return HERO_ANIMATIONS.flatMap((animation) =>
    Array.from({ length: FRAMES[animation] }, (_, frame) =>
      DRAWN_DIRECTIONS.map((direction) => ({
        key: heroKey(sex, animation, frame, direction),
        ...heroAtlasCell(animation, frame, direction),
      })),
    ).flat(),
  );
}

export function assetList(): { alias: string; src: string; data: { scaleMode: "nearest" } }[] {
  const list: { alias: string; src: string; data: { scaleMode: "nearest" } }[] = [];
  for (const key of SINGLE) {
    list.push({ alias: key, src: `/sprites/${key}.png`, data: { scaleMode: "nearest" } });
  }
  for (const sex of SEXES) {
    list.push({ alias: heroAtlasKey(sex), src: heroAtlasPath(sex), data: { scaleMode: "nearest" } });
  }
  return list;
}

// the scenery's files, to load one at a time (see SCENERY)
export function sceneryAssetList(): { alias: string; src: string; data: { scaleMode: "nearest" } }[] {
  return SCENERY.map((key) => ({ alias: key, src: `/sprites/${key}.png`, data: { scaleMode: "nearest" } }));
}
