// Visual verifier: drives the real game in a HEADED Chromium (real GPU compositing, as players see it) into fixed
// scenarios with a frozen clock, screenshots each, runs pixel and DOM checks, diffs against the last approved pass,
// and writes a labelled contact sheet to look at.
//
// usage: npm run build && npm start &   then   node scripts/verify-visual.mjs [--url http://localhost:3000] [--update] [--headless]
//   verify-out/latest/*.png   this pass        verify-out/baseline/*.png   last approved pass (--update copies latest there)
//   verify-out/sheet.png      contact sheet    verify-out/report.json      checks and diffs
// Exit code 1 when a check fails. --headless runs without a window; the report then says the pass was not visual.
import { chromium } from "playwright";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("--url", "http://localhost:3000");
const UPDATE = process.argv.includes("--update");
const HEADLESS = process.argv.includes("--headless");
const OUT = "verify-out";
for (const d of [OUT, `${OUT}/latest`, `${OUT}/baseline`]) mkdirSync(d, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS, args: ["--window-size=1040,760"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
const lab = await browser.newPage();   // blank page used to decode and compare PNGs
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

const shots = [];
const checks = [];
const check = (scene, name, ok, detail) => checks.push({ scene, name, ok: !!ok, detail });

// --- helpers ------------------------------------------------------------------------------------------------
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function freeze() {
  await page.evaluate(() => { const sc = window.lampwarden.scene(); sc.setPaused(true); sc.freezeClock(1.25); });
  await page.waitForTimeout(120); await settle();
}
async function shoot(name) {
  const file = `${OUT}/latest/${name}.png`;
  await page.locator(".stage").screenshot({ path: file });
  shots.push(name);
  return readFileSync(file).toString("base64");
}
// mean luminance of boxes [x, y, w, h] in canvas pixels (the stage is 960x600 at deviceScaleFactor 1)
const lum = (b64, boxes) => lab.evaluate(async ({ b64, boxes }) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return boxes.map(([x, y, w, h]) => {
    const d = g.getImageData(Math.round(x), Math.round(y), w, h).data; let t = 0;
    for (let i = 0; i < d.length; i += 4) t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return t / (d.length / 4);
  });
}, { b64, boxes });
const stats = (b64) => lab.evaluate(async (b64) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
  let s = 0, s2 = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; s2 += l * l; }
  const mean = s / n; return { mean, sd: Math.sqrt(s2 / n - mean * mean), w: c.width, h: c.height };
}, b64);
// share of pixels that differ by more than 24 levels in any channel
const diff = (a, b) => lab.evaluate(async ({ a, b }) => {
  const load = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const A = await load(a), B = await load(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  let n = 0; for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) > 24 || Math.abs(A.data[i + 1] - B.data[i + 1]) > 24 || Math.abs(A.data[i + 2] - B.data[i + 2]) > 24) n++;
  return n / (A.data.length / 4);
}, { a, b });
// share of pixels in a box that differ between two shots
const boxDiff = (a, b, [x, y, w, h]) => lab.evaluate(async ({ a, b, x, y, w, h }) => {
  const load = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(x, y, w, h).data; };
  const A = await load(a), B = await load(b); let n = 0;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) n++;
  return n / (A.length / 4);
}, { a, b, x, y, w, h });
const text = (sel) => page.locator(sel).allInnerTexts();

// --- scenarios ----------------------------------------------------------------------------------------------
await page.goto(URL_ + "/?verify=1");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
await settle();

// 1 title
let b = await shoot("01-title");
let st = await stats(b);
check("title", "canvas is not blank", st.sd > 12, `luminance sd ${st.sd.toFixed(1)}`);
check("title", "logo and start button", (await text(".logo")).join("").includes("LAMPWARDEN") && await page.getByRole("button", { name: "Light the lamps" }).isVisible());

