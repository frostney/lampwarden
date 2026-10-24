// What the in-process renderers (render-inprocess-*.ts) share: turning the kit and a build script into plain JavaScript,
// the script that runs a build and hands back its pixels, and turning those pixels into the result the Renderer
// contract promises. This is a measurement spike (docs/LIVE_GENERATION.md, "In-process rendering"); none of it is
// reachable from `renderers.ts` or `run.ts`.
//
// The kit is a single TypeScript file with no imports, so it needs no bundler: types are stripped (Bun's transpiler under
// Bun, `node:module` under Node), `export` is dropped from its declarations and the exported names are returned from a
// function. The same prepared source feeds every mode, so the modes differ in where the code runs and nothing else.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { HERO_ANIMATIONS, SEXES } from "../src/scene/assets";
import { heroFrameBuilds } from "./hero-animation";
import { type RenderResult, type RenderStats, renderStatsSchema } from "./render-types";

// Bun runs the source in place. For Node the harness bundles the pipeline first and points this variable at pipeline/.
const PIPELINE_DIRECTORY = process.env.LAMPWARDEN_PIPELINE_DIRECTORY ?? import.meta.dirname;
const KIT_PATH = join(PIPELINE_DIRECTORY, "kit", "kit.ts");
const SPRITES_DIRECTORY = join(PIPELINE_DIRECTORY, "..", "public", "sprites");
const IDENTIFIER = /^[A-Za-z_]\w*$/;

export const SPRITE_SIZE = 128;
export const SPRITE_PIXEL_BYTES = SPRITE_SIZE * SPRITE_SIZE * 4;
/** The stats line is a few hundred bytes; anything much longer is a build trying to make the host copy a lot. */
export const MAXIMUM_STATS_CHARACTERS = 4096;

export interface PreparedKit {
  /** SHA-256 of `kit/kit.ts`, the cache key. */
  sha256: string;
  /** Every name the kit exports, in source order; build code may call any of them. */
  names: string[];
  /** The kit as statements: no types, no `export`. */
  body: string;
}

let preparedKit: PreparedKit | undefined;

/** Removes TypeScript types from source text. Bun and Node 24 both do this natively; the output keeps `export`. */
export function stripTypes(source: string): string {
  if (process.versions.bun) return new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  return nodeModule.stripTypeScriptTypes(source, { mode: "strip" });
}

/**
 * The kit as plain JavaScript, memoised per process. When LAMPWARDEN_KIT_CACHE_DIRECTORY is set the prepared body is also
 * kept on disk under the kit's hash, so a cold process skips the type stripping (a deployment would do this once, at
 * build time).
 */
export function prepareKit(): PreparedKit {
  if (preparedKit) return preparedKit;
  const cacheDirectory = process.env.LAMPWARDEN_KIT_CACHE_DIRECTORY;
  const source = readFileSync(KIT_PATH, "utf8");
  const sha256 = createHash("sha256").update(source).digest("hex");
  const cachePath = cacheDirectory ? join(cacheDirectory, `kit-${sha256.slice(0, 16)}.js`) : undefined;
  let body: string | undefined;
  if (cachePath && existsSync(cachePath)) body = readFileSync(cachePath, "utf8");
  if (body === undefined) {
    body = stripTypes(source).replace(/^export\s+/gm, "");
    if (cachePath && cacheDirectory) {
      mkdirSync(cacheDirectory, { recursive: true });
      const partialPath = `${cachePath}.${process.pid}.partial`;
      writeFileSync(partialPath, body);
      renameSync(partialPath, cachePath);
    }
  }
  const names = [...source.matchAll(/^export (?:const|let|function|class) (\w+)/gm)].map((match) => match[1] ?? "");
  preparedKit = { sha256, names: names.filter((name) => IDENTIFIER.test(name)), body };
  return preparedKit;
}

/** The kit as one script that defines `__kit` (an object holding every export) in the global scope it runs in. */
export function kitScript(kit: PreparedKit): string {
  return `var __kit = (function () {\n${kit.body}\nreturn { ${kit.names.join(", ")} };\n})();\n`;
}

/** The build script as plain JavaScript with its leading `export` removed, the way `render/run_local.ts` does. */
export function prepareBuild(code: string): string {
  const withoutExport = code.replace(/^\s*export\s+/m, "");
  return stripTypes(withoutExport).replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
}

/**
 * The script that runs one build against `__kit` and evaluates to `{ stats, pixels }`: `stats` is a JSON string and
 * `pixels` an ArrayBuffer of the 128 px RGBA sprite. Every kit export is a parameter of the build's wrapper function, so
 * build code calls `hero(k, ...)` unqualified, as it does under `run_local.ts`.
 */
export function runScript(kit: PreparedKit, buildBody: string, pose: string): string {
  const parameters = [...kit.names, "POSE"].join(", ");
  const kitArguments = kit.names.map((name) => `__kit.${name}`).join(", ");
  return [
    "(function () {",
    `  const build = (function (${parameters}) {\n${buildBody}\nreturn build;\n})(${kitArguments}, ${JSON.stringify(pose)});`,
    "  const kit = new __kit.Kit();",
    "  build(kit);",
    "  const result = __kit.post(kit.render());",
    "  return {",
    "    stats: JSON.stringify(Object.assign({ fit: kit.fit, snapped: kit.snapped, dropped: kit.dropped }, result.stats)),",
    "    pixels: new Uint8Array(result.rgba).buffer,",
    "  };",
    "})()",
  ].join("\n");
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

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, contents: Uint8Array): Buffer {
  const typeAndContents = Buffer.concat([Buffer.from(type, "latin1"), contents]);
  const framed = Buffer.alloc(typeAndContents.length + 8);
  framed.writeUInt32BE(contents.length, 0);
  framed.set(typeAndContents, 4);
  framed.writeUInt32BE(crc32(typeAndContents), typeAndContents.length + 4);
  return framed;
}

/** The 128 px RGBA sprite as PNG bytes, encoded the way `render/shim_canvas.ts` does (no row filter, default deflate). */
export function encodeSpritePng(pixels: Uint8Array): Buffer {
  if (pixels.length !== SPRITE_PIXEL_BYTES) throw new Error(`expected ${SPRITE_PIXEL_BYTES} pixel bytes`);
  const stride = SPRITE_SIZE * 4;
  const rows = Buffer.alloc((stride + 1) * SPRITE_SIZE);
  for (let row = 0; row < SPRITE_SIZE; row++)
    rows.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SPRITE_SIZE, 0);
  header.writeUInt32BE(SPRITE_SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Turns what a runner handed back (a stats JSON string and a pixel buffer, both written by code that may be hostile)
 * into a RenderResult. Checks the sizes first so a build cannot make the host copy or parse something large.
 */
export function finishRender(name: string, milliseconds: number, statsJson: unknown, pixels: unknown): RenderResult {
  if (typeof statsJson !== "string" || statsJson.length > MAXIMUM_STATS_CHARACTERS)
    return { ok: false, error: "render returned no usable stats" };
  if (!(pixels instanceof Uint8Array) || pixels.length !== SPRITE_PIXEL_BYTES)
    return { ok: false, error: "render returned no usable pixels" };
  let stats: RenderStats;
  try {
    stats = renderStatsSchema.parse({ ...JSON.parse(statsJson), name, ms: Math.round(milliseconds) });
  } catch {
    return { ok: false, error: "render returned malformed stats" };
  }
  return { ok: true, stats, png: encodeSpritePng(pixels) };
}

/** `${name}: ${message}` for whatever a runner threw, capped like every other renderer's error. */
export function errorSummary(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
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
