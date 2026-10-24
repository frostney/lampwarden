// Measures where the game's pixel scaling is cheapest and how it looks: Pixi at 1x with the browser's CSS pixelated
// upscale (A, what the game does), Pixi at the device resolution with no CSS upscale (B), and Pixi at the integer part
// of it with CSS doing the remainder (C). A change in the game's source is not needed: the harness switches the live
// renderer with app.renderer.resize(960, 600, resolution) through the window.lampwarden debug hook, which gives the
// same canvas a production build would have with that `resolution` (the scene makes no Text and no generated textures,
// so nothing else depends on it). It does not touch the game's behaviour.
//
// usage: bun run build && bun run start -- -p 3720 &
//        bun scripts/measure-pixel-scaling.mjs --url http://localhost:3720 [--profile desktop-2x,desktop-1.5x,phone-land,phone-port]
//                                              [--seconds 20] [--runs 3] [--out measure-out] [--looks-only]
// Headed browsers only (real GPU compositing). The run takes the shared screen lock /tmp/lw-screen.lock (it waits while
// another live process holds it) and removes it when done.
//
// Per profile it first plays a short night, pauses it and screenshots the stage in each mode (and the HUD alone, with the
// canvas hidden), diffs the shots, writes zoomed crops (measure-out/<profile>/shot-*.png, diff-A-*.png, crops.png: A | B |
// C left to right) and times a GPU-finished render (300 renders, each followed by a 1 px readback, so vsync is out of the
// picture). --looks-only stops there. Then for each mode and each
// repeat it plays a stick-driven night (a bot walks to the nearest dark lamp or monster, shoots, and keeps its health
// topped up so the night lasts) and records, over --seconds of it:
//   vsync     requestAnimationFrame deltas (mean, p95, p99, frames over 20 ms and over 33 ms per 1000) and the time
//             inside renderer.render() (the CPU side of the draw); Chromium also the CPU time of the browser, renderer
//             and GPU processes (SystemInfo.getProcessInfo), as a percentage of one core
//   uncapped  the same with vsync and the frame-rate limit off (Chromium flags), so frame time shows the cost of the work
//             instead of the display's 16.7 ms; Chromium only
//   synced    renderer.render() followed by gl.finish(), so the time includes the GPU finishing the draw
// A mode whose resolution equals another's is not run twice. Results go to <out>/results-<profiles>.json and are printed as
// markdown tables. WebKit here is Playwright's WebKit on macOS, not iOS Safari: its numbers are a proxy for a phone.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium, devices, webkit } from "playwright";
import { PixelImage } from "../tools/logo/image.ts";
import { encodePng } from "../tools/logo/png.ts";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const BASE_URL = argument("--url", "http://localhost:3720");
const SECONDS = Number(argument("--seconds", "20"));
const RUNS = Number(argument("--runs", "3"));
const OUT = argument("--out", "measure-out");
const PROFILES = {
  "desktop-2x": { engine: "chromium", context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  "desktop-1.5x": { engine: "chromium", context: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 } },
  "phone-land": { engine: "webkit", context: devices["iPhone 14 landscape"] },
  "phone-port": { engine: "webkit", context: devices["iPhone 14"] },
};
const LOOKS_ONLY = process.argv.includes("--looks-only");
const profileNames = argument("--profile", Object.keys(PROFILES).join(",")).split(",");
const UNCAPPED_FLAGS = ["--disable-frame-rate-limit", "--disable-gpu-vsync"];

// --- the shared screen lock -------------------------------------------------------------------------------------
const LOCK = "/tmp/lw-screen.lock";
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function takeScreenLock() {
  for (;;) {
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(LOCK, "utf8").trim());
    } catch {
      break; // no lock file
    }
    if (!Number.isInteger(holder) || !alive(holder)) break; // stale
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  writeFileSync(LOCK, String(process.pid));
}
function releaseScreenLock() {
  try {
    if (Number(readFileSync(LOCK, "utf8").trim()) === process.pid) rmSync(LOCK);
  } catch {}
}
process.on("exit", releaseScreenLock);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    releaseScreenLock();
    process.exit(130);
  });

