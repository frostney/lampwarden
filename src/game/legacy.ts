// The part of a run that outlives the warden: oil, upgrades, the bloodline and the director's read of the player.
// Saved to localStorage, so a reload keeps the line going.
import { z } from "zod";
import { SEXES, type Sex } from "../scene/assets";
import { nextRandom } from "./random";

export const UPGRADE_IDS = [
  "wick",
  "blade",
  "quiver",
  "heart",
  "hide",
  "knockback",
  "seeker",
  "tinder",
  "stride",
] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];
export type Levels = Record<UpgradeId, number>;
// text: what a level does, with the numbers (the rules themselves are in rulesFor in sim.ts). wardenOnly: lost when the
// warden falls, because it was only ever theirs. The blade and quiver read here as the son's sword and bow; the shop
// shows the daughter's spear and sling instead (weapons.ts).
export const UPGRADES: Record<UpgradeId, { label: string; text: string; wardenOnly?: true }> = {
  wick: { label: "Brighter wicks", text: "Lamps resist claws 35% longer and light 12 px wider." },
  blade: { label: "Keener blade", text: "Melee reaches 10 px further; at level 2 it hits harder." },
  quiver: { label: "Deeper quiver", text: "Shots fly 15% faster; at level 2 you shoot a spread of three." },
  heart: { label: "Warden's heart", text: "+20 health for this warden and every one after." },
  hide: { label: "Thick hide", text: "+30 health for this warden only. Lost when they fall.", wardenOnly: true },
  knockback: { label: "Heavy blows", text: "Blows and shots throw monsters back 40% further." },
  seeker: { label: "Oil seeker", text: "The slain leave oil 10% more often (30% to start)." },
  tinder: { label: "Quick tinder", text: "Lamps relight 20% faster, on top of Lamplighter." },
  stride: { label: "Light sandals", text: "Walk 8% faster, on top of Swift." },
};
export const MAX_LEVEL = 3;
// What the next level costs, whichever upgrade: a night of oil buys about the first.
export const LEVEL_COSTS = [12, 26, 45] as const;
// How many upgrades the shop offers before a night.
export const OFFER_COUNT = 3;

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
  levels: Levels;
  offerSeed: number; // advanced each time the shop opens: the offers come from it, so a reload does not reroll them
  offers: UpgradeId[]; // the upgrades on sale in the current shop
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

// The same warden as the other sex: a name from that sex's list (the one at the same place, so choosing back restores
// the name), the trait kept.
export function heirAs(heir: Heir, sex: Sex): Heir {
  if (heir.sex === sex) return heir;
  const place = NAMES[heir.sex].indexOf(heir.name);
  return { ...heir, sex, name: NAMES[sex][Math.max(0, place)] ?? NAMES[sex][0] };
}

export const emptyLevels = (): Levels => ({
  wick: 0,
  blade: 0,
  quiver: 0,
  heart: 0,
  hide: 0,
  knockback: 0,
  seeker: 0,
  tinder: 0,
  stride: 0,
});

// Levels from anything stored, a saved legacy or a recorded play: an upgrade it does not have (one added since) is
// level 0, and so is a value that is not a level.
const levelSchema = z.number().int().min(0).max(MAX_LEVEL);
export function levelsOf(stored: unknown): Levels {
  const levels = emptyLevels();
  if (typeof stored !== "object" || stored === null) return levels;
  for (const id of UPGRADE_IDS) {
    const parsed = levelSchema.safeParse(Reflect.get(stored, id));
    if (parsed.success) levels[id] = parsed.data;
  }
  return levels;
}

