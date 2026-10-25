// The warden as model-written code. For each sex Mubit writes one `build(k)` that calls the kit's `hero` builder (the
// same builder and pose system the deterministic atlas in hero-animation.ts uses). The game draws the warden from five
// directions and 20 frames each, so the code reads two globals the renderer provides: `POSE` (idle1, walk3, melee2 ...)
// and `FACING` (the kit's facing for the drawn direction, in degrees; the frame builder below defines it). One piece of
// code then draws every frame, and `bun run assets:hero` renders them all, from the committed code, in one sandbox batch.
//
// Everything here is pure: the briefs, the wrapper that turns the model's code into the script for one frame, the static
// checks on the code, and the checks that refuse an atlas. The loop that talks to Mubit is hero-loop.ts.
import {
  DRAWN_DIRECTIONS,
  type DrawnDirection,
  FRAMES,
  HERO_ANIMATIONS,
  HERO_FRAME_SIZE,
  type Sex,
} from "../src/scene/assets";
import type { PixelImage } from "../tools/logo/image";
import { decodePng } from "../tools/logo/png";
import { type FrameBuild, HERO_WEAPONS, heroFrameName, kitFacing } from "./hero-animation";
import { packHeroAtlas } from "./hero-atlas";
import type { RenderResult } from "./render-types";

/** Who each warden is, as the generator's user message. The system prompt stays the fixed generator.md. */
const PRONOUNS: Record<Sex, { possessive: string; object: string; reflexive: string }> = {
  male: { possessive: "his", object: "him", reflexive: "himself" },
  female: { possessive: "her", object: "her", reflexive: "herself" },
};

const WARDEN_BRIEFS: Record<Sex, string> = {
  male: "the son, a young Greek warden of a harbour town who keeps its lamps lit through the night, fighting with a xiphos in melee and a bow at range",
  female:
    "the daughter, a young Greek warden of a harbour town who keeps its lamps lit through the night, fighting with a spear in melee and a sling at range",
};

/**
 * The brief for a sex. It says who the warden is and how the code must be shaped; `generator.md` documents the builder
 * and `POSE`, and `FACING` is documented here only because the prompt cannot change (it must stay byte-identical so the
 * calls stay in one Mubit task).
 */
export function heroBrief(sex: Sex): string {
  const weapons = HERO_WEAPONS[sex];
  const pronouns = PRONOUNS[sex];
  return (
    `The player's warden, ${WARDEN_BRIEFS[sex]}. Greek and heroic, with a readable silhouette that stands out against a dark night: ` +
    `distinct bronze, linen and accent colours, so ${pronouns.possessive} armour, cloth and cape do not melt into one colour. ` +
    `Write one call: hero(k, { sex: '${sex}', melee: '${weapons.melee}', ranged: '${weapons.ranged}', pose: POSE || 'idle', facing: FACING, ...}). ` +
    `The game draws the warden in 20 poses (idle, walk, melee, ranged) from five directions with this same code, so ` +
    `FACING is a global number, in degrees, that the renderer gives your code for each direction: write facing: FACING exactly and ` +
    `never a fixed number. Never pass at, height, build or ready (the game sets them), and call no raw shapes (k.sphere, k.capsule and the ` +
    `others): they would not turn with ${pronouns.object}. Choose only what makes ${pronouns.object} look like ${pronouns.reflexive}: helmet ('none'|'corinthian'|'attic'), cape, ` +
    `and palette {cloth, accent, hair, skin, metal} with material names from the list.`
  );
}

/** A frame the verifier is shown for each candidate: the warden at ease, mid-stride, in the melee strike and drawing the ranged weapon. */
export interface RepresentativeFrame {
  animation: (typeof HERO_ANIMATIONS)[number];
  /** 1-based, as in the pose name. */
  frame: number;
  direction: DrawnDirection;
  /** What the verifier is told it is looking at, after the brief. */
  note: string;
}

