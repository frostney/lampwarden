// Walkthrough recorder: turns a short script of segments into the narrated, subtitled video a pull request carries.
// Each segment is footage of the real game, captured frame by frame with the page clock stepped at 30 fps (so it is
// deterministic and never drops frames), or a still image. Every segment gets a Tiny5 caption band above it and its
// caption read aloud (macOS `say`, else `espeak-ng`); footage holds its last frame until the narration ends.
//
// usage: bun run build && bun run start &   then   bun run walkthrough -- <script.ts> [--url <url>] [--out <dir>] [--headed]
//   --url replaces the script's url (a server on another port)
//   <out>/walkthrough.mp4   the video (1920x1400: a 200 px caption band over 1920x1200 footage)
//   <out>/stills/<id>.png   the last frame of each footage segment, for the pull request's stills
//   <out>/check.png         the middle and end of every segment, to look at before attaching the video
// Needs ffmpeg, ffprobe and a speech synthesiser: macOS `say`, or `espeak-ng` elsewhere. A script is a module whose default export is a Walkthrough, e.g.
// e2e/walkthroughs/title.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "playwright";

export interface Walkthrough {
  url: string; // the page the first footage segment loads
  voice?: string; // a macOS `say` voice; Daniel by default (espeak-ng always reads in British English)
  segments: Segment[];
}

interface SegmentBase {
  id: string; // file names and the stills: lowercase words and dashes
  caption: string; // shown in the band and read aloud
}

/** Footage of the game. The page is 960x600 CSS pixels at 2x, so frames are 1920x1200. */
export interface FootageSegment extends SegmentBase {
  // Load this page fresh, with empty local storage. Without it the segment carries on from the previous one's page
  // (the first footage segment always loads, from `url` or the walkthrough's url).
  url?: string;
  waitFor?: string; // after a fresh load, a selector to wait for before the clock is paused
  setup?: (page: Page) => Promise<void>; // runs with the clock paused, before the first frame
  actions?: { at: number; run: (page: Page) => Promise<void> }[]; // at: seconds into the segment
  seconds: number; // footage length
  skipFrames?: number; // frames dropped from the start, e.g. a first paint before the scene has drawn
}

/** A still image (e.g. a before/after composite), letterboxed into the frame. */
export interface StillSegment extends SegmentBase {
  image: string;
}

export type Segment = FootageSegment | StillSegment;

const FRAMES_PER_SECOND = 30;
const VIEWPORT = { width: 960, height: 600 };
const SCALE = 2;
const WIDTH = VIEWPORT.width * SCALE;
const HEIGHT = VIEWPORT.height * SCALE;
const BAND_HEIGHT = 200;
const NARRATION_TAIL = 0.6; // seconds of quiet after each line
const MILLISECOND_DIGITS = 3; // ffmpeg takes a duration in seconds to the millisecond
const MILLISECONDS_PER_SECOND = 1000;
const FRAME_NAME_DIGITS = 4; // frames are 0000.png, 0001.png, ...
// a pause that lands in the past is tried again this much further ahead each time, this many times
const PAUSE_RETRY = { stepMilliseconds: 50, attempts: 5 };
// the check sheet samples each segment in its middle and just before its end, at this size
const SAMPLE = { width: 960, height: 700, beforeEnd: 0.05 };
const BACKGROUND = "#0b1424";
const FONT = resolve(import.meta.dir, "../src/app/fonts/tiny5/Tiny5.ttf");

const run = (command: string, ...commandArguments: string[]) =>
  execFileSync(command, commandArguments, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ffmpeg = (...commandArguments: string[]) => run("ffmpeg", "-loglevel", "error", "-y", ...commandArguments);
const durationOf = (path: string) =>
  Number(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).trim());
const isStill = (segment: Segment): segment is StillSegment => "image" in segment;

const onPath = (tool: string) => spawnSync("which", [tool], { stdio: "ignore" }).status === 0;

type Speaker = (text: string, voice: string | undefined, directory: string, id: string) => string;

// macOS `say` where there is one, else espeak-ng; either writes a file that ffmpeg reads
function requireTools(): Speaker {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (!onPath(tool)) {
      throw new Error(`walkthrough needs ${tool} on PATH`);
    }
  }
  if (onPath("say")) {
    return (text, voice, directory, id) => {
      const narration = join(directory, `${id}.aiff`);
      run("say", "-v", voice ?? "Daniel", "-o", narration, text);
      return narration;
    };
  }
  if (onPath("espeak-ng")) {
    return (text, _voice, directory, id) => {
      const narration = join(directory, `${id}.wav`);
      run("espeak-ng", "-v", "en-gb", "-s", "160", "-w", narration, text);
      return narration;
    };
  }
  throw new Error("walkthrough needs macOS `say` or espeak-ng on PATH");
}

