// Sprite list for the scene. Frame counts match pipeline/shotcup_main.py (FRAMES).
export type Sex = "male" | "female";
export type Anim = "idle" | "walk" | "melee" | "ranged";

export const FRAMES: Record<Anim, number> = { idle: 4, walk: 6, melee: 5, ranged: 5 };
export const FPS: Record<Anim, number> = { idle: 6, walk: 10, melee: 14, ranged: 12 };

export const SINGLE = ["satyr", "cyclops", "harpy", "zeus-statue", "olive", "galley-dock", "trireme", "temple", "house", "lamp-lit", "lamp-unlit"] as const;
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
  temple: 0.9,
  house: 0.88,
  "lamp-lit": 0.88,
  "lamp-unlit": 0.88,
  hero: 0.82,
};

export function heroKey(sex: Sex, anim: Anim, frame: number) {
  return `hero/${sex}_${anim}${frame + 1}`;
}

export function assetList(): { alias: string; src: string; data: { scaleMode: "nearest" } }[] {
  const list: { alias: string; src: string; data: { scaleMode: "nearest" } }[] = [];
  for (const k of SINGLE) list.push({ alias: k, src: `/sprites/${k}.png`, data: { scaleMode: "nearest" } });
  for (const sex of ["male", "female"] as Sex[])
    for (const anim of Object.keys(FRAMES) as Anim[])
      for (let i = 0; i < FRAMES[anim]; i++) {
        const alias = heroKey(sex, anim, i);
        list.push({ alias, src: `/sprites/${alias}.png`, data: { scaleMode: "nearest" } });
      }
  return list;
}
