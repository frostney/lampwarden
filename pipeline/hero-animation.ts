// The hero's animation frames: which weapons each sex carries and the plain 128 px build script for every frame seen from
// each of the five drawn directions (noScale; the other three are mirrors, see src/scene/assets.ts). Frame counts and
// directions come from the game itself, so the pipeline renders exactly the frames it loads.
import {
  DIRECTIONS,
  DRAWN_DIRECTIONS,
  type DrawnDirection,
  FRAMES,
  type HeroAnimation,
  type Sex,
} from "../src/scene/assets";

export const HERO_WEAPONS: Record<Sex, { melee: string; ranged: string }> = {
  male: { melee: "xiphos", ranged: "bow" },
  female: { melee: "spear", ranged: "sling" },
};

export interface FrameBuild {
  name: string;
  code: string;
  /** The pose the renderer gives the code as `POSE`; the deterministic builds carry theirs in the code and leave it empty. */
  pose: string;
}

// The kit's `facing` for a direction, in degrees: 0 faces +u (screen down-right, the ground's south-east), 90 faces +v
// (down-left), so east, 45 degrees counter-clockwise of south-east, is -45. A direction turns facing by 45 degrees a step
// and south-east is the second of them.
const FACING_STEP = 45; // degrees
export const kitFacing = (direction: DrawnDirection) => (DIRECTIONS.indexOf(direction) - 1) * FACING_STEP;

/** The name of one frame's build, as the scene's keys have it (`male_walk3_se`; the scene prefixes `hero/`). */
export const heroFrameName = (sex: Sex, animation: HeroAnimation, index: number, direction: DrawnDirection) =>
  `${sex}_${animation}${index + 1}_${direction}`;

export function heroFrameBuilds(sex: Sex, animation: HeroAnimation): FrameBuild[] {
  const weapons = HERO_WEAPONS[sex];
  return Array.from({ length: FRAMES[animation] }, (_, index) => {
    const pose = `${animation}${index + 1}`;
    return DRAWN_DIRECTIONS.map((direction) => {
      const options = [sex, weapons.melee, weapons.ranged, pose].map((value) => JSON.stringify(value));
      return {
        name: heroFrameName(sex, animation, index, direction),
        pose: "",
        code: `function build(k) {\n k.noScale = true;\n hero(k, {sex:${options[0]}, melee:${options[1]}, ranged:${options[2]}, pose:${options[3]}, at:[0,0], facing:${kitFacing(direction)}});\n}\n`,
      };
    });
  }).flat();
}
