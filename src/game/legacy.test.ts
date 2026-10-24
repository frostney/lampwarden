import { describe, expect, test } from "bun:test";
import { heirAs, newLegacy } from "./legacy";

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
