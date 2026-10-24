// What the unsafe, measurement-only in-process renderers (direct, node-vm) share, and the helpers the measurements and
// probes use on the committed sprite scripts: the list of those scripts, which the renderers with no isolation are limited
// to, and the type strip that turns their TypeScript annotations into the plain JavaScript QuickJS runs. Turning a run's pixels
// into a RenderResult is render-finish.ts; running a build in QuickJS is quickjs-core.ts.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { HERO_ANIMATIONS, SEXES } from "../src/scene/assets";
import { heroFrameBuilds } from "./hero-animation";
import { prepareBuild } from "./quickjs-core";

// Bun runs the source in place. For Node the harness bundles the pipeline first and points this variable at pipeline/.
const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");

/**
 * A committed sprite script as the plain JavaScript QuickJS runs. The hand-written scripts in public/sprites carry
 * TypeScript annotations (`export function build(k: Kit)`); model-written builds are plain JavaScript, and the server and
 * the browser run them as they are. Bun's transpiler strips the types under Bun, `node:module` under Node 24.
 */
export function plainJavaScript(code: string): string {
  const withoutExport = prepareBuild(code);
  if (process.versions.bun) return new Bun.Transpiler({ loader: "ts" }).transformSync(withoutExport);
  return nodeModule.stripTypeScriptTypes(withoutExport, { mode: "strip" });
}

let committedScriptHashes: Set<string> | undefined;

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * True when `code` is byte-for-byte one of the scripts committed in this repository: the `public/sprites/*.ts` builders
 * and the generated hero frame builds. The renderers that run build code with no isolation at all (direct) refuse
 * anything else, so model output cannot reach them by accident.
 */
export function isCommittedSpriteScript(code: string): boolean {
  if (!committedScriptHashes) {
    committedScriptHashes = new Set();
    for (const file of readdirSync(SPRITES_DIRECTORY))
      if (file.endsWith(".ts"))
        committedScriptHashes.add(sha256Of(readFileSync(join(SPRITES_DIRECTORY, file), "utf8")));
    for (const sex of SEXES)
      for (const animation of HERO_ANIMATIONS)
        for (const frame of heroFrameBuilds(sex, animation)) committedScriptHashes.add(sha256Of(frame.code));
  }
  return committedScriptHashes.has(sha256Of(code));
}
