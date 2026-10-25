// Checks on model-written build code before any renderer sees it.

// A tripwire, not a sandbox: string-built names (`this['pro'+'cess']`) get past it. The renderers are the boundary
// (an allowlisted environment locally, a sandbox elsewhere); this rejects the obvious attempts early and cheaply.
const BANNED_IDENTIFIERS = /\b(import|require|process|Bun|fetch|eval|Function|globalThis|XMLHttpRequest|Deno)\b/;

function bannedIdentifierIn(code: string): string | null {
  return BANNED_IDENTIFIERS.exec(code)?.[0] ?? null;
}

/** Why the code must not be rendered, or null when it may. */
export function rejectionReason(code: string): string | null {
  const banned = bannedIdentifierIn(code);
  if (banned) {
    return `rejected: banned identifier ${banned}`;
  }
  if (!code.includes("function build")) {
    return "no function build(k) found";
  }
  return null;
}
