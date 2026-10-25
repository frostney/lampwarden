import { describe, expect, test } from "bun:test";

import { DRAWN_DIRECTIONS, FRAMES, HERO_ANIMATIONS, heroFrames, SEXES } from "../src/scene/assets";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { CLEAN_STATS, framePng } from "./fakes";
import { heroFrameBuilds, kitFacing } from "./hero-animation";
import { assembleHeroAtlas, heroBrief, heroCodeIssues, heroModelFrameBuilds, heroModelFrameCode } from "./hero-model";
import type { RenderResult } from "./render-types";

const maleCode = `function build(k) {
  hero(k, { sex: 'male', melee: 'xiphos', ranged: 'bow', pose: POSE || 'idle', facing: FACING, helmet: 'attic', cape: true, palette: { cloth: 'aegean', accent: 'crimson' } });
}`;
const femaleCode = maleCode.replace("'male'", "'female'").replace("'xiphos'", "'spear'").replace("'bow'", "'sling'");

describe("the frame script of model code", () => {
  test("sets FACING for the direction and turns scaling off around the model's build", () => {
    const script = heroModelFrameCode(maleCode, "e");
    expect(script.startsWith(`const FACING = ${kitFacing("e")};`)).toBe(true);
    expect(script).toContain("function modelBuild(k)");
    expect(script).toContain("k.noScale = true;");
    expect(script.trimEnd().endsWith("modelBuild(k);\n}")).toBe(true);
    expect(heroModelFrameCode(maleCode, "n")).toContain(`const FACING = ${kitFacing("n")};`);
  });

  test("makes the same 100 frames, named and ordered as the deterministic builds, each with its pose", () => {
    for (const sex of SEXES) {
      const builds = heroModelFrameBuilds(sex, maleCode);
      const deterministic = HERO_ANIMATIONS.flatMap((animation) => heroFrameBuilds(sex, animation));
      expect(builds.map((build) => build.name)).toEqual(deterministic.map((build) => build.name));
      expect(builds).toHaveLength(100);
      expect(builds[0]?.pose).toBe("idle1");
      expect(builds.at(-1)?.pose).toBe("ranged5");
      expect(new Set(builds.map((build) => build.name)).size).toBe(100);
    }
  });
});

describe("the checks on model code", () => {
  test("accept the hero call with this sex's weapons, POSE and FACING", () => {
    expect(heroCodeIssues("male", maleCode)).toEqual([]);
    expect(heroCodeIssues("female", femaleCode)).toEqual([]);
  });

  test("refuse the wrong sex or weapon, a fixed pose or facing, and anything that moves the figure or fixes the pose", () => {
    expect(heroCodeIssues("male", femaleCode).length).toBeGreaterThanOrEqual(3);
    expect(heroCodeIssues("male", maleCode.replace("'xiphos'", "'sword'"))).toEqual([
      "the melee weapon must be 'xiphos': pass melee: 'xiphos'",
    ]);
    expect(heroCodeIssues("male", maleCode.replace("POSE || 'idle'", "'idle'"))).toContain(
      "pass pose: POSE || 'idle' exactly",
    );
    expect(heroCodeIssues("male", maleCode.replace("facing: FACING", "facing: 20"))).toContain(
      "pass facing: FACING exactly",
    );
    expect(heroCodeIssues("male", maleCode.replace("cape: true", "at: [3, 0]"))).toHaveLength(1);
    expect(heroCodeIssues("male", maleCode.replace("cape: true", "ready: 'ranged'"))).toHaveLength(1);
    expect(heroCodeIssues("male", maleCode.replace(/\}$/, "  k.sphere([0, 0, 30], 3, 'gold');\n}"))).toHaveLength(1);
    expect(heroCodeIssues("male", `${maleCode}\n${maleCode}`)).toContain("call hero(k, {...}) exactly once");
  });

  test("read the code, not its comments, and refuse a redeclared FACING, POSE or modelBuild", () => {
    // a comment that mentions hero( or ready: does not refuse a good code, and one that says facing: FACING does not pass a bad one
    expect(heroCodeIssues("male", `// hero(k, {}) with ready: 'melee'\n${maleCode}`)).toEqual([]);
    const fixedFacing = maleCode.replace("facing: FACING", "facing: 20 /* facing: FACING */");
    expect(heroCodeIssues("male", fixedFacing)).toContain("pass facing: FACING exactly");
    expect(heroCodeIssues("male", `const FACING = 45;\n${maleCode}`)).toContain(
      "do not declare FACING, POSE or modelBuild: the renderer provides them",
    );
    expect(heroCodeIssues("male", `function modelBuild() {}\n${maleCode}`)).toContain(
      "do not declare FACING, POSE or modelBuild: the renderer provides them",
    );
    expect(heroCodeIssues("male", `${maleCode}\nfunction build(k) {}`)).toContain(
      "define function build(k) exactly once",
    );
  });

  test("the brief speaks of each warden in the right pronoun", () => {
    expect(heroBrief("male")).toContain("his armour");
    expect(heroBrief("female")).toContain("her armour");
    expect(heroBrief("female")).not.toMatch(/\b(his|him|himself)\b/);
    expect(heroBrief("male")).not.toMatch(/\b(her|herself)\b/);
  });

  test("the brief names the weapons, FACING and POSE for the sex", () => {
    expect(heroBrief("male")).toContain("melee: 'xiphos', ranged: 'bow'");
    expect(heroBrief("female")).toContain("melee: 'spear', ranged: 'sling'");
    expect(heroBrief("female")).toContain("pose: POSE || 'idle', facing: FACING");
  });
});

