// The game's seeded random numbers (mulberry32). One step is a pure function of the seed, so the sim keeps the seed in
// its state and the shop keeps one in the legacy: both replay exactly from what they stored.
const MULBERRY_STEP = 0x6d2b79f5; // the generator's Weyl increment
/** How many unsigned 32-bit values there are: a random value in [0, 1) times this is a seed. */
export const UINT32_RANGE = 4_294_967_296;

export function nextRandom(seed: number): { seed: number; value: number } {
  const next = (seed + MULBERRY_STEP) | 0;
  let mixed = Math.imul(next ^ (next >>> 15), next | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return { seed: next, value: ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE };
}
