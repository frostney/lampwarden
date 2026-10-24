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
}

// The kit's `facing` for a direction, in degrees: 0 faces +u (screen down-right, the ground's south-east), 90 faces +v
// (down-left), so east, 45 degrees counter-clockwise of south-east, is -45. A direction turns facing by 45 degrees a step
// and south-east is the second of them.
export const kitFacing = (direction: DrawnDirection) => (DIRECTIONS.indexOf(direction) - 1) * 45;

export function heroFrameBuilds(sex: Sex, animation: HeroAnimation): FrameBuild[] {
  const weapons = HERO_WEAPONS[sex];
  return Array.from({ length: FRAMES[animation] }, (_, index) => {
    const pose = `${animation}${index + 1}`;
    return DRAWN_DIRECTIONS.map((direction) => {
      const options = [sex, weapons.melee, weapons.ranged, pose].map((value) => JSON.stringify(value));
      return {
        name: `${sex}_${pose}_${direction}`,
        code: `function build(k) {\n k.noScale = true;\n hero(k, {sex:${options[0]}, melee:${options[1]}, ranged:${options[2]}, pose:${options[3]}, at:[0,0], facing:${kitFacing(direction)}});\n}\n`,
      };
    });
  }).flat();
}