// --- statistics ---------------------------------------------------------------------------------------------------
const mean = (numbers) => numbers.reduce((total, value) => total + value, 0) / (numbers.length || 1);
const percentile = (numbers, fraction) => {
  const sorted = [...numbers].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Number.NaN;
};
const fixed = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");

// --- in the page ----------------------------------------------------------------------------------------------------
/** Switches the live renderer to a mode. Returns what it set. */
const applyMode = (mode) => {
  const app = window.lampwarden.app();
  const rect = app.canvas.getBoundingClientRect();
  const deviceWidth = Math.round(rect.width * window.devicePixelRatio); // the canvas as the screen shows it
  const deviceScale = deviceWidth / 960;
  const resolution = mode === "A" ? 1 : mode === "B" ? deviceScale : Math.max(1, Math.floor(deviceScale));
  app.renderer.resize(960, 600, resolution);
  return {
    resolution,
    deviceScale,
    backing: [app.canvas.width, app.canvas.height],
    css: [rect.width, rect.height],
    renderer: app.renderer.name,
  };
};

/** Renders the scene `iterations` times, each followed by a 1 px readback so the GPU has finished it; returns ms per render. */
const benchRender = (iterations) => {
  const app = window.lampwarden.app();
  const renderer = app.renderer;
  const glContext = renderer.gl;
  const pixel = new Uint8Array(4);
  const start = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    renderer.render({ container: app.stage });
    glContext.readPixels(0, 0, 1, 1, glContext.RGBA, glContext.UNSIGNED_BYTE, pixel);
  }
  return (performance.now() - start) / iterations;
};

/** Plays the bot for `milliseconds` and returns the frame deltas and render times. */
const playBot = ({ milliseconds, syncGpu }) =>
  new Promise((resolve) => {
    const hook = window.lampwarden;
    const app = hook.app();
    const scene = hook.scene();
    const renderer = app.renderer;
    const original = renderer.render;
    const renderTimes = [];
    renderer.render = function (...renderArguments) {
      const start = performance.now();
      const result = original.apply(this, renderArguments);
      if (syncGpu) renderer.gl.finish();
      renderTimes.push(performance.now() - start);
      return result;
    };
    const deltas = [];
    let previous = 0;
    let lastSteer = -1000;
    let lastShot = 0;
    let lastMelee = 0;
    const begin = performance.now();
    const frame = (now) => {
      if (previous) deltas.push(now - previous);
      previous = now;
      const state = hook.state();
      if (state && !state.outcome) {
        if (now - lastSteer > 100) {
          lastSteer = now;
          const hero = state.hero;
          hero.health = hero.maxHealth; // keep the night going; this is a frame-time test, not a balance test
          const dark = state.lamps.filter((lamp) => !lamp.lit);
          const targets = dark.length ? dark : state.monsters.length ? state.monsters : [{ x: 480, y: 330 }];
          let best = targets[0];
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const target of targets) {
            const distance = Math.hypot(target.x - hero.x, (target.y - hero.y) * 2);
            if (distance < bestDistance) {
              best = target;
              bestDistance = distance;
            }
          }
          const reach = bestDistance > 24 ? 1 : 0;
          scene.stick(
            ((best.x - hero.x) / (bestDistance || 1)) * reach,
            (((best.y - hero.y) * 2) / (bestDistance || 1)) * reach,
          );
        }
        if (now - lastShot > 450) {
          lastShot = now;
          scene.press("ranged");
        }
        if (now - lastMelee > 700) {
          lastMelee = now;
          scene.press("melee");
        }
      }
      if (now - begin < milliseconds) requestAnimationFrame(frame);
      else {
        renderer.render = original;
        scene.stick(0, 0);
        resolve({ deltas, renderTimes, outcome: hook.state()?.outcome ?? null });
      }
    };
    requestAnimationFrame(frame);
  });

// --- the browser side -----------------------------------------------------------------------------------------------
async function processTimes(cdp) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const times = { browser: 0, renderer: 0, gpu: 0 };
  for (const process of processInfo) {
    if (process.type === "browser") times.browser += process.cpuTime;
    else if (process.type === "renderer") times.renderer += process.cpuTime;
    else if (process.type === "GPU") times.gpu += process.cpuTime;
  }
  return times;
}

