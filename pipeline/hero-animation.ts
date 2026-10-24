// The hero's animation frames: which weapons each sex carries and the plain 128 px build script for every frame
// (noScale, facing 20). Frame counts come from the game itself, so the pipeline renders exactly the frames it loads.
import { FRAMES, type HeroAnimation, type Sex } from "../src/scene/assets";

export const HERO_WEAPONS: Record<Sex, { melee: string; ranged: string }> = {
  male: { melee: "xiphos", ranged: "bow" },
  female: { melee: "spear", ranged: "sling" },
};

export interface FrameBuild {
  name: string;
  code: string;
}

export function heroFrameBuilds(sex: Sex, animation: HeroAnimation): FrameBuild[] {
  const weapons = HERO_WEAPONS[sex];
  return Array.from({ length: FRAMES[animation] }, (_, index) => {
    const frameNumber = index + 1;
    const pose = `${animation}${frameNumber}`;
    const options = [sex, weapons.melee, weapons.ranged, pose].map((value) => JSON.stringify(value));
    return {
      name: `${sex}_${pose}`,
      code: `function build(k) {\n k.noScale = true;\n hero(k, {sex:${options[0]}, melee:${options[1]}, ranged:${options[2]}, pose:${options[3]}, at:[0,0], facing:20});\n}\n`,
    };
  });
}
