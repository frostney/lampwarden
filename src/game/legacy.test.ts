import { describe, expect, test } from "bun:test";

import { compareCodeUnits } from "../lib/compare";
import { nextCreatureRequestSchema } from "./creature";
import {
  applyDirector,
  buy,
  drawOffers,
  endWarden,
  type HeirChoice,
  heirAs,
  heirChoices,
  LEVEL_COSTS,
  meet,
  newLegacy,
  OFFER_COUNT,
  openShop,
  parseLegacy,
  setRulesDirector,
} from "./legacy";
import { emptyLevels, MAX_LEVEL, UPGRADE_IDS, type UpgradeId } from "./levels";

describe("heir choices", () => {
  // a seeded stand-in for Math.random, so every draw of names and traits is covered over many lines
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  };

  test("never offer the fallen warden's own name, so no heir counts as chosen before the player picks", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const heirs = heirChoices(seeded(seed), "Lykos");
      expect(heirs).toHaveLength(3);
      expect(heirs.some((heir) => heir.name === "Lykos")).toBe(false);
      expect(new Set(heirs.map((heir) => heir.name)).size).toBe(3);
      expect(new Set(heirs.map((heir) => heir.trait)).size).toBe(3);
    }
  });
});

describe("heirAs", () => {
  test("gives the warden a name of the other sex and keeps the trait", () => {
    const heir = newLegacy().heir;
    const daughter = heirAs(heir, "female");
    expect(daughter.sex).toBe("female");
    expect(daughter.name).not.toBe(heir.name);
    expect(daughter.trait).toBe(heir.trait);
  });

  test("choosing back restores the name", () => {
    const heir = newLegacy().heir;
    expect(heirAs(heirAs(heir, "female"), "male")).toEqual(heir);
  });

  test("a name from outside the lists still changes with the sex", () => {
    const daughter = heirAs({ name: "Stranger", sex: "male", trait: "keen" }, "female");
    expect(daughter.sex).toBe("female");
    expect(daughter.name).not.toBe("Stranger");
  });
});

// a legacy as an earlier build saved it: four upgrades, no shop
const OLD_SAVE: Record<string, unknown> = {
  generation: 3,
  heir: { name: "Ione", sex: "female", trait: "keen" },
  night: 4,
  bestNight: 6,
  oil: 31,
  levels: { wick: 2, blade: 1, quiver: 0, heart: 3 },
  tide: 1.3,
  fallen: [{ name: "Lykos", night: 5, cause: "fell in the plaza" }],
};

describe("the shop's offers", () => {
  test("a seed draws the same three distinct upgrades every time", () => {
    const levels = emptyLevels();
    const offers = drawOffers(12345, levels);
    expect(offers).toHaveLength(OFFER_COUNT);
    expect(new Set(offers).size).toBe(OFFER_COUNT);
    expect(drawOffers(12345, levels)).toEqual(offers);
  });

  test("different seeds draw different offers, and every upgrade turns up", () => {
    const seen = new Set<UpgradeId>();
    const draws = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const offers = drawOffers(seed, emptyLevels());
      draws.add(offers.join());
      for (const id of offers) {
        seen.add(id);
      }
    }
    expect(draws.size).toBeGreaterThan(20);
    expect(seen.size).toBe(UPGRADE_IDS.length);
  });

  test("an upgrade at its top level is never offered", () => {
    const levels = { ...emptyLevels(), wick: MAX_LEVEL, blade: MAX_LEVEL, heart: MAX_LEVEL };
    for (let seed = 1; seed <= 200; seed++) {
      const offers = drawOffers(seed, levels);
      expect(offers).toHaveLength(OFFER_COUNT);
      for (const id of ["wick", "blade", "heart"] as const) {
        expect(offers).not.toContain(id);
      }
    }
  });

  test("offers what is left when fewer than three can still be bought", () => {
    const levels = emptyLevels();
    for (const id of UPGRADE_IDS) {
      levels[id] = MAX_LEVEL;
    }
    levels.stride = 1;
    levels.tinder = 2;
    expect(drawOffers(7, levels).toSorted(compareCodeUnits)).toEqual(["stride", "tinder"]);
    levels.stride = MAX_LEVEL;
    levels.tinder = MAX_LEVEL;
    expect(drawOffers(7, levels)).toEqual([]);
  });

  test("each shop that opens draws from a new seed, and a line draws the same shops again from the same start", () => {
    const first = newLegacy(99);
    const second = newLegacy(99);
    const seeds = new Set<number>();
    const sequences = [first, second].map((legacy) => {
      const shops: string[] = [];
      for (let night = 0; night < 6; night++) {
        openShop(legacy);
        seeds.add(legacy.offerSeed);
        shops.push(legacy.offers.join());
      }
      return shops;
    });
    expect(sequences[0]).toEqual(sequences[1]);
    expect(seeds.size).toBe(6);
    expect(new Set(sequences[0]).size).toBeGreaterThan(2);
  });

  test("a reload keeps the offers instead of rerolling them", () => {
    const legacy = newLegacy(4242);
    openShop(legacy);
    const reloaded = parseLegacy(JSON.parse(JSON.stringify(legacy)));
    expect(reloaded.offers).toEqual(legacy.offers);
    expect(reloaded.offerSeed).toBe(legacy.offerSeed);
  });
});

