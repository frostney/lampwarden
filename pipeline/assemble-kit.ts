// Assembles pipeline/kit/kit.ts from pipeline/kit/src/*.ts: concatenates the parts, rewrites `(...) ** 2` to `sq(...)`
// (the kit avoids `**`, which is slower than plain multiplication) and asserts that no `**`, `==` or `!=` remain. It
// then writes pipeline/prepared-kit.ts, the same kit as plain JavaScript for QuickJS (prepare-kit.ts).
// usage: bun pipeline/assemble-kit.ts      (`bun run kit`)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { preparedKitModule, prepareKitSource } from "./prepare-kit";

const KIT_DIRECTORY = join(import.meta.dir, "kit");
const PARTS = [
  "kit_core",
  "kit_render",
  "kit_build",
  "kit_anat",
  "kit_beasts",
  "kit_props",
  "kit_buildings",
  "kit_figures",
  "kit_themes",
];
const SQUARE_SUFFIX = ") ** 2";

/** Replaces every `(expression) ** 2` with `sq(expression)`, finding the opening parenthesis by depth. */
function rewriteSquares(source: string): string {
  const pieces: string[] = [];
  let copiedUpTo = 0;
  for (;;) {
    const suffixStart = source.indexOf(SQUARE_SUFFIX, copiedUpTo);
    if (suffixStart < 0) {
      pieces.push(source.slice(copiedUpTo));
      return pieces.join("");
    }
    let depth = 0;
    let openingIndex = suffixStart;
    for (;;) {
      const character = source[openingIndex];
      if (character === ")") depth++;
      else if (character === "(") {
        depth--;
        if (depth === 0) break;
      }
      openingIndex--;
      if (openingIndex < 0) throw new Error(`no opening parenthesis for the square at offset ${suffixStart}`);
    }
    pieces.push(source.slice(copiedUpTo, openingIndex), `sq${source.slice(openingIndex, suffixStart + 1)}`);
    copiedUpTo = suffixStart + SQUARE_SUFFIX.length;
  }
}

const concatenated = PARTS.map((part) => readFileSync(join(KIT_DIRECTORY, "src", `${part}.ts`), "utf8")).join("");
const kit = rewriteSquares(concatenated).replace(
  "const clamp =",
  "const sq = (x: number): number => x * x;\nconst clamp =",
);
if (kit.includes("**")) throw new Error("kit still contains **");
if (kit.replaceAll("===", "").includes(" == ")) throw new Error("kit contains ==");
if (kit.replaceAll("!==", "").includes(" != ")) throw new Error("kit contains !=");
writeFileSync(join(KIT_DIRECTORY, "kit.ts"), kit);
writeFileSync(join(import.meta.dir, "prepared-kit.ts"), preparedKitModule(prepareKitSource(kit)));
