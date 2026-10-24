// The command line's file-backed store for the sprite loop: call rows appended to pipeline/runs/run.jsonl, every
// attempt kept under pipeline/runs/work, and the winner written to public/sprites with its manifest row. A Vercel
// function uses none of this (its filesystem is read-only); it gives the loop its own store.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LoopOutcome, LoopStore } from "./loop";

export function createFileStore(paths: { workDirectory: string; logPath: string }): LoopStore {
  mkdirSync(paths.workDirectory, { recursive: true });
  return {
    logCall(row) {
      mkdirSync(dirname(paths.logPath), { recursive: true });
      appendFileSync(paths.logPath, `${JSON.stringify(row)}\n`);
    },
    saveAttemptCode(name, code) {
      mkdirSync(paths.workDirectory, { recursive: true });
      writeFileSync(join(paths.workDirectory, `${name}.ts`), `${code}\n`);
    },
    saveAttemptPng(name, png) {
      writeFileSync(join(paths.workDirectory, `${name}.png`), png);
    },
  };
}

const manifestSchema = z.record(z.string(), z.unknown());
const spritesSchema = z.record(z.string(), z.unknown());

function writeManifestRow(outputDirectory: string, spriteName: string, entry: Record<string, unknown>): void {
  const manifestPath = join(outputDirectory, "manifest.json");
  // the manifest has other keys (setting, note) that stay where they are
  const manifest = existsSync(manifestPath)
    ? manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")))
    : { sprites: {} };
  manifest.sprites = { ...spritesSchema.parse(manifest.sprites ?? {}), [spriteName]: entry };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

/**
 * Writes the winning PNG, its build code and its manifest row to the output directory. `extraFields` are manifest keys
 * the caller knows and the loop does not (where the sprite came from, its measured anchor); they follow `code`.
 */
export function writeSpriteOutputs(
  outputDirectory: string,
  spriteName: string,
  outcome: LoopOutcome,
  extraFields: Record<string, unknown> = {},
): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, `${spriteName}.png`), outcome.winner.png);
  writeFileSync(join(outputDirectory, `${spriteName}.ts`), `${outcome.winner.code}\n`);
  const { id: _id, brief, ...rowFields } = outcome.row;
  writeManifestRow(outputDirectory, spriteName, {
    brief,
    file: `${spriteName}.png`,
    code: `${spriteName}.ts`,
    ...extraFields,
    ...rowFields,
  });
}
