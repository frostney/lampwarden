// EXPERIMENT (docs/LIVE_GENERATION.md, "Direct execution in the browser (option E)"). With the creature's code run as plain
// JavaScript in the player's browser, anyone who can write the gallery (the Blob store) can make every player run their
// code. A signature closes that: the server signs the record's identity and hashes when it accepts a creature, with a
// private key that only the job has (CREATURE_SIGNING_KEY), and the browser verifies it against a public key built into
// its bundle before it runs anything. A record or code written to the store afterwards has no valid signature.
//
// Ed25519 through Web Crypto only, so the same module signs on the server and verifies in the browser. Keys travel as
// base64: the private key as PKCS#8, the public key as its 32 raw bytes.
import type { Creature } from "./creature";

type SignedBuild = Pick<NonNullable<Creature["build"]>, "codeSha256" | "pixelsSha256">;

const SIGNING_DOMAIN = "lampwarden-creature-v1";
const ED25519 = "Ed25519";

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

/** What is signed: the creature's id and both hashes, so a signature cannot be moved to another creature or another code. */
function signedMessage(id: string, build: SignedBuild): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${SIGNING_DOMAIN}\n${id}\n${build.codeSha256}\n${build.pixelsSha256}`);
}

/** A fresh key pair as base64 (PKCS#8 private, raw public). For the experiment's local keys and for tests. */
export async function generateSigningKeys(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"]);
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: toBase64(privateKey), publicKey: toBase64(publicKey) };
}

/** The base64 signature of a creature's id and hashes. The server calls this once, when it accepts the creature. */
export async function signBuild(privateKey: string, id: string, build: SignedBuild): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", fromBase64(privateKey), ED25519, false, ["sign"]);
  return toBase64(new Uint8Array(await crypto.subtle.sign(ED25519, key, signedMessage(id, build))));
}

/** Whether `signature` is the key's signature of this creature. Anything malformed is false, never a throw. */
export async function verifyBuild(
  publicKey: string,
  id: string,
  build: SignedBuild,
  signature: string | undefined,
): Promise<boolean> {
  if (signature === undefined) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(publicKey), ED25519, false, ["verify"]);
    return await crypto.subtle.verify(ED25519, key, fromBase64(signature), signedMessage(id, build));
  } catch {
    return false;
  }
}
