// Checks the browser worker that draws a creature from its build code (src/scene/creature-worker.ts), in the real built app
// served by `bun run build && bun run start`, in desktop Chromium and in WebKit on an iPhone profile:
//   identity  the pixels the worker draws for every committed sprite script (public/sprites/*.ts) equal that sprite's PNG,
//             drawn through the real path (code route, hash check, worker), and compared byte for byte here
//   probes    the isolation probes of pipeline/inprocess_eval (adapted to a browser) run as creature code: nothing of the worker
//             or the page is reached, the page keeps running, and the next render is unaffected
//   measure   the worker's render time cold (nothing cached: WebAssembly and kit load) and warm, and the bytes a creature costs
// The creature API is stubbed (no Mubit, no Blob); a canary HTTP server on another port sees any request the code manages to make.
//
// usage: bun e2e/check-creature-worker.mjs [--url http://localhost:3730] [--out DIR] [--only identity,probes,measure]
//          [--runs 5] [--headed] [--browsers chromium,webkit] [--probe name,name]
// Writes <out>/creature-worker.json and prints the results. Exit code 1 when an identity or probe check fails.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { plainJavaScript } from "../pipeline/render-inprocess-shared.ts";
import { decodePng } from "../tools/logo/png.ts";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const BASE_URL = argument("--url", "http://localhost:3730");
const OUT = argument("--out", "verify-out/creature-worker");
const ONLY = argument("--only", "identity,probes,measure").split(",");
const RUNS = Number(argument("--runs", "5"));
const HEADED = process.argv.includes("--headed");
const BROWSERS = argument("--browsers", "chromium,webkit").split(",");
const PROBE_FILTER = argument("--probe", "").split(",").filter(Boolean); // only these probes (default: all)
mkdirSync(OUT, { recursive: true });

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const SPRITES = "public/sprites";
const PROBES = "pipeline/inprocess_eval/probes";

// --- the canary: a server on another port that counts every request that reaches it -----------------------------------
const canary = { hits: 0, urls: [] };
const canaryServer = createServer((request, response) => {
  canary.hits++;
  canary.urls.push(request.url);
  response.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  response.end("canary");
});
await new Promise((resolve) => canaryServer.listen(0, "127.0.0.1", resolve));
const CANARY_URL = `http://127.0.0.1:${canaryServer.address().port}/canary`;

// --- the stub: the code route serves whatever the current records say ------------------------------------------------------
const codes = new Map(); // creature id -> code text
async function serve(route) {
  const { pathname } = new URL(route.request().url());
  const match = /\/api\/creatures\/([^/]+)\/code$/.exec(pathname);
  if (match && codes.has(match[1]))
    return route.fulfill({ status: 200, contentType: "text/plain", body: codes.get(match[1]) });
  if (pathname.endsWith("/next")) return route.fulfill({ json: { kind: "none", reason: "unavailable" } });
  return route.fulfill({ status: 404, json: { error: "not part of the stub" } });
}

const spriteNames = readdirSync(SPRITES)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.slice(0, -3))
  .sort();
function recordOf(name) {
  const code = plainJavaScript(readFileSync(join(SPRITES, `${name}.ts`), "utf8"));
  const pixels = decodePng(readFileSync(join(SPRITES, `${name}.png`))).data;
  const id = `fixture-${name}`;
  codes.set(id, code);
  return { record: { id, build: { codeSha256: sha256(code), pixelsSha256: sha256(pixels) } }, pixels };
}

// installed in every page: bytes to base64, to carry pixels back to this script
const installHelpers = () => {
  window.__toBase64 = (bytes) => {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  };
};

async function openGame(browser, device) {
  const context = await browser.newContext(device);
  await context.route("**/api/creatures/**", serve);
  await context.addInitScript(installHelpers);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  return { context, page, errors };
}

