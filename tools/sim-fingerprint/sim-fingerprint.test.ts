import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SIM_FINGERPRINT } from "../../src/game/plays";
import { SIM_SOURCES, simFingerprint } from "./sim-fingerprint";

const repository = resolve(import.meta.dir, "../..");

// A copy of the sim sources in a temporary directory, so a test can edit them.
function withCopy(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "lampwarden-fingerprint-"));
  try {
    for (const source of SIM_SOURCES) {
      mkdirSync(dirname(join(root, source)), { recursive: true });
      cpSync(join(repository, source), join(root, source));
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Packages the sim may import. They are not hashed: a version bump that changed how a recorded decision or creature
// parses would not change the fingerprint, so keep this list to libraries that only validate.
const SIM_PACKAGES = new Set(["zod"]);

// The repository modules a file imports as values (an `import type` and a clause of only `type` names are erased),
// whether relative or through the `@/` alias (tsconfig.json paths).
function importedAtRuntime(file: string): string[] {
  const source = readFileSync(join(repository, file), "utf8");
  const imported: string[] = [];
  // The closure is only as good as this reading of the imports, so a form it cannot follow fails the test.
  expect(source, `${file}: a side-effect import`).not.toMatch(/^import\s+["']/m);
  expect(source, `${file}: a dynamic import`).not.toMatch(/\bimport\(/);
  expect(source, `${file}: a require`).not.toMatch(/\brequire\(/);
  expect(source, `${file}: an import with attributes`).not.toMatch(/^(?:import|export)\b[^;]*\bwith\s*\{/m);
  for (const [, typeOnly, clause = "", specifier = ""] of source.matchAll(
    /^(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["'];/gm,
  )) {
    const names = clause
      .replace(/[{}]/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (typeOnly || names.every((name) => name.startsWith("type "))) continue;
    if (specifier.startsWith(".")) imported.push(join(dirname(file), `${specifier}.ts`));
    else if (specifier.startsWith("@/")) imported.push(join("src", `${specifier.slice(2)}.ts`));
    else expect(SIM_PACKAGES.has(specifier), `${file}: imports the package ${specifier}`).toBe(true);
  }
  return imported;
}

describe("the sim fingerprint", () => {
  test("is a short hex hash, the same for unchanged sources", () => {
    const first = simFingerprint(repository);
    expect(first).toMatch(SIM_FINGERPRINT);
    expect(simFingerprint(repository)).toBe(first);
  });

  test("changes when a source that decides a night changes", () => {
    withCopy((root) => {
      const before = simFingerprint(root);
      const sim = join(root, "src/game/sim.ts");
      writeFileSync(sim, `${readFileSync(sim, "utf8")}\nexport const MONSTER_BITE_HARDER = 1;\n`);
      expect(simFingerprint(root)).not.toBe(before);
    });
  });

  test("keeps its value when a file outside the sim changes or is added", () => {
    withCopy((root) => {
      const before = simFingerprint(root);
      writeFileSync(join(root, "README.md"), "# nothing the sim reads\n");
      writeFileSync(join(root, "src/game/recording.ts"), "export const recording = 1;\n");
      expect(simFingerprint(root)).toBe(before);
    });
  });

  test("does not depend on line endings", () => {
    withCopy((root) => {
      const before = simFingerprint(root);
      const random = join(root, "src/game/random.ts");
      writeFileSync(random, readFileSync(random, "utf8").replaceAll("\n", "\r\n"));
      expect(simFingerprint(root)).toBe(before);
    });
  });

  // The list must be what the sim really imports, or a change to a file that decides a night would go unnoticed.
  test("covers exactly the modules step(), newNight() and the replay driver import", () => {
    const closure = new Set<string>();
    const visit = (file: string) => {
      if (closure.has(file)) return;
      closure.add(file);
      for (const imported of importedAtRuntime(file)) visit(imported);
    };
    visit("src/game/sim.ts");
    visit("src/game/replay.ts");
    expect([...closure].sort()).toEqual([...SIM_SOURCES].sort());
  });
});
