import { describe, expect, test } from "bun:test";
import { endWarden, heirAs, newLegacy, UPGRADE_IDS } from "./legacy";
import { shopSex, upgradeView } from "./weapons";

const SONS_WEAPONS = /arrow|quiver|blade|sword|\bbow\b|xiphos/i;
const DAUGHTERS_WEAPONS = /spear|sling|stone|pouch/i;

describe("upgradeView", () => {
  test("no upgrade shown to the daughter names the son's weapons, and none shown to the son names hers", () => {
    for (const id of UPGRADE_IDS) {
      const daughter = upgradeView(id, "female");
      const son = upgradeView(id, "male");
      expect(`${daughter.label} ${daughter.text}`).not.toMatch(SONS_WEAPONS);
      expect(`${son.label} ${son.text}`).not.toMatch(DAUGHTERS_WEAPONS);
    }
  });

  test("the upgrades that are not about a weapon read the same for both", () => {
    for (const id of UPGRADE_IDS) {
      if (id === "blade" || id === "quiver") continue;
      expect(upgradeView(id, "female")).toEqual(upgradeView(id, "male"));
    }
  });
});

describe("shopSex", () => {
  test("on the heir screen it is the fallen warden's until an heir is picked", () => {
    const legacy = newLegacy();
    legacy.heir = heirAs(legacy.heir, "female");
    endWarden(legacy); // she falls: the heirs are offered and the shop opens
    expect(shopSex(legacy)).toBe("female");
  });
});