// The offers a seed draws: OFFER_COUNT distinct upgrades that are below their top level, or what is left of them.
export function drawOffers(seed: number, levels: Levels): UpgradeId[] {
  const pool = UPGRADE_IDS.filter((id) => levels[id] < MAX_LEVEL);
  const offers: UpgradeId[] = [];
  let state = seed;
  while (offers.length < OFFER_COUNT && pool.length > 0) {
    const draw = nextRandom(state);
    state = draw.seed;
    const [picked] = pool.splice(Math.floor(draw.value * pool.length), 1);
    if (picked) offers.push(picked);
  }
  return offers;
}

// Opens a new shop: the next seed, and the offers it draws. The next seed is a generator output, not its next state,
// so consecutive shops draw from unrelated sequences.
export function openShop(legacy: Legacy) {
  legacy.offerSeed = Math.floor(nextRandom(legacy.offerSeed).value * 4294967296);
  legacy.offers = drawOffers(legacy.offerSeed, legacy.levels);
}

// The warden falls: what was only theirs falls with them.
export function endWarden(legacy: Legacy) {
  for (const id of UPGRADE_IDS) if (UPGRADES[id].wardenOnly) legacy.levels[id] = 0;
}

// A new line starts from a seed (a fresh one unless the caller names it), which is the only chance in the shop.
export function newLegacy(offerSeed = Math.floor(Math.random() * 4294967296)): Legacy {
  const levels = emptyLevels();
  return {
    generation: 1,
    heir: { name: "Lykos", sex: "male", trait: "swift" },
    night: 1,
    bestNight: 0,
    oil: 0,
    levels,
    offerSeed,
    offers: drawOffers(offerSeed, levels),
    tide: 1,
    fallen: [],
  };
}

export function upgradeCost(legacy: Legacy, id: UpgradeId): number | null {
  return legacy.levels[id] >= MAX_LEVEL ? null : (LEVEL_COSTS[legacy.levels[id]] ?? null);
}

// Buys one level of an upgrade on offer. It stays on offer, so a second level can follow in the same shop.
export function buy(legacy: Legacy, id: UpgradeId): boolean {
  const cost = upgradeCost(legacy, id);
  if (cost === null || legacy.oil < cost || !legacy.offers.includes(id)) return false;
  legacy.oil -= cost;
  legacy.levels[id]++;
  return true;
}

// A saved legacy, as far as it can be read: every field that is missing or wrong falls back to a new line's, and the
// offers are drawn if the save has none (a save from before the shop offered three).
const field = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);
const storedLegacy = z.object({
  generation: field(z.number().int().min(1)),
  heir: field(z.object({ name: z.string(), sex: z.enum(SEXES), trait: z.enum(TRAIT_IDS) })),
  night: field(z.number().int().min(1)),
  bestNight: field(z.number().int().min(0)),
  oil: field(z.number().int().min(0)),
  levels: z.unknown(),
  offerSeed: field(z.number().int()),
  offers: field(z.array(z.enum(UPGRADE_IDS))),
  tide: field(z.number().min(0.6).max(2)),
  fallen: field(z.array(z.object({ name: z.string(), night: z.number(), cause: z.string() }))),
});
export function parseLegacy(stored: unknown): Legacy {
  const fresh = newLegacy();
  const parsed = storedLegacy.parse(stored);
  const levels = levelsOf(parsed.levels);
  const offerSeed = parsed.offerSeed ?? fresh.offerSeed;
  return {
    generation: parsed.generation ?? fresh.generation,
    heir: parsed.heir ?? fresh.heir,
    night: parsed.night ?? fresh.night,
    bestNight: parsed.bestNight ?? fresh.bestNight,
    oil: parsed.oil ?? fresh.oil,
    levels,
    offerSeed,
    offers: parsed.offers ? [...new Set(parsed.offers)].slice(0, OFFER_COUNT) : drawOffers(offerSeed, levels),
    tide: parsed.tide ?? fresh.tide,
    fallen: parsed.fallen ?? fresh.fallen,
  };
}

const KEY = "lampwarden:legacy:v1";
export function loadLegacy(): Legacy {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return parseLegacy(JSON.parse(raw));
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
