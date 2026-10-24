// The sim fingerprint: a short hash of the source files that decide how a night plays out. A recorded night replays
// exactly only on the sim it was played on, so each play records the fingerprint of the sim it ran on and the game
// refuses to replay one that differs (src/game/plays.ts, replaysExactlyOn).
//
// It is computed from the files' contents at build time (next.config.ts inlines it as NEXT_PUBLIC_SIM_FINGERPRINT) and
// by scripts/plays.ts, so it changes only when one of these files changes: a README-only commit keeps it. Any edit to
// one of them changes it, a comment included. That errs towards refusing a replay that would have been exact, never
// towards showing a wrong night.
//
// SIM_SOURCES is the value-import closure of step() and newNight() (src/game/sim.ts) and of the replay driver
// (src/game/replay.ts: the fixed step, quantise, Replayer, legacyOf, creatureOf); sim-fingerprint.test.ts derives that
// closure from the imports and fails when this list drifts from it:
//   sim.ts       the rules, the monsters, the step
//   random.ts    the seeded generator behind rand(state)
//   legacy.ts    levels, upgrades and traits, which newNight reads (replay.ts calls levelsOf)
//   creature.ts  a creature's stats from its archetype and modifiers, and the recorded subset the replay builds from
//   replay.ts    STEP, quantise, Replayer and the headless verification
//   assets.ts    FRAMES and FRAMES_PER_SECOND, which time the warden's animations inside the sim
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SIM_SOURCES = [
  "src/game/sim.ts",
  "src/game/random.ts",
  "src/game/legacy.ts",
  "src/game/creature.ts",
  "src/game/replay.ts",
  "src/scene/assets.ts",
] as const;

const FINGERPRINT_LENGTH = 12;

/** The fingerprint of `sources` (paths relative to `rootDirectory`): independent of order and of line endings. */
export function simFingerprint(rootDirectory: string, sources: readonly string[] = SIM_SOURCES): string {
  const hash = createHash("sha256");
  for (const source of [...sources].sort()) {
    const text = readFileSync(join(rootDirectory, source), "utf8").replaceAll("\r\n", "\n");
    hash.update(`${source}\0${text}\0`);
  }
  return hash.digest("hex").slice(0, FINGERPRINT_LENGTH);
}