describe("buying", () => {
  test("a bought upgrade stays on offer for a second level while the oil lasts", () => {
    const legacy = newLegacy(5);
    const [id] = legacy.offers;
    if (!id) {
      throw new Error("no offer");
    }
    legacy.oil = LEVEL_COSTS[0] + LEVEL_COSTS[1] + 1;
    expect(buy(legacy, id)).toBe(true);
    expect(buy(legacy, id)).toBe(true);
    expect(legacy.levels[id]).toBe(2);
    expect(legacy.oil).toBe(1);
    expect(legacy.offers).toContain(id);
    expect(buy(legacy, id)).toBe(false); // the third level costs more than is left
  });

  test("only what is on offer can be bought, and a top level cannot be bought past", () => {
    const legacy = newLegacy(5);
    legacy.oil = 1000;
    const absent = UPGRADE_IDS.find((id) => !legacy.offers.includes(id));
    if (!absent) {
      throw new Error("everything on offer");
    }
    expect(buy(legacy, absent)).toBe(false);
    const [offered] = legacy.offers;
    if (!offered) {
      throw new Error("no offer");
    }
    for (let count = 0; count < MAX_LEVEL; count++) {
      expect(buy(legacy, offered)).toBe(true);
    }
    expect(buy(legacy, offered)).toBe(false);
    expect(legacy.levels[offered]).toBe(MAX_LEVEL);
  });

  test("what was only the warden's falls with them; the line's upgrades stay", () => {
    const legacy = newLegacy(5);
    legacy.levels.hide = 2;
    legacy.levels.heart = 2;
    endWarden(legacy);
    expect(legacy.levels.hide).toBe(0);
    expect(legacy.levels.heart).toBe(2);
  });
});

describe("loading a saved legacy", () => {
  test("a save from before the new upgrades keeps its levels, starts the new ones at 0 and gets offers", () => {
    const legacy = parseLegacy(OLD_SAVE);
    expect(legacy.levels).toEqual({ ...emptyLevels(), wick: 2, blade: 1, heart: 3 });
    expect(legacy.oil).toBe(31);
    expect(legacy.generation).toBe(3);
    expect(legacy.heir).toEqual({ name: "Ione", sex: "female", trait: "keen" });
    expect(legacy.fallen).toEqual([{ name: "Lykos", night: 5, cause: "fell in the plaza" }]);
    expect(legacy.offers).toHaveLength(OFFER_COUNT);
    expect(legacy.offers).not.toContain("heart"); // already at its top level
  });

  test("a damaged save keeps what is readable and replaces the rest", () => {
    const legacy = parseLegacy({ ...OLD_SAVE, oil: "lots", tide: 99, levels: { wick: 7, blade: 2 }, heir: 4 });
    expect(legacy.oil).toBe(0);
    expect(legacy.tide).toBe(1);
    expect(legacy.levels).toEqual({ ...emptyLevels(), blade: 2 });
    expect(legacy.heir).toEqual(newLegacy().heir);
    expect(legacy.night).toBe(4);
  });

  test("a save without its levels keeps everything else", () => {
    const { levels: _levels, ...withoutLevels } = OLD_SAVE;
    const legacy = parseLegacy(withoutLevels);
    expect(legacy.levels).toEqual(emptyLevels());
    expect(legacy.generation).toBe(3);
    expect(legacy.heir).toEqual({ name: "Ione", sex: "female", trait: "keen" });
  });
});