describe("an atlas of model frames", () => {
  const builds = heroModelFrameBuilds("male", maleCode);
  const rendered = (png: Uint8Array): RenderResult => ({ ok: true, stats: CLEAN_STATS, png });
  // every frame its own picture, unless `same` says which indices share one
  const results = (same: (index: number) => number = (index) => index): RenderResult[] =>
    builds.map((_build, index) => rendered(framePng(same(index) + 1)));
  const indexOf = (animation: string, frame: number, direction: string) =>
    builds.findIndex((build) => build.name === `male_${animation}${frame}_${direction}`);

  test("is packed into the cells the scene cuts it from", () => {
    const assembled = assembleHeroAtlas("male", builds, results());
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }
    const atlas = decodePng(assembled.atlas);
    expect(atlas.width).toBe(DRAWN_DIRECTIONS.length * 128);
    expect(atlas.height).toBe(HERO_ANIMATIONS.reduce((total, animation) => total + FRAMES[animation], 0) * 128);
    const cells = heroFrames("male");
    expect(cells).toHaveLength(100);
    const first = cells.find((cell) => cell.key === "hero/male_walk3_se");
    const index = indexOf("walk", 3, "se");
    expect(first).toBeDefined();
    // frame `index` drew its 16 px block at 20 + (index + 1 mod 90), 60: the same pixel in its cell
    const block = 20 + ((index + 1) % 90);
    expect(atlas.alpha((first?.x ?? 0) + block, (first?.y ?? 0) + 60)).toBe(255);
  });

  test("is refused when a frame did not render", () => {
    const broken = results();
    broken[indexOf("melee", 2, "s")] = { ok: false, error: "exit 1: error: boom" };
    expect(assembleHeroAtlas("male", builds, broken)).toMatchObject({ ok: false, kind: "render" });
    expect(assembleHeroAtlas("male", builds, broken.slice(1))).toMatchObject({ ok: false, kind: "incomplete" });
  });

  test("is refused when a pose draws nothing", () => {
    const blank = results();
    blank[indexOf("ranged", 4, "ne")] = rendered(encodePng(new PixelImage(128, 128)));
    expect(assembleHeroAtlas("male", builds, blank)).toMatchObject({ ok: false, kind: "blank" });
  });

  test("is refused when it is not a 128 px picture", () => {
    const small = results();
    small[0] = rendered(encodePng(new PixelImage(64, 64)));
    expect(assembleHeroAtlas("male", builds, small)).toMatchObject({ ok: false, kind: "picture" });
  });

  test("is refused when the walk frames are one picture", () => {
    const walkIndices = new Set(Array.from({ length: 6 }, (_, frame) => indexOf("walk", frame + 1, "e")));
    const first = indexOf("walk", 1, "e");
    expect(
      assembleHeroAtlas(
        "male",
        builds,
        results((index) => (walkIndices.has(index) ? first : index)),
      ),
    ).toMatchObject({ ok: false, kind: "static" });
  });

  test("is refused when an attack is only the standing picture", () => {
    const standing = indexOf("idle", 1, "s");
    const attackIndices = new Set(Array.from({ length: 5 }, (_, frame) => indexOf("melee", frame + 1, "s")));
    expect(
      assembleHeroAtlas(
        "male",
        builds,
        results((index) => (attackIndices.has(index) ? standing : index)),
      ),
    ).toMatchObject({ ok: false, kind: "attack" });
  });

  test("is refused when the melee and ranged strikes are the same picture", () => {
    const melee = indexOf("melee", 3, "n");
    const ranged = indexOf("ranged", 3, "n");
    expect(
      assembleHeroAtlas(
        "male",
        builds,
        results((index) => (index === ranged ? melee : index)),
      ),
    ).toMatchObject({
      ok: false,
      kind: "attack",
    });
  });
});