export const REPRESENTATIVE_FRAMES = (sex: Sex): readonly RepresentativeFrame[] => {
  const weapons = HERO_WEAPONS[sex];
  return [
    { animation: "idle", frame: 1, direction: "s", note: "This frame: standing at ease, seen from the south." },
    {
      animation: "walk",
      frame: 2,
      direction: "se",
      note: "This frame: the second frame of the walk, seen from the south-east.",
    },
    {
      animation: "melee",
      frame: 3,
      direction: "se",
      note: `This frame: the middle of the melee strike with the ${weapons.melee}, seen from the south-east; the ${weapons.melee} must be in ${PRONOUNS[sex].possessive} hand.`,
    },
    {
      animation: "ranged",
      frame: 3,
      direction: "se",
      note: `This frame: the middle of the ranged attack with the ${weapons.ranged}, seen from the south-east; the ${weapons.ranged} must be in ${PRONOUNS[sex].possessive} hand.`,
    },
  ];
};

export const poseOf = (frame: Pick<RepresentativeFrame, "animation" | "frame">) => `${frame.animation}${frame.frame}`;

/**
 * The script a sandbox runs for one frame: the model's `build` under the name `modelBuild`, `FACING` set for the direction,
 * and a `build` that turns scaling off (every frame must keep the scale of the others, as the deterministic atlas does)
 * and calls it. The kit's `facing` for a direction is `kitFacing`.
 */
