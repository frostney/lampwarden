// The part of a run that outlives the warden: oil, upgrades, the bloodline and the director's read of the player.
// Saved to localStorage, so a reload keeps the line going.
import type { Sex } from "./assets";

export type UpgradeId = "wick" | "blade" | "quiver" | "heart";
export const UPGRADES: Record<UpgradeId, { label: string; text: string; cost: number[] }> = {
  wick: { label: "Brighter wicks", text: "lamps burn longer under claws and throw a wider light", cost: [8, 18, 32] },
  blade: { label: "Keener blade", text: "melee reaches further and cleaves harder", cost: [8, 18, 32] },
  quiver: { label: "Deeper quiver", text: "faster shots; at level 2 a spread of three", cost: [8, 18, 32] },
  heart: { label: "Warden's heart", text: "+20 health for every warden after", cost: [8, 18, 32] },
};
export const MAX_LEVEL = 3;

export type TraitId = "swift" | "stout" | "lamplighter" | "longarm" | "keen";
export const TRAITS: Record<TraitId, { label: string; text: string }> = {
  swift: { label: "Swift", text: "moves a quarter faster" },
  stout: { label: "Stout", text: "+30 health" },
  lamplighter: { label: "Lamplighter", text: "relights lamps twice as fast" },
  longarm: { label: "Long-armed", text: "melee reaches further" },
  keen: { label: "Keen-eyed", text: "shots pierce through monsters" },
};

export interface Heir { name: string; sex: Sex; trait: TraitId }

export interface Legacy {
  generation: number;           // which warden of the line this is (1-based)
  heir: Heir;
  night: number;                // the night the current warden is on
  bestNight: number;
  oil: number;
  levels: Record<UpgradeId, number>;
  tide: number;                 // director difficulty multiplier, read from how the player did (0.6..2)
  fallen: { name: string; night: number; cause: string }[];
}

const NAMES: Record<Sex, string[]> = {
  male: ["Nikias", "Theron", "Lykos", "Damon", "Kleon", "Aristos", "Philon", "Iason"],
  female: ["Phaedra", "Ione", "Thalia", "Korinna", "Myrto", "Eudora", "Melitta", "Kallisto"],
};

export function randomHeir(rand = Math.random): Heir {
  const sex: Sex = rand() < 0.5 ? "male" : "female";
  const names = NAMES[sex];
  const traits = Object.keys(TRAITS) as TraitId[];
  return { name: names[Math.floor(rand() * names.length)], sex, trait: traits[Math.floor(rand() * traits.length)] };
}

export function heirChoices(rand = Math.random): Heir[] {
  const out: Heir[] = [];
  while (out.length < 3) {
    const h = randomHeir(rand);
    if (!out.some((o) => o.name === h.name || o.trait === h.trait)) out.push(h);
  }
  return out;
}

export function newLegacy(): Legacy {
  return {
    generation: 1, heir: { name: "Lykos", sex: "male", trait: "swift" }, night: 1, bestNight: 0, oil: 0,
    levels: { wick: 0, blade: 0, quiver: 0, heart: 0 }, tide: 1, fallen: [],
  };
}

export function upgradeCost(l: Legacy, id: UpgradeId): number | null {
  const lv = l.levels[id];
  return lv >= MAX_LEVEL ? null : UPGRADES[id].cost[lv];
}

export function buy(l: Legacy, id: UpgradeId): boolean {
  const c = upgradeCost(l, id);
  if (c === null || l.oil < c) return false;
  l.oil -= c;
  l.levels[id]++;
  return true;
}

const KEY = "lampwarden:legacy:v1";
export function loadLegacy(): Legacy {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { ...newLegacy(), ...JSON.parse(raw) };
  } catch { /* corrupt or unavailable storage: start a new line */ }
  return newLegacy();
}
export function saveLegacy(l: Legacy) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private mode etc. */ }
}
export function clearLegacy() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function tideLabel(t: number) {
  return t < 0.85 ? "calm" : t < 1.15 ? "restless" : t < 1.5 ? "rising" : "raging";
}
