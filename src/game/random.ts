// The game's seeded random numbers (mulberry32). One step is a pure function of the seed, so the sim keeps the seed in
// its state and the shop keeps one in the legacy: both replay exactly from what they stored.
export function nextRandom(seed: number): { seed: number; value: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let mixed = Math.imul(next ^ (next >>> 15), next | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return { seed: next, value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296 };
}