const launchers = {
  chromium: () => chromium.launch({ headless: !HEADED }),
  webkit: () => webkit.launch({ headless: !HEADED }),
};
const profiles = {
  chromium: { viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 },
  webkit: devices["iPhone 14 landscape"],
};

const results = { identity: {}, probes: {}, measure: {} };
let failures = 0;
const fail = (message) => {
  failures++;
  console.log(`FAIL ${message}`);
};

// --- identity ---------------------------------------------------------------------------------------------------------------
async function identity(name, browser) {
  const { context, page, errors } = await openGame(browser, profiles[name]);
  const rows = [];
  for (const sprite of spriteNames) {
    const { record, pixels } = recordOf(sprite);
    // the real path first: code route, hash check, worker, hash check, with the production deadline
    let outcome = await page.evaluate(async (record) => {
      const started = performance.now();
      const drawn = await window.lampwarden.creaturePixels(record);
      const milliseconds = performance.now() - started;
      return { ok: drawn !== null, milliseconds, base64: drawn ? window.__toBase64(drawn) : "" };
    }, record);
    // a sprite slower than the production deadline (the trireme, a boat, is the one near it) is drawn again with a long one,
    // so its pixels are still compared; it is reported as slow
    let slow = false;
    if (!outcome.ok) {
      slow = true;
      outcome = await page.evaluate(async (id) => {
        const code = await fetch(`/api/creatures/${id}/code`).then((response) => response.text());
        const result = await window.lampwarden.drawInWorker(code, 30000);
        return {
          ok: result.ok,
          milliseconds: result.milliseconds,
          base64: result.ok ? window.__toBase64(result.pixels) : "",
        };
      }, record.id);
    }
    const drawn = outcome.ok ? Buffer.from(outcome.base64, "base64") : Buffer.alloc(0);
    const identical = outcome.ok && drawn.length === pixels.length && Buffer.compare(drawn, Buffer.from(pixels)) === 0;
    rows.push({ sprite, ok: outcome.ok, identical, slow, milliseconds: Math.round(outcome.milliseconds) });
    if (!identical)
      fail(`${name}: ${sprite} ${outcome.ok ? "drew different pixels" : "was not drawn (hash, deadline or error)"}`);
  }
  if (errors.length) fail(`${name}: page errors ${errors.slice(0, 2).join(" | ")}`);
  await context.close();
  results.identity[name] = rows;
  const identical = rows.filter((row) => row.identical).length;
  console.log(`\nidentity, ${name}: ${identical}/${rows.length} sprites draw exactly their PNG's pixels`);
  console.log(
    rows
      .map(
        (row) =>
          `  ${row.sprite.padEnd(18)} ${row.identical ? (row.slow ? "identical (over the production deadline)" : "identical") : row.ok ? "DIFFERENT" : "NOT DRAWN"}  ${row.milliseconds} ms`,
      )
      .join("\n"),
  );
}

// --- probes ---------------------------------------------------------------------------------------------------------------
const probeSource = (file) =>
  readFileSync(join(PROBES, file), "utf8")
    .replaceAll("__CANARY_URL__", CANARY_URL)
    .replaceAll("__CANARY_ENV__", "LAMPWARDEN_CANARY_SECRET")
    .replaceAll("__CANARY_FILE__", "/nonexistent")
    .replaceAll("__MARKER_DIR__", "/nonexistent");