async function startNight(page) {
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await page.getByRole("button", { name: "Light the lamps" }).click();
  await page.waitForSelector('[data-phase="night"]');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function modesFor(page) {
  const setups = {};
  for (const mode of ["A", "B", "C"]) setups[mode] = await page.evaluate(applyMode, mode);
  await page.evaluate(applyMode, "A");
  const distinct = [];
  const same = {};
  for (const mode of ["A", "B", "C"]) {
    const twin = distinct.find((other) => Math.abs(setups[other].resolution - setups[mode].resolution) < 1e-9);
    if (twin) same[mode] = twin;
    else distinct.push(mode);
  }
  return { setups, distinct, same };
}

async function measureOnce(browser, profile, mode, syncGpu) {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  const cdp = profile.engine === "chromium" ? await browser.newBrowserCDPSession() : null;
  try {
    await startNight(page);
    await page.evaluate(applyMode, mode);
    await sleep(2500); // warm-up: textures uploaded, the night under way
    const before = cdp ? await processTimes(cdp) : null;
    const start = performance.now();
    const result = await page.evaluate(playBot, { milliseconds: SECONDS * 1000, syncGpu });
    const seconds = (performance.now() - start) / 1000;
    const after = cdp ? await processTimes(cdp) : null;
    const cpu =
      after && before
        ? Object.fromEntries(Object.keys(after).map((key) => [key, ((after[key] - before[key]) / seconds) * 100]))
        : null;
    return { ...result, cpu };
  } finally {
    await context.close();
  }
}

// --- looks ---------------------------------------------------------------------------------------------------------
function differing(first, second) {
  let count = 0;
  let largest = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(first.data[index + channel] - second.data[index + channel]);
      if (difference) pixelDiffers = true;
      largest = Math.max(largest, difference);
    }
    if (pixelDiffers) count++;
  }
  return { count, largest, of: first.data.length / 4 };
}

/** The first shot dimmed, with every pixel that differs in the second shot painted magenta. */
function differenceMap(first, second) {
  const map = new PixelImage(first.width, first.height);
  for (let index = 0; index < first.data.length; index += 4) {
    const differs = [0, 1, 2].some((channel) => first.data[index + channel] !== second.data[index + channel]);
    if (differs) map.data.set([255, 0, 255, 255], index);
    else map.data.set([first.data[index] >> 2, first.data[index + 1] >> 2, first.data[index + 2] >> 2, 255], index);
  }
  return map;
}

function crop(image, left, top, width, height) {
  const cropped = new PixelImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) cropped.set(x, y, image.get(Math.round(left) + x, Math.round(top) + y));
  return cropped;
}

/** Decodes a PNG (Playwright writes RGB, which tools/logo/png.ts does not read) in a blank page; returns a PixelImage. */
async function decodeScreenshot(lab, file) {
  const encoded = readFileSync(file).toString("base64");
  const { width, height, base64 } = await lab.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let binary = "";
    for (let index = 0; index < data.length; index += 32768)
      binary += String.fromCharCode(...data.subarray(index, index + 32768));
    return { width: image.width, height: image.height, base64: btoa(binary) };
  }, encoded);
  const image = new PixelImage(width, height);
  image.data.set(Buffer.from(base64, "base64"));
  return image;
}