describe("the heir choice after a warden falls", () => {
  const choice: HeirChoice = {
    name: "Ione",
    night: 4,
    outcome: "dark",
    tideBefore: 1.1,
    heirs: [
      { name: "Phaedra", sex: "female", trait: "keen" },
      { name: "Theron", sex: "male", trait: "stout" },
      { name: "Myrto", sex: "female", trait: "swift" },
    ],
  };

  test("is saved with the line, so a reload offers the same heirs", () => {
    const legacy = { ...newLegacy(), heirChoice: choice };
    expect(parseLegacy(JSON.parse(JSON.stringify(legacy))).heirChoice).toEqual(choice);
  });

  test("is gone once it is cleared, and a line without one has none", () => {
    const legacy = { ...newLegacy(), heirChoice: undefined };
    expect(parseLegacy(JSON.parse(JSON.stringify(legacy))).heirChoice).toBeUndefined();
    expect(parseLegacy(OLD_SAVE).heirChoice).toBeUndefined();
  });

  test("a damaged choice is dropped and the rest of the save kept", () => {
    const legacy = parseLegacy({ ...OLD_SAVE, heirChoice: { ...choice, heirs: [] } });
    expect(legacy.heirChoice).toBeUndefined();
    expect(legacy.generation).toBe(3);
  });
});

describe("the bestiary", () => {
  test("an old save has met no creatures", () => {
    expect(parseLegacy(OLD_SAVE).bestiary).toEqual([]);
    expect(newLegacy().bestiary).toEqual([]);
  });

  test("a saved bestiary comes back, without repeats; anything else is empty", () => {
    expect(
      parseLegacy({ ...OLD_SAVE, bestiary: ["brine-hound-1", "tide-giant-22", "brine-hound-1"] }).bestiary,
    ).toEqual(["brine-hound-1", "tide-giant-22"]);
    expect(parseLegacy({ ...OLD_SAVE, bestiary: "brine-hound-1" }).bestiary).toEqual([]);
    expect(parseLegacy({ ...OLD_SAVE, bestiary: [1, 2] }).bestiary).toEqual([]);
  });

  test("a legacy round-trips through storage with its bestiary", () => {
    const legacy = newLegacy(7);
    meet(legacy, "brine-hound-1");
    expect(parseLegacy(JSON.parse(JSON.stringify(legacy))).bestiary).toEqual(["brine-hound-1"]);
  });

  test("meeting a creature adds it once", () => {
    const legacy = newLegacy();
    meet(legacy, "brine-hound-1");
    meet(legacy, "tide-giant-22");
    meet(legacy, "brine-hound-1");
    expect(legacy.bestiary).toEqual(["brine-hound-1", "tide-giant-22"]);
  });

  test("the bestiary never outgrows what the gallery accepts as seen", () => {
    const legacy = newLegacy();
    for (let count = 0; count < 520; count++) {
      meet(legacy, `creature-${count}`);
    }
    expect(nextCreatureRequestSchema.safeParse({ seen: legacy.bestiary }).success).toBe(true);
    expect(legacy.bestiary.at(-1)).toBe("creature-519"); // the oldest dropped, not the newest
  });
});

