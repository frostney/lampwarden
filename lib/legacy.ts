// The part of a run that outlives the warden: oil, upgrades, the bloodline and the director's read of the player.
// Saved to localStorage, so a reload keeps the line going.
import type { Sex } from "./assets";

export const UPGRADE_IDS = ["wick", "blade", "quiver", "heart"] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];
export const UPGRADES: Record<UpgradeId, { label: string; text: string; cost: number[] }> = {
  wick: { label: "Brighter wicks", text: "lamps burn longer under claws and throw a wider light", cost: [8, 18, 32] },
  blade: { label: "Keener blade", text: "melee reaches further and cleaves harder", cost: [8, 18, 32] },
  quiver: { label: "Deeper quiver", text: "faster shots; at level 2 a spread of three", cost: [8, 18, 32] },
  heart: { label: "Warden's heart", text: "+20 health for every warden after", cost: [8, 18, 32] },
};
export const MAX_LEVEL = 3;

const TRAIT_IDS = ["swift", "stout", "lamplighter", "longarm", "keen"] as const;
export type TraitId = (typeof TRAIT_IDS)[number];
export const TRAITS: Record<TraitId, { label: string; text: string }> = {
  swift: { label: "Swift", text: "moves a quarter faster" },
  stout: { label: "Stout", text: "+30 health" },
  lamplighter: { label: "Lamplighter", text: "relights lamps twice as fast" },
  longarm: { label: "Long-armed", text: "melee reaches further" },
  keen: { label: "Keen-eyed", text: "shots pierce through monsters" },
};

export interface Heir {
  name: string;
  sex: Sex;
  trait: TraitId;
}

export interface Legacy {
  generation: number; // which warden of the line this is (1-based)
  heir: Heir;
  night: number; // the night the current warden is on
  bestNight: number;
  oil: number;
  levels: Record<UpgradeId, number>;
  tide: number; // director difficulty multiplier, read from how the player did (0.6..2)
  fallen: { name: string; night: number; cause: string }[];
}

const NAMES: Record<Sex, readonly [string, ...string[]]> = {
  male: ["Nikias", "Theron", "Lykos", "Damon", "Kleon", "Aristos", "Philon", "Iason"],
  female: ["Phaedra", "Ione", "Thalia", "Korinna", "Myrto", "Eudora", "Melitta", "Kallisto"],
};

// one item of a non-empty list, by a roll in [0, 1)
function pick<Item>(items: readonly [Item, ...Item[]], roll: number): Item {
  return items[Math.floor(roll * items.length)] ?? items[0];
}

function randomHeir(random: () => number): Heir {
  const sex: Sex = random() < 0.5 ? "male" : "female";
  return { name: pick(NAMES[sex], random()), sex, trait: pick(TRAIT_IDS, random()) };
}

export function heirChoices(random = Math.random): Heir[] {
  const choices: Heir[] = [];
  while (choices.length < 3) {
    const heir = randomHeir(random);
    if (!choices.some((other) => other.name === heir.name || other.trait === heir.trait)) choices.push(heir);
  }
  return choices;
}

export function newLegacy(): Legacy {
  return {
    generation: 1,
    heir: { name: "Lykos", sex: "male", trait: "swift" },
    night: 1,
    bestNight: 0,
    oil: 0,
    levels: { wick: 0, blade: 0, quiver: 0, heart: 0 },
    tide: 1,
    fallen: [],
  };
}

export function upgradeCost(legacy: Legacy, id: UpgradeId): number | null {
  const level = legacy.levels[id];
  return level >= MAX_LEVEL ? null : (UPGRADES[id].cost[level] ?? null);
}

export function buy(legacy: Legacy, id: UpgradeId): boolean {
  const cost = upgradeCost(legacy, id);
  if (cost === null || legacy.oil < cost) return false;
  legacy.oil -= cost;
  legacy.levels[id]++;
  return true;
}

const KEY = "lampwarden:legacy:v1";
export function loadLegacy(): Legacy {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { ...newLegacy(), ...JSON.parse(raw) };
  } catch {
    /* corrupt or unavailable storage: start a new line */
  }
  return newLegacy();
}
export function saveLegacy(legacy: Legacy) {
  try {
    localStorage.setItem(KEY, JSON.stringify(legacy));
  } catch {
    /* private mode etc. */
  }
}
export function clearLegacy() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"];
export function ordinal(value: number) {
  const lastTwoDigits = value % 100;
  return value + (ORDINAL_SUFFIXES[(lastTwoDigits - 20) % 10] || ORDINAL_SUFFIXES[lastTwoDigits] || "th");
}

export function tideLabel(tide: number) {
  return tide < 0.85 ? "calm" : tide < 1.15 ? "restless" : tide < 1.5 ? "rising" : "raging";
}
