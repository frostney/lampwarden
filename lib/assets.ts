// Sprite list for the scene. Frame counts match pipeline/shotcup_main.py (FRAMES).
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];
export const HERO_ANIMATIONS = ["idle", "walk", "melee", "ranged"] as const;
export type HeroAnimation = (typeof HERO_ANIMATIONS)[number];

export const FRAMES: Record<HeroAnimation, number> = { idle: 4, walk: 6, melee: 5, ranged: 5 };
export const FRAMES_PER_SECOND: Record<HeroAnimation, number> = { idle: 6, walk: 10, melee: 14, ranged: 12 };

export const SINGLE = [
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

export function heroKey(sex: Sex, animation: HeroAnimation, frame: number) {
  return `hero/${sex}_${animation}${frame + 1}`;
}

export function assetList(): { alias: string; src: string; data: { scaleMode: "nearest" } }[] {
  const list: { alias: string; src: string; data: { scaleMode: "nearest" } }[] = [];
  for (const key of SINGLE) list.push({ alias: key, src: `/sprites/${key}.png`, data: { scaleMode: "nearest" } });
  for (const sex of SEXES)
    for (const animation of HERO_ANIMATIONS)
      for (let frame = 0; frame < FRAMES[animation]; frame++) {
        const alias = heroKey(sex, animation, frame);
        list.push({ alias, src: `/sprites/${alias}.png`, data: { scaleMode: "nearest" } });
      }
  return list;
}
