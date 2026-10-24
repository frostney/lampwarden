// A creature's sprite is delivered as the code that draws it, and the player's device runs that code. This is the check
// that makes that safe to rely on: the code is hashed before it is run and the pixels it draws are hashed afterwards,
// and both must be the ones the server judged (the hashes in the record, src/game/creature.ts). Anything else, a stale
// blob, a swapped one, a kit that has moved on, a render that failed, is no creature that night, never a different one.
// The running of the code is injected (src/scene/creature-render.ts runs it in a Web Worker), so this is tested with
// plain functions.
import type { Creature } from "./creature";

/** A sprite is a 128 x 128 frame of RGBA pixels. */
export const CREATURE_PIXEL_BYTES = 128 * 128 * 4;

/** SHA-256 as lowercase hex, from Web Crypto (a secure context in a browser: https or localhost). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data); // a copy: Web Crypto wants a plain ArrayBuffer
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface CreatureCodeSource {
  /** The creature's build code as text, or null when it could not be had. `fresh` skips any cached copy. */
  fetchCode(creatureId: string, fresh?: boolean): Promise<string | null>;
  /** Runs the code and returns the sprite's RGBA pixels, or null when it failed or ran out of time. */
  draw(code: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * EXPERIMENT (direct execution, creature-signing.ts): whether the server vouches for this record. When present it is
   * asked before anything is fetched; a creature it refuses is neither fetched nor run.
   */
  authentic?(creature: Pick<Creature, "id" | "build">): Promise<boolean>;
}

/**
 * The creature's sprite pixels, or null. A creature without `build` (drawn before code was delivered) has none here.
 * The code is run only when its hash is the record's, and the pixels are returned only when theirs is.
 */
export async function drawCreature(
  creature: Pick<Creature, "id" | "build">,
  source: CreatureCodeSource,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const { build } = creature;
  if (!build) return null;
  try {
    // the signature covers the id and both hashes, so it is checked first: an unvouched record's code is not even fetched
    if (source.authentic && !(await source.authentic(creature))) return null;
    let code = await source.fetchCode(creature.id);
    if (code !== null && (await sha256Hex(code)) !== build.codeSha256) {
      // the route is cached for good, so a truncated or stale copy would stay in the HTTP cache: ask once for a fresh one
      code = await source.fetchCode(creature.id, true);
      if (code !== null && (await sha256Hex(code)) !== build.codeSha256) return null;
    }
    if (code === null) return null;
    const pixels = await source.draw(code);
    if (!pixels || pixels.length !== CREATURE_PIXEL_BYTES) return null;
    return (await sha256Hex(pixels)) === build.pixelsSha256 ? pixels : null;
  } catch {
    return null;
  }
}