// 2 night start: all five lamps lit
await page.getByRole("button", { name: "Light the lamps" }).click();
await page.waitForSelector('[data-phase="night"]');
await freeze();
const lamps = await page.evaluate(() => window.lampwarden.state().lamps.map((l) => [l.x, l.y]));
const head = ([x, y]) => [x - 4, y - 82, 8, 8];
const floor = ([x, y]) => [x + 30, y - 4, 10, 6];
b = await shoot("02-night-start");
const nightStats = await stats(b);
const litHeads = await lum(b, lamps.map(head));
check("night-start", "five lamps in state", lamps.length === 5);
check("night-start", "every lit lantern glows", litHeads.every((v) => v > 150), litHeads.map((v) => v.toFixed(0)).join(" "));
check("night-start", "HUD shows 5 lit lamps", (await page.locator(".lamps span.lit").count()) === 5);
check("night-start", "night is dark overall", nightStats.mean < 110, `mean ${nightStats.mean.toFixed(1)}`);

// 3 combat: one of each monster near lamps, a shot in flight, a lamp being clawed
await page.evaluate(() => {
  const s = window.lampwarden.state();
  const add = (kind, x, y, extra = {}) => s.monsters.push({ id: s.nextId++, kind, x, y, hp: kind === "cyclops" ? 2 : 1, t: 0, wob: 0, snuff: 0, cd: 0, hurt: 0, ...extra });
  add("satyr", s.lamps[2].x + 4, s.lamps[2].y + 6, { snuff: 1.2 });
  add("harpy", 300, 260);
  add("cyclops", 650, 450);
  s.shots.push({ id: s.nextId++, x: 420, y: 300, vx: 300, vy: -100, life: 1, hit: [] });
  s.hero.x = 560; s.hero.y = 360;
});
await page.evaluate(() => window.lampwarden.scene().setPaused(true)); await settle();
b = await shoot("03-combat");
const base2 = readFileSync(`${OUT}/latest/02-night-start.png`).toString("base64");
// sprite boxes: anchor is near the feet, flying monsters are drawn 22 px higher
const box = (x, y, fly) => [x - 30, y - (fly ? 22 : 0) - 100, 60, 100];
const dz = [await boxDiff(b, base2, box(300, 260, true)), await boxDiff(b, base2, box(650, 450, false)), await boxDiff(b, base2, box(lamps[2][0] + 4, lamps[2][1] + 6, false))];
check("combat", "each monster drawn where it stands", dz.every((d) => d > 0.08), dz.map((d) => (d * 100).toFixed(0) + "%").join(" "));
// stray strokes: the sky band above the plaza should look the same as at night start
const sky = await boxDiff(b, base2, [0, 60, 960, 60]);
check("combat", "no stray strokes across the sky", sky < 0.001, `${(sky * 100).toFixed(2)}% of the sky changed`);

// 4 two dark lamps, one being relit
await page.evaluate(() => { const s = window.lampwarden.state(); s.monsters = []; s.shots = []; s.lamps[0].lit = false; s.lamps[1].lit = false; s.lamps[1].relight = 0.5; s.hero.x = s.lamps[1].x + 10; s.hero.y = s.lamps[1].y + 8; });
await settle(); await page.waitForTimeout(80);
b = await shoot("04-dark-lamps");
const heads4 = await lum(b, lamps.map(head));
const sky4 = await boxDiff(b, base2, [0, 60, 960, 60]);
check("dark-lamps", "no stray strokes across the sky", sky4 < 0.001, `${(sky4 * 100).toFixed(2)}% of the sky changed`);
check("dark-lamps", "dark lanterns are darker than lit ones", Math.max(heads4[0], heads4[1]) + 40 < Math.min(heads4[2], heads4[3], heads4[4]), heads4.map((v) => v.toFixed(0)).join(" "));
const pool = await lum(b, lamps.map(floor));
check("dark-lamps", "no light pool under dark lamps", Math.max(pool[0], pool[1]) + 8 < Math.min(pool[2], pool[3]), pool.map((v) => v.toFixed(0)).join(" "));

