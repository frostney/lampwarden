// The plain-JavaScript half of running a build: the kit as one script, the build with its `export` removed, and the seeded
// `Math.random`. No imports, so the QuickJS interpreter (quickjs-core.ts) and the browser's direct worker
// (src/scene/creature-direct-worker.ts), which has no interpreter to carry, share it.

export interface PreparedKit {
  /** SHA-256 of `kit/kit.ts`, the version of the kit these pixels come from. */
  sha256: string;
  /** Every name the kit exports, in source order; build code may call any of them. */
  names: string[];
  /** The kit as statements: no types, no `export`. */
  body: string;
}

/** The kit as one script that defines `__kit` (an object holding every export) in the global scope it runs in. */
export function kitScript(kit: PreparedKit): string {
  return `var __kit = (function () {\n${kit.body}\nreturn { ${kit.names.join(", ")} };\n})();\n`;
}

/**
 * The build script without its leading `export`, the way `render/run_local.ts` does. Build code is plain JavaScript
 * (that is what the generator writes and what the committed sprite scripts are); a type annotation is a syntax error.
 */
export function prepareBuild(code: string): string {
  return code.replace(/^\s*export\s+/m, "").replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
}

/** Replaces Math.random with a seeded generator, so a render never depends on entropy (the kit itself never calls it). */
export const DETERMINISM_PRELUDE = `(function () {
  var state = 0x9e3779b9;
  Math.random = function () {
    state = (state + 0x6d2b79f5) | 0;
    var mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
})();`;