async function looks(browser, profile, directory) {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  try {
    await startNight(page);
    await page.evaluate(playBot, { milliseconds: 9000, syncGpu: false });
    await page.evaluate(() => {
      const scene = window.lampwarden.scene();
      scene.setPaused(true);
      scene.freezeClock(1.25);
    });
    await sleep(300);
    const { setups, distinct, same } = await modesFor(page);
    const placement = await page.evaluate(() => {
      const stage = document.querySelector(".stage").getBoundingClientRect();
      const canvas = window.lampwarden.app().canvas.getBoundingClientRect();
      const state = window.lampwarden.state();
      return {
        canvasLeft: canvas.left - stage.left,
        canvasTop: canvas.top - stage.top,
        canvasWidth: canvas.width,
        ratio: window.devicePixelRatio,
        hero: [state.hero.x, state.hero.y],
        lamp: [state.lamps[0].x, state.lamps[0].y],
      };
    });
    const shots = {};
    for (const mode of distinct) {
      await page.evaluate(applyMode, mode);
      await sleep(400);
      const file = `${directory}/shot-${mode}.png`;
      await page.locator(".stage").screenshot({ path: file });
    }
    // the HUD alone (the canvas hidden) in each mode: does the DOM text over the canvas change with the canvas's size?
    const hudFiles = {};
    for (const mode of distinct) {
      await page.evaluate(applyMode, mode);
      await page.evaluate(() => {
        window.lampwarden.app().canvas.style.visibility = "hidden";
      });
      await sleep(300);
      hudFiles[mode] = `${directory}/hud-${mode}.png`;
      await page.locator(".stage").screenshot({ path: hudFiles[mode] });
      await page.evaluate(() => {
        window.lampwarden.app().canvas.style.visibility = "";
      });
    }
    // how long one render takes with the GPU made to finish it (a 1 px readback), per mode, vsync out of the picture
    const bench = {};
    for (const mode of distinct) {
      await page.evaluate(applyMode, mode);
      await sleep(300);
      const repeats = [];
      for (let repeat = 0; repeat < 5; repeat++) repeats.push(await page.evaluate(benchRender, 300));
      bench[mode] = repeats;
    }
    // the blank decoding page opens only now: a second tab in front would stop the game page's frames
    const lab = await (await browser.newContext()).newPage();
    for (const mode of distinct) shots[mode] = await decodeScreenshot(lab, `${directory}/shot-${mode}.png`);
    const hudShots = {};
    for (const mode of distinct) hudShots[mode] = await decodeScreenshot(lab, hudFiles[mode]);
    const hudDiffs = {};
    for (const mode of distinct.slice(1)) hudDiffs[`A vs ${mode}`] = differing(hudShots.A, hudShots[mode]);
    const diffs = {};
    for (const mode of distinct.slice(1)) {
      diffs[`A vs ${mode}`] = differing(shots.A, shots[mode]);
      writeFileSync(`${directory}/diff-A-${mode}.png`, encodePng(differenceMap(shots.A, shots[mode])));
    }
    const gameToShot = (placement.canvasWidth * placement.ratio) / 960 / placement.ratio; // CSS px per game px
    const pixelsPerGamePixel = gameToShot * placement.ratio; // screenshot px per game px
    const regions = [placement.hero, placement.lamp].map(([x, y]) => [x - 40, y - 90, 80, 100]);
    const rows = [];
    for (const [x, y, width, height] of regions) {
      const parts = distinct.map((mode) =>
        crop(
          shots[mode],
          (placement.canvasLeft + x * gameToShot) * placement.ratio,
          (placement.canvasTop + y * gameToShot) * placement.ratio,
          Math.round(width * pixelsPerGamePixel),
          Math.round(height * pixelsPerGamePixel),
        ),
      );
      rows.push(parts);
    }
    // each crop is shown at 480 px wide by nearest-neighbour scaling to a whole factor, with a gap between modes
    const cell = rows[0][0];
    const factor = Math.max(1, Math.floor(480 / cell.width));
    const gap = 8;
    const sheet = new PixelImage(
      distinct.length * (cell.width * factor + gap),
      rows.length * (cell.height * factor + gap),
      [255, 0, 255, 255],
    );
    for (const [rowIndex, parts] of rows.entries())
      for (const [columnIndex, part] of parts.entries())
        sheet.draw(part, columnIndex * (cell.width * factor + gap), rowIndex * (cell.height * factor + gap), factor);
    writeFileSync(`${directory}/crops.png`, encodePng(sheet));
    return { setups, distinct, same, diffs, hudDiffs, bench, cropFactor: factor, cropColumns: distinct };
  } finally {
    await context.close();
  }
}