// 5 just before dawn: the tint has warmed
await page.evaluate(() => { const s = window.lampwarden.state(); s.lamps.forEach((l) => (l.lit = true)); s.elapsed = s.length * 0.97; });
await settle(); await page.waitForTimeout(80);
b = await shoot("05-near-dawn");
const dawnStats = await stats(b);
check("near-dawn", "scene brightens towards dawn", dawnStats.mean > nightStats.mean + 25, `night ${nightStats.mean.toFixed(1)} → dawn ${dawnStats.mean.toFixed(1)}`);

// 6 dawn screen
await page.evaluate(() => { const s = window.lampwarden.state(); s.elapsed = s.length - 0.01; s.stats.kills = 12; s.oilEarned = 12; window.lampwarden.scene().setPaused(false); });
await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
await freeze();
b = await shoot("06-dawn");
check("dawn", "dawn panel with four upgrades", (await text(".logo")).join("").includes("DAWN") && (await page.locator(".btn.up").count()) === 4);
const icons = await page.locator(".btn.up .icon").count();
check("dawn", "every upgrade has an icon", icons === 4, `${icons} icons`);

// 7 heir screen after the lamps go dark
await page.getByRole("button", { name: /Into night/ }).click();
await page.waitForSelector('[data-phase="night"]');
await page.evaluate(() => { const s = window.lampwarden.state(); s.lamps.forEach((l) => (l.lit = false)); });
await page.waitForSelector('[data-phase="heir"]', { timeout: 5000 });
await freeze();
b = await shoot("07-heir");
check("heir", "three heirs offered", (await page.locator(".btn.heir").count()) === 3);

// 8 replay of the night just played (kept locally)
await page.goto(URL_ + "/?replay=last");
await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
await page.waitForTimeout(1200); await freeze();
b = await shoot("08-replay");
check("replay", "replay bar shown", (await text(".replaybar")).join("").includes("REPLAY"));

check("all", "no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

// --- diffs against the last approved pass, contact sheet ----------------------------------------------------
const diffs = {};
for (const n of shots) {
  const base = `${OUT}/baseline/${n}.png`;
  if (existsSync(base)) diffs[n] = await diff(readFileSync(`${OUT}/latest/${n}.png`).toString("base64"), readFileSync(base).toString("base64"));
  if (UPDATE || !existsSync(base)) copyFileSync(`${OUT}/latest/${n}.png`, base);
}
const sheet = await browser.newPage({ viewport: { width: 1940, height: 800 }, deviceScaleFactor: 1 });
const cells = shots.map((n) => {
  const fails = checks.filter((c) => c.scene && n.includes(c.scene) && !c.ok).length;
  const d = diffs[n] === undefined ? "new" : `${(diffs[n] * 100).toFixed(1)}% changed`;
  return `<figure><img src="data:image/png;base64,${readFileSync(`${OUT}/latest/${n}.png`).toString("base64")}"><figcaption>${n} · ${d}${fails ? ` · <b>${fails} FAILED</b>` : ""}</figcaption></figure>`;
}).join("");
await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:13px monospace;display:grid;grid-template-columns:repeat(4,480px);gap:4px;padding:4px}
figure{margin:0}img{width:480px;image-rendering:pixelated;display:block}figcaption{padding:2px 0}b{color:#ff6b5b}</style>${cells}`);
await sheet.screenshot({ path: `${OUT}/sheet.png`, fullPage: true });

const failed = checks.filter((c) => !c.ok);
const report = { url: URL_, visual: !HEADLESS, at: new Date().toISOString(), checks, diffs, failed: failed.length };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.scene.padEnd(12)} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
console.log(`\n${HEADLESS ? "HEADLESS (not a visual pass)" : "headed"} · ${checks.length - failed.length}/${checks.length} checks · sheet: ${OUT}/sheet.png`);
for (const [n, d] of Object.entries(diffs)) if (d > 0.01) console.log(`changed vs baseline: ${n} ${(d * 100).toFixed(1)}%`);
await browser.close();
process.exit(failed.length ? 1 : 0);