describe("the director in the legacy", () => {
  const PLAY_ID = "2026-10-24-16-11-46-juith2u0";
  const answer = (legacy: ReturnType<typeof newLegacy>, overrides: Record<string, unknown> = {}) => ({
    ...legacy.director,
    source: "mubit",
    tide: 0.9,
    mix: { satyr: 1, cyclops: 0.6, harpy: 1.4 },
    creatureShare: 0.3,
    line: "The sea draws back.",
    ...overrides,
  });
  const afterNight = () => {
    const legacy = newLegacy(3);
    legacy.night = 3;
    setRulesDirector(legacy, 1, 2, PLAY_ID);
    return legacy;
  };

  test("an old save has the rules' director for the coming night", () => {
    const legacy = parseLegacy(OLD_SAVE);
    expect(legacy.director).toEqual({
      source: "rules",
      tide: 1.3,
      rulesTide: 1.3,
      mix: { satyr: 1, cyclops: 1, harpy: 1 },
      creatureShare: 0.25,
      line: "",
      decidedAfterNight: 3,
    });
    expect(newLegacy().director.source).toBe("rules");
  });

  test("a saved director comes back, and a damaged one is the rules'", () => {
    const legacy = afterNight();
    expect(applyDirector(legacy, answer(legacy))).toBe(true);
    expect(parseLegacy(JSON.parse(JSON.stringify(legacy))).director).toEqual(legacy.director);
    const damaged = JSON.parse(JSON.stringify(legacy));
    damaged.director.mix.cyclops = 12;
    expect(parseLegacy(damaged).director.source).toBe("rules");
    damaged.director = "mubit";
    expect(parseLegacy(damaged).director.source).toBe("rules");
  });

  test("the live director's answer replaces the rules' decision, tide included", () => {
    const legacy = afterNight();
    expect(applyDirector(legacy, answer(legacy))).toBe(true);
    expect(legacy.tide).toBe(0.9);
    expect(legacy.director).toMatchObject({ source: "mubit", creatureShare: 0.3, playId: PLAY_ID });
  });

  test("an answer is brought inside the bounds again, whatever the server said", () => {
    const legacy = afterNight();
    // the server claimed the rules' tide was 1.4; the game knows it is 1, so 1.4 - 0.1 = 1.3 is pulled in to 1.15
    expect(applyDirector(legacy, answer(legacy, { rulesTide: 1.4, tide: 1.3 }))).toBe(true);
    expect(legacy.tide).toBe(1.15);
  });

  test("an answer that is late, for another play, twice, or not an answer, changes nothing", () => {
    const legacy = afterNight();
    const before = structuredClone(legacy);
    expect(applyDirector(legacy, answer(legacy, { playId: "2026-10-24-16-11-47-aaaaaaaa" }))).toBe(false);
    expect(applyDirector(legacy, answer(legacy, { decidedAfterNight: 1 }))).toBe(false);
    expect(applyDirector(legacy, answer(legacy, { source: "rules" }))).toBe(false);
    expect(applyDirector(legacy, answer(legacy, { line: "" }))).toBe(false);
    expect(applyDirector(legacy, null)).toBe(false);
    expect(legacy).toEqual(before);
    expect(applyDirector(legacy, answer(legacy))).toBe(true);
    expect(applyDirector(legacy, answer(legacy, { tide: 0.85 }))).toBe(false); // already answered
    // the next night's end puts the rules' decision back, and the earlier answer cannot apply to it
    const earlier = answer(legacy);
    setRulesDirector(legacy, 1, 3, "2026-10-24-16-20-00-bbbbbbbb");
    expect(applyDirector(legacy, earlier)).toBe(false);
    expect(legacy.director.source).toBe("rules");
  });

  test("a night that left no recording has nothing to ask about", () => {
    const legacy = newLegacy();
    setRulesDirector(legacy, 0.85, 1);
    expect(applyDirector(legacy, answer(legacy))).toBe(false);
  });
});