// the caption band, rendered from an HTML file (a file:// page can load the font; about:blank cannot)
async function renderCaption(page: Page, text: string, directory: string, id: string) {
  const html = join(directory, `${id}-caption.html`);
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  writeFileSync(
    html,
    `<!doctype html><style>
      @font-face { font-family: Tiny5; src: url(${pathToFileURL(FONT).href}); }
      html, body { margin: 0; background: ${BACKGROUND}; }
      .caption { position: absolute; inset: 22px 80px; display: flex; align-items: center; justify-content: center;
        padding: 0 24px; border: 3px solid #f2c14e; color: #f4ecd8; font: 40px/1.35 Tiny5; text-align: center;
        -webkit-font-smoothing: none; background: ${BACKGROUND}; }
    </style><div class="caption">${escaped}</div>`,
  );
  await page.goto(pathToFileURL(html).href);
  const loaded = await page.evaluate(async () => {
    await document.fonts.load("40px Tiny5");
    return document.fonts.check("40px Tiny5");
  });
  if (!loaded) {
    throw new Error(`Tiny5 did not load for the caption of ${id}`);
  }
  const path = join(directory, `${id}-caption.png`);
  await page.screenshot({ path });
  return path;
}

// The page clock keeps running between reading it and pausing it, so on a busy machine the pause can land in the past
// ("Cannot fast-forward to the past"); try again a little further ahead.
async function pauseClock(page: Page) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + PAUSE_RETRY.stepMilliseconds * attempt);
      return;
    } catch (error) {
      if (attempt >= PAUSE_RETRY.attempts || !String(error).includes("to the past")) {
        throw error;
      }
    }
  }
}

async function captureFootage(page: Page, segment: FootageSegment, directory: string) {
  const frameDirectory = join(directory, segment.id);
  rmSync(frameDirectory, { recursive: true, force: true });
  mkdirSync(frameDirectory, { recursive: true });
  await segment.setup?.(page);
  const pending = [...(segment.actions ?? [])].sort((first, second) => first.at - second.at);
  const frameCount = Math.round(segment.seconds * FRAMES_PER_SECOND);
  const skip = segment.skipFrames ?? 0;
  for (let frame = 0; frame < frameCount + skip; frame++) {
    while (pending[0] && pending[0].at * FRAMES_PER_SECOND <= frame - skip) {
      await pending.shift()?.run(page);
    }
    if (frame >= skip) {
      const name = String(frame - skip).padStart(FRAME_NAME_DIGITS, "0");
      await page.screenshot({ path: join(frameDirectory, `${name}.png`) });
    }
    await page.clock.runFor(MILLISECONDS_PER_SECOND / FRAMES_PER_SECOND);
  }
  return frameDirectory;
}