export function heroModelFrameCode(modelCode: string, direction: DrawnDirection): string {
  const renamed = modelCode.replace(/function\s+build\s*\(/, "function modelBuild(");
  return `const FACING = ${kitFacing(direction)};\n${renamed}\nfunction build(k) {\n k.noScale = true;\n modelBuild(k);\n}\n`;
}

/** The 100 frame builds of a sex from model code, named and ordered as the deterministic builds (`heroFrameBuilds`). */
export function heroModelFrameBuilds(sex: Sex, modelCode: string): FrameBuild[] {
  return HERO_ANIMATIONS.flatMap((animation) =>
    Array.from({ length: FRAMES[animation] }, (_, index) =>
      DRAWN_DIRECTIONS.map((direction) => ({
        name: heroFrameName(sex, animation, index, direction),
        code: heroModelFrameCode(modelCode, direction),
        pose: `${animation}${index + 1}`,
      })),
    ).flat(),
  );
}

const quoted = (word: string) => `['"\`]${word}['"\`]`;

/**
 * What is wrong with model code before anything renders: it must be exactly one hero() call for this sex and these weapons,
 * drawn by POSE and FACING, with nothing that would move the figure off the ground anchor or fix a pose. An empty list is a
 * pass.
 */
export function heroCodeIssues(sex: Sex, source: string): string[] {
  const weapons = HERO_WEAPONS[sex];
  const issues: string[] = [];
  // what the code does, not what its comments say
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if ((code.match(/\bfunction\s+build\s*\(/g) ?? []).length !== 1) {
    issues.push("define function build(k) exactly once");
  }
  if (/\b(FACING|POSE|modelBuild)\s*=[^=]|\b(const|let|var|function)\s+(FACING|POSE|modelBuild)\b/.test(code)) {
    issues.push("do not declare FACING, POSE or modelBuild: the renderer provides them");
  }
  if ((code.match(/\bhero\s*\(/g) ?? []).length !== 1) {
    issues.push("call hero(k, {...}) exactly once");
  }
  if (!new RegExp(`\\bsex\\s*:\\s*${quoted(sex)}`).test(code)) {
    issues.push(`pass sex: '${sex}'`);
  }
  if (!new RegExp(`\\bmelee\\s*:\\s*${quoted(weapons.melee)}`).test(code)) {
    issues.push(`the melee weapon must be '${weapons.melee}': pass melee: '${weapons.melee}'`);
  }
  if (!new RegExp(`\\branged\\s*:\\s*${quoted(weapons.ranged)}`).test(code)) {
    issues.push(`the ranged weapon must be '${weapons.ranged}': pass ranged: '${weapons.ranged}'`);
  }
  if (!/\bpose\s*:\s*POSE\s*\|\|\s*['"`]idle['"`]/.test(code)) {
    issues.push("pass pose: POSE || 'idle' exactly");
  }
  if (!/\bfacing\s*:\s*FACING\b/.test(code)) {
    issues.push("pass facing: FACING exactly");
  }
  if (/\b(at|height|build|ready)\s*:/.test(code)) {
    issues.push("do not pass at, height, build or ready: the game sets the anchor, the size and the weapon in hand");
  }
  if (/\bk\s*\.\s*[A-Za-z]/.test(code)) {
    issues.push("call no raw shapes or k methods: they do not turn with the figure; use hero() parameters only");
  }
  return issues;
}

/** A frame that draws less than this is a pose that drew nothing (a figure is thousands of pixels). */
const MIN_FIGURE_PIXELS = 100;

const opaquePixels = (rgba: Uint8Array) => {
  let count = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if ((rgba[offset] ?? 0) > 200) {
      count++;
    }
  }
  return count;
};

const sameBytes = (first: Uint8Array, second: Uint8Array) =>
  first.length === second.length && first.every((byte, index) => byte === second[index]);

/** Why an atlas was refused; `kind` is a fixed word, `reason` is for a person. */
export interface HeroAtlasRefusal {
  ok: false;
  kind: "incomplete" | "render" | "picture" | "blank" | "static" | "attack";
  reason: string;
}

export type HeroAtlasResult = { ok: true; atlas: Buffer; frames: Map<string, Uint8Array> } | HeroAtlasRefusal;

/**
 * Checks a sex's 100 renders and packs them into the atlas, or says why they are not a usable warden: any frame that did not
 * render, a pose that drew nothing, walk frames that are one picture (the builder ignores POSE), an attack that is no different
 * from standing, or two weapons that draw the same.
 */
export function assembleHeroAtlas(
  sex: Sex,
  builds: readonly FrameBuild[],
  results: readonly RenderResult[],
): HeroAtlasResult {
  if (results.length !== builds.length) {
    return { ok: false, kind: "incomplete", reason: "the frame batch came back incomplete" };
  }
  const frames = new Map<string, Uint8Array>();
  for (const [index, build] of builds.entries()) {
    const result = results[index];
    if (!result?.ok) {
      return { ok: false, kind: "render", reason: `${build.name} did not render: ${result?.error ?? "no result"}` };
    }
    let picture: PixelImage;
    try {
      picture = decodePng(Buffer.from(result.png));
    } catch {
      return { ok: false, kind: "picture", reason: `${build.name} is not a PNG` };
    }
    if (picture.width !== HERO_FRAME_SIZE || picture.height !== HERO_FRAME_SIZE) {
      return {
        ok: false,
        kind: "picture",
        reason: `${build.name} is ${picture.width}x${picture.height}, not ${HERO_FRAME_SIZE} px square`,
      };
    }
    if (opaquePixels(picture.data) < MIN_FIGURE_PIXELS) {
      return { ok: false, kind: "blank", reason: `${build.name} is empty: the pose draws no figure` };
    }
    frames.set(`hero/${build.name}`, picture.data);
  }
  for (const direction of DRAWN_DIRECTIONS) {
    const frame = (animation: (typeof HERO_ANIMATIONS)[number], index: number) =>
      frames.get(`hero/${heroFrameName(sex, animation, index, direction)}`);
    const walking = Array.from({ length: FRAMES.walk }, (_, index) => frame("walk", index));
    const [firstStep, ...laterSteps] = walking;
    if (firstStep && laterSteps.every((step) => step && sameBytes(step, firstStep))) {
      return {
        ok: false,
        kind: "static",
        reason: `the walk frames seen from ${direction} are all the same picture: the builder ignores its pose`,
      };
    }
    const standing = frame("idle", 0);
    for (const animation of ["melee", "ranged"] as const) {
      const strike = Array.from({ length: FRAMES[animation] }, (_, index) => frame(animation, index));
      if (standing && strike.every((step) => step && sameBytes(step, standing))) {
        return {
          ok: false,
          kind: "attack",
          reason: `the ${animation} frames seen from ${direction} are all the standing picture: the attack is not drawn`,
        };
      }
    }
    const meleeMiddle = frame("melee", 2);
    const rangedMiddle = frame("ranged", 2);
    if (meleeMiddle && rangedMiddle && sameBytes(meleeMiddle, rangedMiddle)) {
      return {
        ok: false,
        kind: "attack",
        reason: `the melee and ranged attacks seen from ${direction} are the same picture: one weapon is not drawn`,
      };
    }
  }
  return { ok: true, atlas: packHeroAtlas(sex, frames), frames };
}