// probes written for a browser worker: every route to the worker's own scope, the network and the page
const BROWSER_PROBES = {
  "escape-worker": `function build(k) {
  var global = (0, function () { return this; })();
  var names = ['self', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage',
    'onmessage', 'close', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches', 'navigator', 'location', 'localStorage',
    'crypto', 'performance', 'setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame', 'console', 'Date', 'process', 'require'];
  var routes = {};
  names.forEach(function (name) {
    routes['direct ' + name] = function () { return typeof eval('typeof ' + name) === 'string' && eval('typeof ' + name) !== 'undefined' ? name : undefined; };
    routes['globalThis ' + name] = function () { return globalThis[name]; };
    routes['constructor chain ' + name] = function () { return global.constructor.constructor('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')(); };
    routes['array chain ' + name] = function () { return [].constructor.constructor('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')(); };
  });
  var reached = [];
  Object.keys(routes).forEach(function (route) {
    try { var value = routes[route](); if (value !== undefined && value !== null) reached.push(route); } catch (error) {}
  });
  var dynamicImport = 'unsupported';
  try { var pending = import('${CANARY_URL}'); dynamicImport = typeof pending; if (pending && pending.catch) pending.catch(function () {}); } catch (error) { dynamicImport = 'threw'; }
  throw new Error('PROBE ' + JSON.stringify({ reached: reached, dynamicImport: dynamicImport, globals: Object.getOwnPropertyNames(global).length }));
}`,
  "reach-network": `function build(k) {
  var attempts = [];
  function attempt(label, work) { try { work(); attempts.push(label + ': ran'); } catch (error) { attempts.push(label + ': ' + String(error && error.name)); } }
  attempt('fetch', function () { fetch('${CANARY_URL}'); });
  attempt('importScripts', function () { importScripts('${CANARY_URL}'); });
  attempt('XMLHttpRequest', function () { var request = new XMLHttpRequest(); request.open('GET', '${CANARY_URL}'); request.send(); });
  attempt('WebSocket', function () { new WebSocket('ws://127.0.0.1:1/'); });
  attempt('sendBeacon', function () { navigator.sendBeacon('${CANARY_URL}'); });
  attempt('Worker', function () { new Worker('${CANARY_URL}'); });
  attempt('import()', function () { import('${CANARY_URL}'); });
  attempt('eval fetch', function () { (0, eval)('fetch("${CANARY_URL}")'); });
  attempt('Function fetch', function () { new Function('return fetch("${CANARY_URL}")')(); });
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  "forge-reply": `function build(k) {
  var attempts = [];
  function attempt(label, work) { try { work(); attempts.push(label + ': ran'); } catch (error) { attempts.push(label + ': ' + String(error && error.name)); } }
  attempt('postMessage', function () { postMessage({ ok: true, pixels: new ArrayBuffer(65536), loadMilliseconds: 0, runMilliseconds: 0 }); });
  attempt('self.postMessage', function () { self.postMessage({ ok: true, pixels: new ArrayBuffer(65536) }); });
  attempt('constructor chain', function () { [].constructor.constructor('return postMessage')()({ ok: true, pixels: new ArrayBuffer(65536) }); });
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
};

// generic probes from pipeline/inprocess_eval/probes, with what each should come to inside the worker
const GENERIC_PROBES = [
  "escape-process",
  "env-fs-net",
  "loop",
  "regex-loop",
  "stack-overflow",
  "memory",
  "memory-objects",
  "schedule-after",
  "schedule-at",
  "prototype-pollution",
  "kit-state",
  "throws",
  "throws-object",
  "huge-error",
  "huge-pixels",
  "huge-stats",
];
const PROBE_DEADLINE = 3000; // ms for the whole draw (the interpreter stops itself a second earlier)

async function probes(name, browser) {
  const { context, page, errors } = await openGame(browser, profiles[name]);
  const { record, pixels: satyrPixels } = recordOf("satyr");
  // the control: the satyr's code drawn in a worker of its own, which must be exactly the satyr's PNG after every probe
  const drawSatyr = async () => {
    const base64 = await page.evaluate(async (id) => {
      const code = await fetch(`/api/creatures/${id}/code`).then((response) => response.text());
      const result = await window.lampwarden.drawInWorker(code);
      return result.ok ? window.__toBase64(result.pixels) : "";
    }, record.id);
    return base64 !== "" && Buffer.compare(Buffer.from(base64, "base64"), Buffer.from(satyrPixels)) === 0;
  };

  const list = [
    ...Object.entries(BROWSER_PROBES).map(([probe, source]) => ({ probe, source, browserOnly: true })),
    ...GENERIC_PROBES.map((probe) => ({ probe, source: probeSource(`${probe}.js`), browserOnly: false })),
  ];
  const rows = [];
  if (PROBE_FILTER.length) list.splice(0, list.length, ...list.filter(({ probe }) => PROBE_FILTER.includes(probe)));
  if (!(await drawSatyr())) fail(`${name}: the control render before the probes is not the satyr`);
  for (const { probe, source } of list) {
    canary.hits = 0;
    canary.urls = [];
    await page.evaluate(() => {
      window.__beats = [];
      window.__lastBeat = performance.now();
      window.__beatTimer = setInterval(() => {
        const now = performance.now();
        window.__beats.push(now - window.__lastBeat);
        window.__lastBeat = now;
      }, 10);
    });
    const outcome = await page.evaluate(
      async ({ source, deadline }) => {
        const result = await window.lampwarden.drawInWorker(source, deadline);
        return result.ok
          ? { ok: true, milliseconds: result.milliseconds }
          : { ok: false, reason: result.reason.slice(0, 400), milliseconds: result.milliseconds };
      },
      { source, deadline: PROBE_DEADLINE },
    );
    const beats = await page.evaluate(() => {
      clearInterval(window.__beatTimer);
      return { longest: Math.round(Math.max(...window.__beats, 0)), count: window.__beats.length };
    });
    const unaffected = await drawSatyr();
    const canaryHits = canary.hits;
    // the page kept running (no gap in its own timer longer than a third of a second), the canary saw nothing, and the next render is exact
    const contained = beats.longest < 350 && canaryHits === 0 && unaffected && errors.length === 0;
    rows.push({
      probe,
      outcome,
      longestMainThreadGapMilliseconds: beats.longest,
      canaryHits,
      nextRenderIdentical: unaffected,
      contained,
    });
    if (!contained)
      fail(
        `${name}: probe ${probe}: gap ${beats.longest} ms, canary ${canaryHits}, next render ${unaffected ? "identical" : "DIFFERENT"}, page errors ${errors.length}`,
      );
    console.log(
      `  ${probe.padEnd(20)} ${contained ? "contained" : "NOT CONTAINED"}  ${outcome.ok ? "drew a sprite" : outcome.reason}  [${Math.round(outcome.milliseconds)} ms, main-thread gap ${beats.longest} ms, canary ${canaryHits}, next render ${unaffected ? "identical" : "DIFFERENT"}]`,
    );
  }
  await context.close();
  results.probes[name] = rows;
  console.log(`probes, ${name}: ${rows.filter((row) => row.contained).length}/${rows.length} contained`);
}

// --- measure --------------------------------------------------------------------------------------------------------------
const median = (numbers) => {
  const sorted = [...numbers].sort((first, second) => first - second);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
    : Number.NaN;
};

async function drawTimed(page, record) {
  return page.evaluate(async (record) => {
    const started = performance.now();
    const drawn = await window.lampwarden.creaturePixels(record);
    const wall = performance.now() - started;
    const entries = performance.getEntriesByName("creature-draw");
    const last = entries.at(-1);
    return {
      ok: drawn !== null,
      wall,
      worker: last?.duration ?? 0,
      load: last?.detail?.loadMilliseconds ?? 0,
      run: last?.detail?.runMilliseconds ?? 0,
    };
  }, record);
}

async function measure(name, browser) {
  const sprites = ["satyr", "harpy", "cyclops", "temple"];
  const records = Object.fromEntries(sprites.map((sprite) => [sprite, recordOf(sprite).record]));
  // cold: a fresh browser context for every sample, so nothing is in the HTTP cache
  const cold = {};
  for (const sprite of sprites) {
    cold[sprite] = [];
    for (let run = 0; run < Math.min(RUNS, 3); run++) {
      const { context, page } = await openGame(browser, profiles[name]);
      cold[sprite].push(await drawTimed(page, records[sprite]));
      await context.close();
    }
  }
  // warm: one page, the WebAssembly and the kit already in the HTTP cache; each draw still starts a new worker
  const warm = {};
  const { context, page } = await openGame(browser, profiles[name]);
  const received = [];
  page.on("requestfinished", async (request) => {
    const sizes = await request.sizes().catch(() => null);
    received.push({
      url: request.url(),
      encoded: sizes?.responseBodySize ?? 0,
      headers: sizes?.responseHeadersSize ?? 0,
    });
  });
  const before = received.length;
  await drawTimed(page, records.satyr); // primes the cache; its requests are the creature's download
  await new Promise((resolve) => setTimeout(resolve, 300));
  const download = received.slice(before);
  for (const sprite of sprites) {
    warm[sprite] = [];
    for (let run = 0; run < RUNS; run++) {
      const sample = await page.evaluate(async (record) => {
        const code = await fetch(`/api/creatures/${record.id}/code`).then((response) => response.text());
        const started = performance.now();
        const result = await window.lampwarden.drawInWorker(code);
        return {
          ok: result.ok,
          wall: performance.now() - started,
          load: result.loadMilliseconds ?? 0,
          run: result.runMilliseconds ?? 0,
        };
      }, records[sprite]);
      warm[sprite].push({ ...sample, worker: sample.wall });
    }
  }
  await context.close();
  const summary = (samples) => ({
    wall: Math.round(median(samples.map((sample) => sample.wall))),
    load: Math.round(median(samples.map((sample) => sample.load))),
    run: Math.round(median(samples.map((sample) => sample.run))),
    n: samples.length,
  });
  const table = {};
  for (const sprite of sprites) table[sprite] = { cold: summary(cold[sprite]), warm: summary(warm[sprite]) };
  const pngBytes = Object.fromEntries(
    sprites.map((sprite) => [sprite, readFileSync(join(SPRITES, `${sprite}.png`)).length]),
  );
  const codeBytes = Object.fromEntries(
    sprites.map((sprite) => [sprite, Buffer.byteLength(codes.get(records[sprite].id))]),
  );
  results.measure[name] = { table, download, pngBytes, codeBytes };
  console.log(
    `\nmeasure, ${name} (milliseconds; wall = asking to having the pixels, load = WebAssembly instantiate in the worker, run = interpreter)`,
  );
  for (const sprite of sprites) {
    const { cold: coldRow, warm: warmRow } = table[sprite];
    console.log(
      `  ${sprite.padEnd(8)} cold wall ${coldRow.wall} (load ${coldRow.load}, run ${coldRow.run})   warm wall ${warmRow.wall} (load ${warmRow.load}, run ${warmRow.run})   code ${codeBytes[sprite]} B, PNG ${pngBytes[sprite]} B`,
    );
  }
  console.log("  downloaded for the first creature (encoded bytes):");
  for (const entry of download)
    console.log(`    ${String(entry.encoded + entry.headers).padStart(8)}  ${entry.url.replace(BASE_URL, "")}`);
}

const browsers = {};
for (const name of BROWSERS) browsers[name] = await launchers[name]();
for (const name of BROWSERS) {
  const browser = browsers[name];
  if (ONLY.includes("identity")) await identity(name, browser);
  if (ONLY.includes("probes")) {
    console.log(`\nprobes, ${name}`);
    await probes(name, browser);
  }
  if (ONLY.includes("measure")) await measure(name, browser);
}
for (const browser of Object.values(browsers)) await browser.close();
canaryServer.close();
writeFileSync(join(OUT, "creature-worker.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(failures ? `\n${failures} failure(s)` : "\nall identity and probe checks passed");
process.exit(failures ? 1 : 0);