// one segment as an mp4: caption band over the footage or still, narration padded to the segment's length
function assembleSegment(input: string[], caption: string, narration: string, duration: number, output: string) {
  const seconds = duration.toFixed(MILLISECOND_DIGITS);
  ffmpeg(
    ...input,
    "-i",
    caption,
    "-i",
    narration,
    "-filter_complex",
    [
      `[0:v]fps=${FRAMES_PER_SECOND},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,`,
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND},`,
      `tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},setsar=1[footage];`,
      `[1:v]loop=-1:1,trim=duration=${seconds},setsar=1[band];`,
      "[band][footage]vstack,format=yuv420p[video];",
      `[2:a]aresample=48000,apad,atrim=duration=${seconds}[audio]`,
    ].join(""),
    ...["-map", "[video]", "-map", "[audio]", "-r", String(FRAMES_PER_SECOND)],
    ...["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-c:a", "aac", "-b:a", "160k", output],
  );
}

// the middle and last frame of every segment, two to a row
function checkSheet(segments: { path: string; duration: number }[], output: string, directory: string) {
  const samples: string[] = [];
  for (const [index, segment] of segments.entries()) {
    for (const [position, seconds] of [segment.duration / 2, segment.duration - SAMPLE.beforeEnd].entries()) {
      const sample = join(directory, `check-${index}-${position}.png`);
      const scale = `scale=${SAMPLE.width}:${SAMPLE.height}`;
      ffmpeg("-ss", seconds.toFixed(MILLISECOND_DIGITS), "-i", segment.path, "-frames:v", "1", "-vf", scale, sample);
      samples.push(sample);
    }
  }
  const layout = samples
    .map((_, index) => `${(index % 2) * SAMPLE.width}_${Math.floor(index / 2) * SAMPLE.height}`)
    .join("|");
  ffmpeg(
    ...samples.flatMap((sample) => ["-i", sample]),
    "-filter_complex",
    `xstack=inputs=${samples.length}:layout=${layout}`,
    output,
  );
}

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

// A footage segment: its frames, for as long as it runs or its caption is spoken, whichever is longer. Its last frame is
// kept in `stillsDirectory` for the pull request's before and after shots.
function footagePart(
  segment: FootageSegment,
  frames: string,
  made: { caption: string; narration: string; spoken: number; output: string; stillsDirectory: string },
) {
  const names = readdirSync(frames).sort();
  const last = names.at(-1);
  if (last) {
    copyFileSync(join(frames, last), join(made.stillsDirectory, `${segment.id}.png`));
  }
  const duration = Math.max(segment.seconds, made.spoken);
  assembleSegment(
    ["-framerate", "30", "-i", join(frames, "%04d.png")],
    made.caption,
    made.narration,
    duration,
    made.output,
  );
  console.log(`${segment.id}: ${names.length} frames, ${duration.toFixed(1)} s`);
  return { path: made.output, duration };
}

// A still segment: its image held for as long as its caption is spoken.
function stillPart(segment: StillSegment, caption: string, narration: string, spoken: number, output: string) {
  const image = resolve(segment.image);
  if (!existsSync(image)) {
    throw new Error(`no image at ${image}`);
  }
  assembleSegment(
    ["-loop", "1", "-framerate", "30", "-t", spoken.toFixed(MILLISECOND_DIGITS), "-i", image],
    caption,
    narration,
    spoken,
    output,
  );
  console.log(`${segment.id}: still, ${spoken.toFixed(1)} s`);
  return { path: output, duration: spoken };
}

// Opens the game afresh at `url` with a clean save and the clock held, once `waitFor` (if given) is on the page.
async function openGame(gamePage: Page, url: string, waitFor: string | undefined) {
  await gamePage.clock.install();
  await gamePage.goto(url);
  await gamePage.evaluate(() => localStorage.clear());
  await gamePage.reload();
  if (waitFor) {
    await gamePage.waitForSelector(waitFor);
  }
  await pauseClock(gamePage);
}

async function main() {
  const scriptPath = process.argv.slice(2).find((value) => value.endsWith(".ts") || value.endsWith(".mjs"));
  if (!scriptPath) {
    throw new Error("usage: bun run walkthrough -- <script.ts> [--url <url>] [--out <dir>] [--headed]");
  }
  const speak = requireTools();
  const script: Walkthrough = (await import(resolve(scriptPath))).default;
  const walkthrough = { ...script, url: argument("--url") ?? script.url };
  const outDirectory = resolve(argument("--out") ?? "walkthrough-out");
  const workDirectory = join(outDirectory, "work");
  const stillsDirectory = join(outDirectory, "stills");
  for (const directory of [workDirectory, stillsDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  const ids = walkthrough.segments.map((segment) => segment.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("segment ids must be unique");
  }

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const captionPage = await browser.newPage({ viewport: { width: WIDTH, height: BAND_HEIGHT } });
  const gamePage = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  gamePage.on("pageerror", (error) => console.log(`page error: ${error}`));
  let loaded = false;
  const parts: { path: string; duration: number }[] = [];
  try {
    for (const segment of walkthrough.segments) {
      const caption = await renderCaption(captionPage, segment.caption, workDirectory, segment.id);
      const narration = speak(segment.caption, walkthrough.voice, workDirectory, segment.id);
      const spoken = durationOf(narration) + NARRATION_TAIL;
      const output = join(workDirectory, `${segment.id}.mp4`);
      if (isStill(segment)) {
        parts.push(stillPart(segment, caption, narration, spoken, output));
        continue;
      }
      if (segment.url || !loaded) {
        await openGame(gamePage, segment.url ?? walkthrough.url, segment.waitFor);
        loaded = true;
      }
      const frames = await captureFootage(gamePage, segment, workDirectory);
      parts.push(footagePart(segment, frames, { caption, narration, spoken, output, stillsDirectory }));
    }
  } finally {
    await browser.close();
  }

  const list = join(workDirectory, "segments.txt");
  writeFileSync(list, parts.map((part) => `file '${part.path}'\n`).join(""));
  const video = join(outDirectory, "walkthrough.mp4");
  ffmpeg("-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video);
  checkSheet(parts, join(outDirectory, "check.png"), workDirectory);
  // volumedetect reports on stderr; a silent track would read about -91 dB
  const volume = spawnSync("ffmpeg", ["-i", video, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const meanVolume = volume.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1] ?? "unknown";
  console.log(`${video}: ${durationOf(video).toFixed(1)} s, mean volume ${meanVolume} dB`);
  console.log(`look at ${join(outDirectory, "check.png")} before attaching it`);
}

await main();