// --- main ------------------------------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
await takeScreenLock();
const results = { startedAt: new Date().toISOString(), seconds: SECONDS, runs: RUNS, profiles: {} };
for (const profileName of profileNames) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile ${profileName}`);
  const directory = `${OUT}/${profileName}`;
  mkdirSync(directory, { recursive: true });
  const launcher = profile.engine === "chromium" ? chromium : webkit;
  const found = { conditions: {} };
  results.profiles[profileName] = found;
  const lookBrowser = await launcher.launch({ headless: false });
  Object.assign(found, await looks(lookBrowser, profile, directory));
  await lookBrowser.close();
  const conditions = LOOKS_ONLY
    ? []
    : [
        ["vsync", [], false],
        ["synced", [], true],
      ];
  if (profile.engine === "chromium" && !LOOKS_ONLY) conditions.push(["uncapped", UNCAPPED_FLAGS, false]);
  for (const [name, args, syncGpu] of conditions) {
    found.conditions[name] = {};
    for (const mode of found.distinct) found.conditions[name][mode] = [];
    // one browser per condition, a fresh context per run
    const browser = await launcher.launch({ headless: false, args });
    for (let run = 0; run < RUNS; run++)
      for (const mode of found.distinct) {
        console.error(`${profileName} ${name} ${mode} run ${run + 1}/${RUNS}`);
        found.conditions[name][mode].push(await measureOnce(browser, profile, mode, syncGpu));
      }
    await browser.close();
  }
}
writeFileSync(`${OUT}/results-${profileNames.join("+")}.json`, JSON.stringify(results));

// --- report ----------------------------------------------------------------------------------------------------------
for (const [profileName, found] of Object.entries(results.profiles)) {
  console.log(`\n## ${profileName}\n`);
  for (const mode of ["A", "B", "C"]) {
    const setup = found.setups[mode];
    const twin = found.same[mode];
    console.log(
      `- ${mode}: resolution ${fixed(setup.resolution, 3)}, canvas ${setup.backing.join("x")} backing px shown at ${fixed(setup.css[0], 1)}x${fixed(setup.css[1], 1)} CSS px (${fixed((setup.backing[0] * setup.backing[1] * 4) / 1048576, 1)} MiB RGBA), ${setup.renderer}${twin ? ` (same as ${twin}, not run twice)` : ""}`,
    );
  }
  for (const [label, diff] of Object.entries(found.diffs))
    console.log(
      `- ${label}: ${diff.count} of ${diff.of} screenshot pixels differ (largest channel difference ${diff.largest})`,
    );
  for (const [label, diff] of Object.entries(found.hudDiffs))
    console.log(`- HUD alone, ${label}: ${diff.count} of ${diff.of} screenshot pixels differ`);
  console.log("\nGPU-finished render (300 renders + 1 px readback, 5 repeats; ms per render)\n");
  console.log("| mode | median | min | max |");
  console.log("| --- | --- | --- | --- |");
  for (const [mode, repeats] of Object.entries(found.bench)) {
    const sorted = [...repeats].sort((first, second) => first - second);
    console.log(
      `| ${mode} | ${fixed(sorted[Math.floor(sorted.length / 2)])} | ${fixed(sorted[0])} | ${fixed(sorted.at(-1))} |`,
    );
  }
  for (const [name, byMode] of Object.entries(found.conditions)) {
    console.log(`\n${name}, ${RUNS} x ${SECONDS} s per mode\n`);
    console.log(
      "| mode | frames | frame mean (ms) | p95 | p99 | >20 ms per 1000 | >33 ms per 1000 | render() mean (ms) | render() p95 | CPU browser / renderer / GPU (% of a core) | night ended early |",
    );
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const [mode, runs] of Object.entries(byMode)) {
      const deltas = runs.flatMap((run) => run.deltas);
      const renders = runs.flatMap((run) => run.renderTimes);
      const per1000 = (limit) => (deltas.filter((delta) => delta > limit).length / deltas.length) * 1000;
      const cpu = runs[0].cpu
        ? ["browser", "renderer", "gpu"].map((key) => fixed(mean(runs.map((run) => run.cpu[key])), 0)).join(" / ")
        : "n/a";
      console.log(
        `| ${mode} | ${deltas.length} | ${fixed(mean(deltas))} | ${fixed(percentile(deltas, 0.95))} | ${fixed(percentile(deltas, 0.99))} | ${fixed(per1000(20), 1)} | ${fixed(per1000(33.4), 1)} | ${fixed(mean(renders))} | ${fixed(percentile(renders, 0.95))} | ${cpu} | ${runs.filter((run) => run.outcome).length} |`,
      );
    }
  }
}
