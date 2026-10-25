// Visual verifier: drives the real game in a HEADED Chromium (real GPU compositing, as players see it) into fixed
// scenarios with a frozen clock, screenshots each, runs pixel and DOM checks, diffs against the last approved pass,
// and writes a labelled contact sheet to look at.
//
// usage: bun run build && bun run start &   then   bun run verify:visual -- [--url http://localhost:3000] [--update] [--headless]
//   verify-out/latest/*.png   this pass        verify-out/baseline/*.png   last approved pass (--update copies latest there)
//   verify-out/sheet.png      contact sheet    verify-out/report.json      checks and diffs
// Exit code 1 when a check fails. --headless runs without a window; the report then says the pass was not visual.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, devices, webkit } from "playwright";
import { creatureSchema } from "../src/game/creature.ts";
import {
  CREATURE_ALL_DIRECTIONS,
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAME_SIZE,
  creatureAtlasLayout,
} from "../src/game/creature-frames.ts";
import { newLegacy, openShop } from "../src/game/legacy.ts";
import { anchorYFor, heroAtlasCell } from "../src/scene/assets.ts";
import { decorFor } from "../src/scene/decor.ts";
import { baseBandOf, measureSprite } from "../src/scene/extent.ts";
import { SHEET_FRAMES } from "../src/scene/monster-sheets.ts";
import { onPlaza, plazaInset, shoreDistance as shoreDistanceOf } from "../src/scene/plaza.ts";
import { PixelImage } from "../tools/logo/image.ts";
import { decodePng, encodePng } from "../tools/logo/png.ts";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const BASE_URL = argument("--url", "http://localhost:3000");
const UPDATE = process.argv.includes("--update");
const HEADLESS = process.argv.includes("--headless");
const OUT = "verify-out";
for (const directory of [OUT, `${OUT}/latest`, `${OUT}/baseline`]) mkdirSync(directory, { recursive: true });

// The creature API is stubbed on every page and context: the verifier never touches Mubit or the network. The fixture
// creature's sprite is a committed one (the satyr), served from public/sprites. sea.mode picks the answer to
// POST /api/creatures/next: "none" (the default, so every older scenario plays as before), "ready", "generating" (the
// job then walks through sea.steps, and finishes with the fixture creature once sea.jobsDone is set), "broken" (ready,
// but its sprite never arrives) or "sequence" (a small sea of its own, see SEQUENCE). sea.asked logs the `seen` lists.
const SEA_CREATURE = {
  id: "brine-hound-satyr",
  // the longest name and lore the contract allows (creatureSchema: 40 and 160 characters), so a panel that only fits
  // short text, or cuts it, fails here; checked against the schema just below
  name: "Drowned sponge diver of the Lychnos deep",
  lore: "He dived too deep for the sponge beds and never rose. Now he climbs the quay dripping and blows our flames out with his last held breath, one by one, till dawn.",
  brief: "a hound of grey sea foam with a lantern jaw, the verifier's fixture",
  archetype: "skulker",
  modifiers: { speed: 1, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 8,
  createdAt: "2026-10-24T01:00:00.000Z",
};
if (
  SEA_CREATURE.name.length !== creatureSchema.shape.name.maxLength ||
  SEA_CREATURE.lore.length !== creatureSchema.shape.lore.maxLength
)
  throw new Error("the sea fixture must hold the longest name and lore the creature contract allows");
const SEA_SPRITE = readFileSync("public/sprites/satyr.png");
const creaturePoseName = (cell) => `${cell.animation}${cell.frame + 1}`;
// "sequence": three creatures made one after another. sea.made of them are finished; asking with `seen` answers with a
// finished one not yet met, else starts the job that makes the next (job-seq-<index>, done once sea.made passes it).
const SEQUENCE = ["tide-wraith", "kelp-widow", "salt-hound"].map((id, index) => ({
  ...SEA_CREATURE,
  id,
  name: ["Tide wraith", "Kelp widow", "Salt hound"][index],
  createdAt: `2026-10-24T01:0${index + 1}:00.000Z`,
}));
const sea = { mode: "none", steps: ["queued", "drawing", "rendering"], polls: 0, asked: [], jobsDone: false, made: 0 };

// An animated creature, for sea.mode "animated": its record carries frame counts and the five directions it is drawn
// from, and the gallery serves an atlas. The atlas is made in code from the committed hero atlas (the male warden from
// each of the five drawn directions: idle, walk and the melee swing as attack, which is the creatures' own layout),
// never from an outside picture, and its sprite.png is the south-east idle frame, as a real job stores.
const SEA_ANIMATED = {
  ...SEA_CREATURE,
  id: "tide-warden-fixture",
  name: "Drowned tide warden",
  anchorY: 0.82,
  frames: { ...CREATURE_ALL_DIRECTIONS },
};
// the atlas and the sprite of a creature with `frames`, cut from the hero atlas
const animatedFixture = (frames) => {
  const hero = decodePng(readFileSync("public/sprites/hero/male.png"));
  const layout = creatureAtlasLayout(frames);
  const atlas = new PixelImage(layout.width, layout.height);
  const heroAnimation = { idle: "idle", walk: "walk", attack: "melee" };
  for (const cell of layout.cells) {
    const from = heroAtlasCell(heroAnimation[cell.animation], cell.frame, cell.direction);
    for (let row = 0; row < CREATURE_FRAME_SIZE; row++) {
      const start = ((from.y + row) * hero.width + from.x) * 4;
      atlas.data.set(
        hero.data.subarray(start, start + CREATURE_FRAME_SIZE * 4),
        ((cell.y + row) * atlas.width + cell.x) * 4,
      );
    }
  }
  const idle = new PixelImage(CREATURE_FRAME_SIZE, CREATURE_FRAME_SIZE);
  const stillCell = layout.cells.find(
    (cell) => cell.direction === "se" && cell.animation === "idle" && cell.frame === 0,
  );
  for (let row = 0; row < CREATURE_FRAME_SIZE; row++)
    idle.data.set(
      atlas.data.subarray(
        ((stillCell.y + row) * atlas.width + stillCell.x) * 4,
        ((stillCell.y + row) * atlas.width + stillCell.x) * 4 + CREATURE_FRAME_SIZE * 4,
      ),
      row * CREATURE_FRAME_SIZE * 4,
    );
  return { atlas: encodePng(atlas), sprite: encodePng(idle) };
};
const ANIMATED_FIXTURE = animatedFixture(CREATURE_ALL_DIRECTIONS);
// "animated-legacy": a creature made before directions, whose record has no `directions`: one south-east side in a row of frames
const SEA_LEGACY = {
  ...SEA_ANIMATED,
  id: "old-tide-warden-fixture",
  name: "Old tide warden",
  frames: { ...CREATURE_FRAME_COUNTS },
};
const LEGACY_FIXTURE = animatedFixture(CREATURE_FRAME_COUNTS);
const animatedMode = () => sea.mode === "animated" || sea.mode === "animated-legacy";
const fixtureOf = () => (sea.mode === "animated-legacy" ? LEGACY_FIXTURE : ANIMATED_FIXTURE);
async function serveSea(route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (pathname.endsWith("/atlas.png"))
    return animatedMode()
      ? route.fulfill({ status: 200, contentType: "image/png", body: fixtureOf().atlas })
      : route.fulfill({ status: 404, json: { error: "not found" } });
  if (pathname.endsWith("/sprite.png"))
    return sea.mode === "broken"
      ? route.abort()
      : route.fulfill({
          status: 200,
          contentType: "image/png",
          body: animatedMode() ? fixtureOf().sprite : SEA_SPRITE,
        });
  if (pathname.endsWith("/next")) {
    const seen = JSON.parse(request.postData() ?? "{}").seen;
    sea.asked.push(seen);
    if (sea.mode === "sequence") {
      const unmet = SEQUENCE.slice(0, sea.made).find((creature) => !seen.includes(creature.id));
      if (unmet) return route.fulfill({ json: { kind: "ready", creature: unmet } });
      if (seen.length < SEQUENCE.length)
        return route.fulfill({ json: { kind: "generating", jobId: `job-seq-${seen.length}` } });
      return route.fulfill({ json: { kind: "none", reason: "unavailable" } });
    }
    if (sea.mode === "animated") return route.fulfill({ json: { kind: "ready", creature: SEA_ANIMATED } });
    if (sea.mode === "animated-legacy") return route.fulfill({ json: { kind: "ready", creature: SEA_LEGACY } });
    if (sea.mode === "ready" || sea.mode === "broken")
      return route.fulfill({ json: { kind: "ready", creature: SEA_CREATURE } });
    if (sea.mode === "generating") return route.fulfill({ json: { kind: "generating", jobId: "job-verify" } });
    return route.fulfill({ json: { kind: "none", reason: "unavailable" } });
  }
  if (pathname.includes("/jobs/")) {
    const jobId = pathname.split("/").pop();
    const step = sea.steps[Math.min(sea.polls++, sea.steps.length - 1)];
    const sequenced = SEQUENCE[Number(jobId.replace("job-seq-", ""))];
    if (sea.mode === "sequence" && sequenced && sea.made > SEQUENCE.indexOf(sequenced))
      return route.fulfill({ json: { jobId, step: "done", creature: sequenced, updatedAt: sequenced.createdAt } });
    if (sea.jobsDone)
      return route.fulfill({
        json: { jobId, step: "done", creature: SEA_CREATURE, updatedAt: SEA_CREATURE.createdAt },
      });
    return route.fulfill({ json: { jobId, step, updatedAt: SEA_CREATURE.createdAt } });
  }
  return route.fulfill({ status: 404, json: { error: "not part of the verifier's stub" } });
}

// The building API is stubbed beside it (src/game/building.ts): the fixture building is a recoloured committed house (its
// red and blue swapped), so the stand-in is a picture the committed plaza does not have, and its extents are measured from
// that picture the way the server measures an accepted sprite. plaza.mode picks the answer to POST /api/buildings/next:
// "none" (the default, so every older scenario plays as before), "ready", or "broken" (ready, but its sprite never arrives).
// plaza.asked logs the `seen` lists.
const PLAZA_ANCHOR_Y = anchorYFor("house");
const PLAZA_PICTURE = (() => {
  const house = decodePng(readFileSync("public/sprites/house.png"));
  const swapped = new PixelImage(128, 128);
  for (let index = 0; index < 128 * 128; index++) {
    const offset = index * 4;
    swapped.data[offset] = house.data[offset + 2];
    swapped.data[offset + 1] = house.data[offset + 1];
    swapped.data[offset + 2] = house.data[offset];
    swapped.data[offset + 3] = house.data[offset + 3];
  }
  return swapped;
})();
const PLAZA_SPRITE = encodePng(PLAZA_PICTURE);
const PLAZA_BUILDING = (() => {
  let [left, top, right, bottom] = [128, 128, 0, 0];
  for (let row = 0; row < 128; row++)
    for (let column = 0; column < 128; column++)
      if (PLAZA_PICTURE.data[(row * 128 + column) * 4 + 3] > 0) {
        left = Math.min(left, column);
        right = Math.max(right, column);
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
      }
  return {
    id: "0000aaaa-fountain-house-verifier",
    name: "Treasury of the Sea-Captains of Lychnos", // a name as long as the contract allows (40) and a real one would be
    brief: "small stone fountain house with a tiled terracotta gable roof, the verifier's fixture",
    anchorY: PLAZA_ANCHOR_Y,
    bbox: [left, top, right, bottom],
    extent: measureSprite(PLAZA_PICTURE.data, PLAZA_ANCHOR_Y),
    score: 8,
    createdAt: "2026-10-25T09:00:00.000Z",
  };
})();
if (PLAZA_BUILDING.name.length < 38 || PLAZA_BUILDING.name.length > 40)
  throw new Error("the building fixture must hold a name as long as the building contract allows");
const plaza = { mode: "none", asked: [] };
async function servePlaza(route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (pathname.endsWith("/sprite.png"))
    return plaza.mode === "broken"
      ? route.abort()
      : route.fulfill({ status: 200, contentType: "image/png", body: PLAZA_SPRITE });
  if (pathname.endsWith("/next")) {
    plaza.asked.push(JSON.parse(request.postData() ?? "{}").seen);
    return plaza.mode === "ready" || plaza.mode === "broken"
      ? route.fulfill({ json: { kind: "ready", building: PLAZA_BUILDING } })
      : route.fulfill({ json: { kind: "none", reason: "unavailable" } });
  }
  return route.fulfill({ status: 404, json: { error: "not part of the verifier's stub" } });
}
const stubSea = async (target) => {
  await target.route("**/api/creatures/**", serveSea);
  await target.route("**/api/buildings/**", servePlaza);
};

// The recording and director APIs are stubbed on every page and context too: no night is stored and the model is never
// asked. /api/plays keeps the bodies it was sent (the nights a page uploaded). /api/director answers by mode:
//   "off" (the default, so every older scenario plays as before): the rules' decision, as the real route does with no key
//   "answer": a decision from the model, built on the rules' decision the page is waiting with (tide 0.1 under the
//             rules', cyclops 0.6, harpy 1.5, creature share 0.2, and a line of the sea's)
//   "late": the same, but only once director.hold is resolved
//   "eager": eases whatever the night was, and says it was engaged
//   "fallback": the rules' decision with fallback "timeout"; "down": the connection fails
const DIRECTOR_LINE = "The tide withdraws, and Lychnos sleeps a little.";
const director = { mode: "off", asked: [], uploads: [], hold: null, decision: null };
async function serveDirector(route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (pathname === "/api/plays") {
    director.uploads.push(JSON.parse(request.postData() ?? "{}"));
    return route.fulfill({ json: { ok: true } });
  }
  const { playId } = JSON.parse(request.postData() ?? "{}");
  director.asked.push(playId);
  try {
    const rules = await request
      .frame()
      .page()
      .evaluate(() => window.lampwarden.legacy().director);
    if (director.mode === "late") await director.hold;
    if (director.mode === "down") return await route.abort();
    if (director.mode === "answer" || director.mode === "late" || director.mode === "eager") {
      // The real route eases only after an engaged night (src/game/engagement.ts); "eager" is a server that eases anyway and
      // claims the night was engaged, which the game must not take on its word.
      const eases = director.mode === "eager" || !rules.engagement || rules.engagement === "engaged";
      director.decision = {
        ...rules,
        source: "mubit",
        tide: eases ? Math.max(0.6, Math.round((rules.rulesTide - 0.1) * 100) / 100) : rules.rulesTide,
        mix: eases ? { satyr: 1, cyclops: 0.6, harpy: 1.5 } : { satyr: 1, cyclops: 1, harpy: 1.5 },
        creatureShare: eases ? 0.2 : 0.25,
        line: DIRECTOR_LINE,
        playId,
        ...(director.mode === "eager" ? { engagement: "engaged" } : {}),
      };
      return await route.fulfill({ json: { decision: director.decision } });
    }
    return await route.fulfill({
      json: { decision: rules, fallback: director.mode === "fallback" ? "timeout" : "unavailable" },
    });
  } catch {
    // the page gave up on this answer (it started the next night) or was closed
  }
}
const stubDirector = async (target) => {
  await target.route("**/api/director", serveDirector);
  await target.route("**/api/plays", serveDirector);
};

// A recorded night as /api/plays/<id> serves it, played on a sim that is not this build's (`sim` is a fingerprint no
// build has), or with `sim` left out as plays from before fingerprints are. The page is never given the real store.
const otherVersionPlay = (id, withSim) => ({
  v: 1,
  id,
  session: "verifier",
  build: "abc1234",
  ...(withSim ? { sim: "000000000000" } : {}),
  startedAt: "2026-10-20T21:00:00.000Z",
  seed: 7,
  legacy: { night: 3, generation: 2, tide: 1.1, levels: {}, heir: { ...newLegacy().heir, name: "Theodora" } },
  inputs: [],
  timeline: Array.from({ length: 40 }, (_, second) => [second + 1, 0, 3, 5, 0, 0]), // night 3 lasts 40 s
  steps: 2400,
  outcome: "dawn",
  stats: { kills: 17, lampsLost: 1, hpLost: 2, time: 40, oilEarned: 30, hp: 3, maxHp: 5, lit: 3 },
});
const REFUSED_PLAYS = [
  ["another sim version", otherVersionPlay("2026-10-20-21-00-00-othersim1", true), "08b-replay-refused"],
  ["no recorded sim", otherVersionPlay("2026-10-20-21-00-00-nosimrec1", false), "08c-replay-unknown-sim"],
];
const serveFixturePlay = (play) => (route) => route.fulfill({ json: play });

const browser = await chromium.launch({ headless: HEADLESS, args: ["--window-size=1040,760"] });
let page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
await stubSea(page);
await stubDirector(page);
const lab = await browser.newPage(); // blank page used to decode and compare PNGs
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
});

const shots = [];
const checks = [];
const check = (scene, name, passed, detail) => checks.push({ scene, name, ok: !!passed, detail });

// --- helpers ------------------------------------------------------------------------------------------------
const settle = () =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function freeze() {
  await page.evaluate(() => {
    const scene = window.lampwarden.scene();
    scene.setPaused(true);
    scene.freezeClock(1.25);
  });
  await page.waitForTimeout(120);
  await settle();
}
async function shoot(name, whole = false) {
  const file = `${OUT}/latest/${name}.png`;
  if (whole) await page.screenshot({ path: file });
  else await page.locator(".stage").screenshot({ path: file });
  shots.push(name);
  return readFileSync(file).toString("base64");
}
// mean luminance of boxes [x, y, width, height] in canvas pixels (the stage is 960x600 at deviceScaleFactor 1)
const luminance = (encoded, boxes) =>
  lab.evaluate(
    async ({ encoded, boxes }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return boxes.map(([x, y, width, height]) => {
        const data = context.getImageData(Math.round(x), Math.round(y), width, height).data;
        let total = 0;
        for (let index = 0; index < data.length; index += 4)
          total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
        return total / (data.length / 4);
      });
    },
    { encoded, boxes },
  );
const imageStats = (encoded) =>
  lab.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let sumOfSquares = 0;
    const pixelCount = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      const level = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      sum += level;
      sumOfSquares += level * level;
    }
    const mean = sum / pixelCount;
    return {
      mean,
      deviation: Math.sqrt(sumOfSquares / pixelCount - mean * mean),
      width: canvas.width,
      height: canvas.height,
    };
  }, encoded);
// share of pixels that differ by more than 24 levels in any channel; `masks` (boxes [x, y, width, height]) are left out
const diff = (first, second, masks = []) =>
  lab.evaluate(
    async ({ first, second, masks }) => {
      const load = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const firstImage = await load(first);
      const secondImage = await load(second);
      if (firstImage.width !== secondImage.width || firstImage.height !== secondImage.height) return 1;
      let changed = 0;
      let masked = 0;
      for (let index = 0; index < firstImage.data.length; index += 4) {
        const pixel = index / 4;
        const column = pixel % firstImage.width;
        const row = Math.floor(pixel / firstImage.width);
        if (masks.some(([x, y, width, height]) => column >= x && column < x + width && row >= y && row < y + height)) {
          masked++;
          continue;
        }
        if (
          Math.abs(firstImage.data[index] - secondImage.data[index]) > 24 ||
          Math.abs(firstImage.data[index + 1] - secondImage.data[index + 1]) > 24 ||
          Math.abs(firstImage.data[index + 2] - secondImage.data[index + 2]) > 24
        )
          changed++;
      }
      return changed / (firstImage.data.length / 4 - masked);
    },
    { first, second, masks },
  );
// share of pixels in a box that differ between two shots; `masks` (boxes in canvas pixels) are left out of the count
const boxDiff = (first, second, [x, y, width, height], masks = []) =>
  lab.evaluate(
    async ({ first, second, x, y, width, height, masks }) => {
      const load = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(x, y, width, height).data;
      };
      const firstData = await load(first);
      const secondData = await load(second);
      let changed = 0;
      let masked = 0;
      for (let index = 0; index < firstData.length; index += 4) {
        const pixel = index / 4;
        const column = x + (pixel % width);
        const row = y + Math.floor(pixel / width);
        if (
          masks.some(
            ([maskX, maskY, maskWidth, maskHeight]) =>
              column >= maskX && column < maskX + maskWidth && row >= maskY && row < maskY + maskHeight,
          )
        ) {
          masked++;
          continue;
        }
        if (
          Math.abs(firstData[index] - secondData[index]) +
            Math.abs(firstData[index + 1] - secondData[index + 1]) +
            Math.abs(firstData[index + 2] - secondData[index + 2]) >
          30
        )
          changed++;
      }
      return changed / Math.max(1, firstData.length / 4 - masked);
    },
    { first, second, x, y, width, height, masks },
  );
// mean colour of the box's pixels that changed between two shots by more than 40 levels (a sprite drawn over the same
// ground), as [red, green, blue] and how many pixels changed
const changedColour = (first, second, [x, y, width, height]) =>
  lab.evaluate(
    async ({ first, second, x, y, width, height }) => {
      const load = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(x, y, width, height).data;
      };
      const firstData = await load(first);
      const secondData = await load(second);
      const sum = [0, 0, 0];
      let count = 0;
      for (let index = 0; index < firstData.length; index += 4) {
        const change =
          Math.abs(firstData[index] - secondData[index]) +
          Math.abs(firstData[index + 1] - secondData[index + 1]) +
          Math.abs(firstData[index + 2] - secondData[index + 2]);
        if (change <= 40) continue;
        count++;
        for (let channel = 0; channel < 3; channel++) sum[channel] += firstData[index + channel];
      }
      return { colour: sum.map((value) => value / Math.max(1, count)), count };
    },
    { first, second, x: Math.round(x), y: Math.round(y), width, height },
  );
// mean [red, green, blue] of a box
const meanColour = (encoded, [x, y, width, height]) =>
  lab.evaluate(
    async ({ encoded, x, y, width, height }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(Math.round(x), Math.round(y), width, height).data;
      const sum = [0, 0, 0];
      for (let index = 0; index < data.length; index += 4)
        for (let channel = 0; channel < 3; channel++) sum[channel] += data[index + channel];
      return sum.map((value) => value / (data.length / 4));
    },
    { encoded, x, y, width, height },
  );
// How many pixels differ between two stage shots (by more than 6 levels in a channel) where a layer, or a figure, is: its
// footprint is the pixels that differ between `maskOn` (it drawn) and `maskOff` (it left out). Without a mask, every pixel.
const changedWithin = (first, second, maskOn = null, maskOff = null) =>
  lab.evaluate(
    async ({ first, second, maskOn, maskOff }) => {
      const load = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [firstData, secondData] = [await load(first), await load(second)];
      const [onData, offData] = maskOn && maskOff ? [await load(maskOn), await load(maskOff)] : [null, null];
      const apart = (one, other, index) =>
        Math.max(Math.abs(one[index] - other[index]), Math.abs(one[index + 1] - other[index + 1])) > 6 ||
        Math.abs(one[index + 2] - other[index + 2]) > 6;
      let footprint = 0;
      let changed = 0;
      for (let index = 0; index < firstData.length; index += 4) {
        if (onData && !apart(onData, offData, index)) continue;
        footprint++;
        if (apart(firstData, secondData, index)) changed++;
      }
      return { footprint, changed };
    },
    { first, second, maskOn, maskOff },
  );
// The scene names the layers the verifier needs to switch (Scene.tsx: a `label` on the Pixi object). Hiding one sets
// `renderable`, which the scene never touches, so it stays hidden while the frames run.
const showLayers = (labels, shown) =>
  page.evaluate(
    ({ labels, shown }) => {
      let matched = 0;
      const visit = (node) => {
        if (labels.includes(node.label)) {
          node.renderable = shown;
          matched++;
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.lampwarden.app().stage);
      // a label the scene no longer gives would leave the layer showing and the checks passing for the wrong reason
      if (matched === 0) throw new Error(`no layer is labelled ${labels.join(" or ")}`);
    },
    { labels, shown },
  );
const stageShot = async () => {
  await settle();
  await page.waitForTimeout(40);
  return (await page.locator(".stage").screenshot()).toString("base64");
};
const text = (selector) => page.locator(selector).allInnerTexts();

// The weapons of each sex as the UI shows them: the touch buttons' icons and the shop's melee and ranged upgrades.
const WEAPONS = {
  male: {
    strike: "blade",
    shoot: "shoot",
    blade: { icon: "blade", label: "Keener blade" },
    quiver: { icon: "quiver", label: "Deeper quiver" },
  },
  female: {
    strike: "spear",
    shoot: "sling",
    blade: { icon: "spear", label: "Keener spear" },
    quiver: { icon: "pouch", label: "Fuller pouch" },
  },
};
const WARDEN_NAMES = { male: "son", female: "daughter" };
// An offer seed whose next shop sells both the melee and the ranged upgrade, so the weapon icons show in the shop
// (openShop advances the seed before it draws, which is what the probe runs). Set before a night ends.
const WEAPON_SHOP_SEED = (() => {
  for (let seed = 1; ; seed++) {
    const probe = { ...newLegacy(seed), offerSeed: seed };
    openShop(probe);
    if (probe.offers.includes("blade") && probe.offers.includes("quiver")) return seed;
  }
})();
const seedWeaponShop = () =>
  page.evaluate((seed) => {
    window.lampwarden.legacy().offerSeed = seed;
  }, WEAPON_SHOP_SEED);
const touchIcons = () =>
  page.evaluate(() => ({
    melee: document.querySelector(".tbtn.melee .icon")?.dataset.icon,
    ranged: document.querySelector(".tbtn.ranged .icon")?.dataset.icon,
  }));
async function checkTouchIcons(scene, sex) {
  const icons = await touchIcons();
  check(
    scene,
    `the ${WARDEN_NAMES[sex]}'s Strike and Shoot buttons show the ${WEAPONS[sex].strike} and ${WEAPONS[sex].shoot} icons`,
    icons.melee === WEAPONS[sex].strike && icons.ranged === WEAPONS[sex].shoot,
    `Strike ${icons.melee}, Shoot ${icons.ranged}`,
  );
}
// The shop's melee and ranged upgrades, with the icon, label and effect each card shows. The ranged upgrade of the
// daughter says stones where the son's says shots; neither names the other's weapons.
async function checkWeaponShop(scene, sex) {
  const cards = await page.locator(".btn.up").evaluateAll((elements) =>
    Object.fromEntries(
      elements.map((card) => [
        card.dataset.upgrade,
        {
          icon: card.querySelector(".icon")?.dataset.icon,
          label: card.querySelector("b")?.textContent,
          effect: card.querySelector("span")?.textContent ?? "",
        },
      ]),
    ),
  );
  const { blade, quiver } = cards;
  const expected = WEAPONS[sex];
  const othersWeapons = sex === "female" ? /arrow|quiver|blade|sword|\bbow\b/i : /spear|sling|stone|pouch/i;
  check(
    scene,
    `the ${WARDEN_NAMES[sex]}'s shop shows the ${expected.blade.icon} and ${expected.quiver.icon} upgrades`,
    blade?.icon === expected.blade.icon &&
      blade.label === expected.blade.label &&
      quiver?.icon === expected.quiver.icon &&
      quiver.label === expected.quiver.label &&
      !othersWeapons.test(`${blade.label} ${blade.effect} ${quiver.label} ${quiver.effect}`),
    JSON.stringify([blade, quiver]),
  );
}
// the title scroll: fully unrolled (both rollers on screen, the bottom one below the parchment), and every line on it
// inside the viewport, or brought there by scrolling the parchment
async function checkTitleScroll(tag, viewportWidth, viewportHeight) {
  const scroll = await page.evaluate(
    ({ viewportWidth, viewportHeight }) => {
      const element = document.querySelector(".scroll");
      const body = document.querySelector(".scroll-body");
      const windowElement = document.querySelector(".scroll-window");
      const [top, bottom] = [...document.querySelectorAll(".scroll .roller")].map((roller) =>
        roller.getBoundingClientRect(),
      );
      if (!element || !body || !windowElement || !top || !bottom)
        return { unrolled: false, unreachable: ["no scroll"] };
      const onScreen = (box) =>
        box.left >= -1 && box.top >= -1 && box.right <= viewportWidth + 1 && box.bottom <= viewportHeight + 1;
      const parchment = windowElement.getBoundingClientRect();
      const unrolled =
        element.dataset.stage === "done" &&
        onScreen(top) &&
        onScreen(bottom) &&
        bottom.top >= parchment.bottom - bottom.height &&
        parchment.height > 100;
      const unreachable = [];
      for (const line of document.querySelectorAll(".scroll-content [data-line]")) {
        line.scrollIntoView({ block: "nearest" });
        const box = line.getBoundingClientRect();
        const shown = body.getBoundingClientRect();
        if (!onScreen(box) || box.top < shown.top - 1 || box.bottom > shown.bottom + 1)
          unreachable.push(line.textContent.trim().slice(0, 24) || line.className);
      }
      body.scrollTop = 0;
      return {
        unrolled,
        unreachable,
        detail: `parchment ${Math.round(parchment.width)}x${Math.round(parchment.height)}, content ${body.scrollHeight}px`,
      };
    },
    { viewportWidth, viewportHeight },
  );
  check(tag, "title scroll fully unrolled", scroll.unrolled, scroll.detail);
  check(
    tag,
    "every line on the scroll on screen or scrollable to",
    scroll.unreachable.length === 0,
    scroll.unreachable.join(", "),
  );
}
// A button's pressed look: held down with the mouse it sinks 1 to 2 px onto its edge, the edge shrinks away and the face
// darkens (measured on a screenshot of its face, as well as in its style). The mouse is let go away from the button, so
// nothing is clicked. A disabled button stays as it is.
async function checkPress(tag, name, locator, disabled = false) {
  await locator.scrollIntoViewIfNeeded();
  const read = async () => {
    const box = await locator.boundingBox();
    const style = await locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { edge: computed.getPropertyValue("--edge").trim(), face: computed.backgroundImage };
    });
    const picture = await page.screenshot({
      clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 },
    });
    const [brightness] = await luminance(picture.toString("base64"), [[0, 0, box.width - 8, box.height - 8]]);
    return { top: box.y, brightness, ...style };
  };
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const rest = await read();
  await page.mouse.down();
  const held = await read();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  const sank = held.top - rest.top;
  const darker = rest.brightness - held.brightness;
  const detail = `sank ${sank.toFixed(1)} px, edge ${rest.edge} → ${held.edge}, face ${darker.toFixed(1)} darker`;
  check(
    tag,
    name,
    disabled
      ? sank === 0 && held.edge === rest.edge && held.face === rest.face && Math.abs(darker) < 1
      : sank >= 1 && sank <= 2 && rest.edge !== "0px" && held.edge === "0px" && held.face !== "none" && darker > 3,
    detail,
  );
}
// a press made by code (the pad's A, Enter) shows for a moment and goes
async function checkCodePress(tag, name, press, pressedElement, release) {
  await press();
  const during = await page.evaluate(pressedElement);
  await (release ?? (() => {}))();
  await page.waitForTimeout(250);
  const after = await page.evaluate(pressedElement);
  check(tag, name, during === true && after === false, `while pressed ${during}, after ${after}`);
}
// on the desktop stage the whole title, controls included, fits the parchment without scrolling
async function checkScrollFits(tag) {
  const room = await page.evaluate(() => {
    const body = document.querySelector(".scroll-body");
    return body ? { needed: body.scrollHeight, shown: body.clientHeight } : null;
  });
  check(
    tag,
    "the scroll holds the controls and the rest without scrolling",
    room !== null && room.needed <= room.shown + 1,
    room && `${room.needed}px of content in ${room.shown}px`,
  );
}
// A creature's name and lore are shown whole wherever the announcement appears (title, dawn, heir; desktop and phone):
// the text is the full string, nothing ellipsizes or line-clamps it, neither element holds more than it shows, and
// both lie inside the panel
async function checkCreatureText(tag, screen, creature) {
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  const shown = await page.evaluate(() => {
    const panel = document.querySelector('.sea[data-state="ready"]');
    if (!panel) return null;
    const panelBox = panel.getBoundingClientRect();
    const read = (selector) => {
      const element = panel.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent,
        ellipsis: style.textOverflow === "ellipsis",
        clamped: [style.getPropertyValue("-webkit-line-clamp"), style.getPropertyValue("line-clamp")].some(
          (value) => value !== "" && value !== "none",
        ),
        holdsMore: element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
        inside:
          box.left >= panelBox.left - 1 &&
          box.right <= panelBox.right + 1 &&
          box.top >= panelBox.top - 1 &&
          box.bottom <= panelBox.bottom + 1,
        lines: Math.round(box.height / Number.parseFloat(style.lineHeight)),
      };
    };
    return { name: read(".sea-name"), lore: read(".sea-lore") };
  });
  const problems = [];
  for (const [part, expected] of [
    ["name", creature.name],
    ["lore", creature.lore],
  ]) {
    const found = shown?.[part];
    if (!found) problems.push(`no ${part}`);
    else {
      if (found.text !== expected) problems.push(`${part} reads "${found.text.slice(0, 30)}"`);
      if (found.ellipsis) problems.push(`${part} has an ellipsis`);
      if (found.clamped) problems.push(`${part} is line-clamped`);
      if (found.holdsMore) problems.push(`${part} holds more than it shows`);
      if (!found.inside) problems.push(`${part} spills out of the panel`);
    }
  }
  check(
    tag,
    `${screen}: the creature's whole name and lore are shown`,
    problems.length === 0,
    problems.join("; ") || `name ${shown.name.lines} line(s), lore ${shown.lore.lines} line(s)`,
  );
}
// A building's whole name is shown wherever the announcement appears, as a creature's is: the line reads in full, nothing
// ellipsizes or line-clamps it, it holds no more than it shows, and it lies inside the screen's content (the scroll's body,
// or the panel) and not clipped by it
async function checkBuildingText(tag, screen, building) {
  await page.waitForSelector('.raised[data-state="ready"]', { timeout: 5000 });
  const shown = await page.evaluate(() => {
    const line = document.querySelector('.raised[data-state="ready"]');
    if (!line) return null;
    const style = getComputedStyle(line);
    const box = line.getBoundingClientRect();
    const frame = (line.closest(".scroll-body") ?? line.closest(".panel") ?? document.body).getBoundingClientRect();
    return {
      text: line.textContent,
      name: line.querySelector(".raised-name")?.textContent,
      ellipsis: style.textOverflow === "ellipsis",
      clamped: [style.getPropertyValue("-webkit-line-clamp"), style.getPropertyValue("line-clamp")].some(
        (value) => value !== "" && value !== "none",
      ),
      holdsMore: line.scrollHeight > line.clientHeight + 1 || line.scrollWidth > line.clientWidth + 1,
      clips: style.overflow !== "visible" && style.whiteSpace === "nowrap",
      inside: box.left >= frame.left - 1 && box.right <= frame.right + 1,
      lines: Math.round(box.height / Number.parseFloat(style.lineHeight)),
    };
  });
  const problems = [];
  if (!shown) problems.push("no line");
  else {
    if (shown.text !== `Raised on the plaza tonight: ${building.name}`)
      problems.push(`reads "${shown.text.slice(0, 40)}"`);
    if (shown.name !== building.name) problems.push("the name is not whole");
    if (shown.ellipsis) problems.push("an ellipsis");
    if (shown.clamped) problems.push("line-clamped");
    if (shown.clips) problems.push("one line that clips");
    if (shown.holdsMore) problems.push("holds more than it shows");
    if (!shown.inside) problems.push("spills out of its frame");
  }
  check(
    tag,
    `${screen}: the building's whole name is shown`,
    problems.length === 0,
    problems.join("; ") || `${shown.lines} line(s), ${building.name.length} characters`,
  );
}
// The title scroll's "How to play" block: one block, of the kind of controls the player is likely using, drawn from the
// glyphs (keys, mouse, pad buttons, touch buttons) in this order, with the weapon icons on the touch buttons, and saying
// how to relight a lamp
async function checkHowToPlay(tag, kind, glyphs, weapons = []) {
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll(".scroll .controls")].map((block) => ({
      kind: block.dataset.controls,
      glyphs: [...block.querySelectorAll("[data-glyph]")].map((glyph) => ({
        name: glyph.dataset.glyph,
        drawn: glyph.querySelectorAll("rect").length,
      })),
      icons: [...block.querySelectorAll("[data-icon]")].map((icon) => icon.dataset.icon),
      text: block.textContent,
      inked: block.hasAttribute("data-line"),
      shown: block.getBoundingClientRect().height > 40,
    })),
  );
  const [block] = blocks;
  const found = block?.glyphs.map((glyph) => glyph.name).join(" ");
  check(
    tag,
    `How to play shows the ${kind} controls`,
    blocks.length === 1 &&
      block.kind === kind &&
      found === glyphs.join(" ") &&
      block.glyphs.every((glyph) => glyph.drawn > 3) &&
      block.icons.join(" ") === weapons.join(" ") &&
      block.inked &&
      block.shown &&
      /How to play/.test(block.text) &&
      /move/.test(block.text) &&
      /strike/.test(block.text) &&
      /shoot/.test(block.text) &&
      /dark lamp/.test(block.text),
    block ? `${blocks.length} block: ${block.kind}, ${found}, icons ${block.icons.join(",") || "none"}` : "no block",
  );
}
// every element matching the selector names one trait and shows exactly that trait's icon, hidden from assistive tech
// because the name is beside it
const TRAIT_ICONS = {
  Swift: "swift",
  Stout: "stout",
  Lamplighter: "lamplighter",
  "Long-armed": "longarm",
  "Keen-eyed": "keen",
};
// On a phone, every piece of visible text is at least 16 px, the smallest size at which the pixel fonts read well and
// sit on their pixel grid
async function checkPhoneText(tag, screen) {
  const small = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const size = Number.parseFloat(style.fontSize);
      if (size < 16) found.push(`${size}px "${node.textContent.trim().slice(0, 24)}"`);
    }
    return found;
  });
  check(
    tag,
    `${screen}: all text at least 16 px`,
    small.length === 0,
    small.slice(0, 4).join("; ") || "all 16 px or more",
  );
}
async function checkTraitIcons(tag, name, selector, expectedCount) {
  const found = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent,
      icons: [...element.querySelectorAll("[data-icon]")].map((icon) => ({
        name: icon.dataset.icon,
        hidden: icon.getAttribute("aria-hidden") === "true",
        drawn: icon.querySelectorAll("rect").length,
      })),
    })),
  );
  const problems = found.flatMap((element) => {
    const label = Object.keys(TRAIT_ICONS).find((trait) => element.text.includes(trait));
    const [icon] = element.icons;
    if (!label) return [`no trait in "${element.text.slice(0, 30)}"`];
    if (element.icons.length !== 1 || icon.name !== TRAIT_ICONS[label])
      return [`${label}: icons ${element.icons.map((shown) => shown.name).join(",") || "none"}`];
    if (!icon.hidden || icon.drawn < 20) return [`${label}: hidden ${icon.hidden}, ${icon.drawn} pixels`];
    return [];
  });
  check(
    tag,
    name,
    found.length === expectedCount && problems.length === 0,
    problems.join("; ") || `${found.length} shown`,
  );
}

// --- the night's props: laid out from its seed (src/scene/decor.ts), so every night stands on a different plaza -------
const PROP_KEYS = [
  "zeus-statue",
  "temple",
  "house",
  "stall",
  "olive",
  "wall",
  "house-ochre",
  "olive-young",
  "broken-column",
  "votive-altar",
  "amphora-stack",
  "galley-dock",
  "trireme",
];
const BOAT_KEYS = ["galley-dock", "trireme"];
const byKeyThenPlace = (first, second) =>
  first[0].localeCompare(second[0]) || first[1] - second[1] || first[2] - second[2];
// the prop sprites on the stage as they are drawn: [key, x, y], in a fixed order
const drawnProps = () =>
  page
    .evaluate((keys) => {
      const found = [];
      const visit = (node) => {
        const label = node.texture?.source?.label ?? "";
        // a live building is drawn from the gallery's sprite
        const liveId = /\/api\/buildings\/([a-z0-9-]+)\/sprite\.png$/.exec(label)?.[1];
        const key = keys.find((name) => label.endsWith(`/sprites/${name}.png`)) ?? (liveId && `building/${liveId}`);
        if (key && node.visible !== false) found.push([key, Math.round(node.x), Math.round(node.y)]);
        for (const child of node.children ?? []) visit(child);
      };
      const app = window.lampwarden.app();
      if (app) visit(app.stage);
      return found;
    }, PROP_KEYS)
    .then((found) => found.sort(byKeyThenPlace));
// the props a seed lays out, in the same form
const laidOutProps = (seed, withBuilding = false) => {
  const layout = decorFor(
    seed | 0,
    withBuilding ? { key: `building/${PLAZA_BUILDING.id}`, extents: PLAZA_BUILDING.extent } : null,
  );
  return [...layout.props, ...layout.boats].map((placed) => [placed.key, placed.x, placed.y]).sort(byKeyThenPlace);
};
// whether the stage shows exactly these props (the trireme rocks on the water, so its y is only close)
const sameProps = (drawn, expected) =>
  drawn.length === expected.length &&
  drawn.every(([key, x, y], index) => {
    const [expectedKey, expectedX, expectedY] = expected[index];
    return key === expectedKey && x === expectedX && Math.abs(y - expectedY) <= (BOAT_KEYS.includes(key) ? 5 : 0);
  });
const propSprites = new Map();
// A sprite's painted pixels in the rows of its base (src/scene/extent.ts), by their offset from the anchor, read from the
// committed picture: the check below looks at pixels, not at the numbers the placer was given.
function basePixelsOf(key) {
  let pixels = propSprites.get(key);
  if (!pixels) {
    const live = key.startsWith("building/"); // the fixture building: its picture is made in code
    const image = live ? PLAZA_PICTURE : decodePng(readFileSync(`public/sprites/${key}.png`));
    const anchorRow = (live ? PLAZA_ANCHOR_Y : anchorYFor(key)) * 128;
    pixels = [];
    for (let row = 0; row < 128; row++)
      if (row - anchorRow >= -(key.startsWith("building/") ? 28 : baseBandOf(key)))
        for (let column = 0; column < 128; column++)
          if (image.data[(row * 128 + column) * 4 + 3] > 0) pixels.push([column - 64 + 0.5, row - anchorRow + 0.5]);
    propSprites.set(key, pixels);
  }
  return pixels;
}
// the land props with a painted pixel of their base off the plaza, or less than their margin in from its rim
function propsOffPlaza(props) {
  const problems = [];
  for (const [key, x, y] of props) {
    if (BOAT_KEYS.includes(key) || key === "zeus-statue") continue;
    const margin = key === "wall" ? 4 : 8;
    let off = 0;
    let near = 0;
    for (const [offsetX, offsetY] of basePixelsOf(key)) {
      if (!onPlaza(Math.floor(x + offsetX), Math.floor(y + offsetY))) off++;
      else if (plazaInset(x + offsetX, y + offsetY) < margin - 1) near++;
    }
    if (off || near) problems.push(`${key}@${x},${y}: ${off} pixels off the plaza, ${near} within the margin`);
  }
  return problems;
}
// the boats whose base has a painted pixel on the plaza
function boatsOnStone(props) {
  const problems = [];
  for (const [key, x, y] of props) {
    if (!BOAT_KEYS.includes(key)) continue;
    const onStone = basePixelsOf(key).filter(([offsetX, offsetY]) =>
      onPlaza(Math.floor(x + offsetX), Math.floor(y + offsetY)),
    ).length;
    if (onStone) problems.push(`${key}@${x},${y}: ${onStone} pixels on the plaza`);
  }
  return problems;
}
function checkPropsOnPlaza(scene, label, props) {
  const stone = propsOffPlaza(props);
  check(
    scene,
    `${label}: every land prop's painted base is on the plaza, a margin in from its rim`,
    props.length >= 6 && stone.length === 0,
    stone.join("; ") || `${props.length} props drawn`,
  );
  const sea = boatsOnStone(props);
  check(scene, `${label}: the boats lie on the sea`, sea.length === 0, sea.join("; ") || "on the sea");
}

// The frames of the props two nights draw, as boxes to leave out when one night's picture is compared with another's: the
// plaza's props are the one thing two nights do not share.
const propFrames = (...lists) =>
  lists.flatMap((props) => props.map(([key, x, y]) => [x - 64, y - Math.round(anchorYFor(key) * 128), 128, 128]));

// The title scroll's hero cards. The portrait canvas (80 x 94 art pixels, PORTRAIT in src/scene/portrait.ts) holds a
// warden's frame drawn at one offset, the one that puts the middle of his solid (opaque) body in the middle of it; a
// chosen card swings the melee frames once and is at rest again.
const HERO_PROBE = `
  window.heroProbe = {
    hash(data) {
      let hash = 2166136261;
      for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    },
    canvas(sex) {
      return document.querySelector('.hero-card[data-sex="' + sex + '"] canvas');
    },
    pixels(canvas) {
      return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    },
    signature(sex) {
      return this.hash(this.pixels(this.canvas(sex)));
    },
    // the first and last column of the canvas's opaque pixels
    body(sex) {
      const canvas = this.canvas(sex);
      const data = this.pixels(canvas);
      let first = canvas.width;
      let last = -1;
      for (let row = 0; row < canvas.height; row++)
        for (let column = 0; column < canvas.width; column++)
          if (data[(row * canvas.width + column) * 4 + 3] >= 250) {
            first = Math.min(first, column);
            last = Math.max(last, column);
          }
      return { first, last, width: canvas.width };
    },
    // what each frame must look like, drawn here from the atlas on its own: the south-facing column, the idle frame at
    // atlas row 0 and the melee frames at rows 10 to 14, all at the offset that centres the idle frame's body. These
    // numbers are the atlas layout and PORTRAIT typed out again on purpose: the check compares the card with a second
    // statement of the layout, so a change to one of them that the card does not follow fails here.
    async expected(sex) {
      const size = 128;
      const image = new Image();
      image.src = "/sprites/hero/" + sex + ".png";
      await image.decode();
      const target = this.canvas(sex);
      const reader = document.createElement("canvas");
      reader.width = size;
      reader.height = size;
      const readerContext = reader.getContext("2d", { willReadFrequently: true });
      readerContext.drawImage(image, 2 * size, 0, size, size, 0, 0, size, size);
      const data = readerContext.getImageData(0, 0, size, size).data;
      let first = size;
      let last = -1;
      for (let row = 0; row < size; row++)
        for (let column = 0; column < size; column++)
          if (data[(row * size + column) * 4 + 3] >= 250) {
            first = Math.min(first, column);
            last = Math.max(last, column);
          }
      const shift = Math.round(target.width / 2 - (first + last + 1) / 2);
      const top = 14; // PORTRAIT.top
      const hashRow = (row) => {
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 2 * size, row * size, size, size, shift, -top, size, size);
        return this.hash(this.pixels(canvas));
      };
      return { idle: hashRow(0), melee: [10, 11, 12, 13, 14].map(hashRow) };
    },
  };
`;
const HERO_STEP = 16; // ms of the page's clock between samples
const HERO_SEXES = ["male", "female"];
// the looks that follow one another, as runs: [{ hash, from }], from in ms after the start
const runsOf = (trail, index) => {
  const runs = [];
  for (const sample of trail)
    if (runs.at(-1)?.hash !== sample[index]) runs.push({ hash: sample[index], from: sample[0] });
  return runs;
};
const heroSignatures = (target) =>
  target.evaluate((sexes) => sexes.map((sex) => window.heroProbe.signature(sex)), HERO_SEXES);
async function openHeroPage(reducedMotion) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await stubSea(context);
  const heroPage = await context.newPage();
  await heroPage.clock.install();
  await heroPage.goto(BASE_URL);
  await heroPage.waitForSelector(".hero-card canvas");
  // a press while the scroll unrolls only completes the unrolling
  await heroPage.waitForSelector(".scroll[data-stage='done']", { timeout: 30000 });
  await heroPage.evaluate(HERO_PROBE);
  await heroPage.waitForFunction(
    () => ["male", "female"].every((sex) => window.heroProbe.body(sex).last >= 0),
    undefined,
    {
      polling: 100,
    },
  );
  // from here the page's clock moves only when it is stepped
  await heroPage.clock.pauseAt((await heroPage.evaluate(() => Date.now())) + 100);
  return { context, heroPage };
}
async function sampleHero(heroPage, milliseconds) {
  const trail = [];
  for (let elapsed = HERO_STEP; elapsed <= milliseconds; elapsed += HERO_STEP) {
    await heroPage.clock.runFor(HERO_STEP);
    trail.push([elapsed, ...(await heroSignatures(heroPage))]);
  }
  return trail;
}
async function checkHeroCards() {
  // the body in the middle of the card, for both sexes
  await page.evaluate(HERO_PROBE);
  await page.waitForTimeout(600); // the checks before this one chose a card: let its swing end, the warden is at rest
  for (const sex of HERO_SEXES) {
    await page.waitForFunction((sex) => window.heroProbe.body(sex).last >= 0, sex, { polling: 100 });
    const { first, last, width } = await page.evaluate((sex) => window.heroProbe.body(sex), sex);
    const offCentre = (first + last + 1) / 2 - width / 2;
    check(
      "hero-cards",
      `${sex}: the solid body's middle is within 1 art pixel of the card's middle`,
      Math.abs(offCentre) <= 1,
      `body columns ${first}-${last} of ${width}, ${offCentre} px off`,
    );
    const scale = await page.evaluate((sex) => {
      const canvas = window.heroProbe.canvas(sex);
      return canvas.getBoundingClientRect().width / canvas.width;
    }, sex);
    check("hero-cards", `${sex}: the portrait is drawn at a whole multiple`, Number.isInteger(scale), `${scale}x`);
  }

  // the swing, with the page's clock stepped
  const { context, heroPage } = await openHeroPage(false);
  const expected = {};
  for (const sex of HERO_SEXES) expected[sex] = await heroPage.evaluate((sex) => window.heroProbe.expected(sex), sex);
  const resting = await heroSignatures(heroPage);
  check(
    "hero-cards",
    "both wardens start at rest on the idle frame, drawn at the centring offset",
    resting[0] === expected.male.idle && resting[1] === expected.female.idle,
  );
  const swingMilliseconds = (5 / 14) * 1000; // five melee frames at FRAMES_PER_SECOND.melee
  const swingChecks = async (name, sex, other, choose) => {
    await choose();
    const trail = await sampleHero(heroPage, 700);
    const runs = runsOf(trail, 1 + HERO_SEXES.indexOf(sex));
    const inOrder = runs.slice(0, 5).every((run, index) => run.hash === expected[sex].melee[index]);
    const back = runs.length === 6 && runs.at(-1).hash === expected[sex].idle;
    const returnedAt = runs.at(-1).from;
    check(
      "hero-cards",
      `${name}: ${sex} swings the five melee frames in order, then is at rest`,
      inOrder && back,
      `${runs.length} looks, at rest after ${returnedAt} ms`,
    );
    check(
      "hero-cards",
      `${name}: the swing takes five melee frames' time (${Math.round(swingMilliseconds)} ms)`,
      back && Math.abs(returnedAt - swingMilliseconds) <= 100,
      `${returnedAt} ms`,
    );
    const otherRuns = runsOf(trail, 1 + HERO_SEXES.indexOf(other));
    check(
      "hero-cards",
      `${name}: the other card stays at rest`,
      otherRuns.length === 1 && otherRuns[0].hash === expected[other].idle,
      `${otherRuns.length} looks`,
    );
  };
  await swingChecks("a click", "female", "male", () => heroPage.locator('.hero-card[data-sex="female"]').click());
  await swingChecks("a second click on the chosen card", "female", "male", () =>
    heroPage.locator('.hero-card[data-sex="female"]').click(),
  );
  await swingChecks("Enter on a focused card", "male", "female", async () => {
    await heroPage.locator('.hero-card[data-sex="male"]').focus();
    await heroPage.keyboard.press("Enter");
  });
  // choosing the other card in the middle of a swing puts the first at rest at once
  await heroPage.locator('.hero-card[data-sex="female"]').click();
  await heroPage.clock.runFor(100);
  await heroPage.locator('.hero-card[data-sex="male"]').click();
  await heroPage.clock.runFor(HERO_STEP * 2);
  check(
    "hero-cards",
    "choosing the other card in the middle of a swing puts the first at rest",
    (await heroSignatures(heroPage))[1] === expected.female.idle,
  );
  await context.close();

  // with reduced motion the idle frame only
  const reduced = await openHeroPage(true);
  const reducedExpected = await reduced.heroPage.evaluate(() => window.heroProbe.expected("female"));
  await reduced.heroPage.locator('.hero-card[data-sex="female"]').click();
  const reducedTrail = await sampleHero(reduced.heroPage, 700);
  const reducedRuns = runsOf(reducedTrail, 2);
  check(
    "hero-cards",
    "reduced motion: choosing a card shows the idle frame only",
    reducedRuns.length === 1 && reducedRuns[0].hash === reducedExpected.idle,
    `${reducedRuns.length} looks`,
  );
  await reduced.context.close();
}
// Shows or hides the plaza's props (all but the statue, which stands where it always has). The scenes that measure the
// ground by lamplight read boxes of bare stone beside a lamp, which a prop of the night's layout may stand on.
const setPropsShown = (shown) =>
  page.evaluate(
    ([keys, visible]) => {
      const visit = (node) => {
        const label = node.texture?.source?.label ?? "";
        if (keys.some((name) => label.endsWith(`/sprites/${name}.png`))) node.visible = visible;
        for (const child of node.children ?? []) visit(child);
      };
      const app = window.lampwarden.app();
      if (app) visit(app.stage);
    },
    [PROP_KEYS.filter((key) => key !== "zeus-statue"), shown],
  );

// The dock's bridge is drawn: at the centre of each board the seed lays out the picture is brown (red as strong as blue,
// under the night's tint, where the sea is blue by 30 levels or more), and the bridge ends against the rim, not out at sea.
async function checkBridge(scene, label, picture, seed) {
  const boards = decorFor(seed | 0).planks;
  const [, ...bridged] = boards; // the first lies under the pier
  const problems = [];
  for (const [x, y] of bridged) {
    const [red, , blue] = await meanColour(picture, [x - 2, y - 1, 4, 3]);
    if (blue - red > 12) problems.push(`${x},${y}: red ${red.toFixed(0)}, blue ${blue.toFixed(0)}`);
  }
  const last = boards.at(-1);
  const against = last ? shoreDistanceOf(last[0], last[1]) : Number.POSITIVE_INFINITY;
  check(
    scene,
    `${label}: planks lead from the dock to the plaza's rim`,
    boards.length >= 3 && problems.length === 0 && against > 0 && against <= 4,
    problems.join("; ") || `${boards.length} boards, the last ${against.toFixed(1)} steps off the stone`,
  );
}

const heroTextures = () =>
  page.evaluate(() => {
    const found = [];
    const visit = (node) => {
      const source = node.texture?.source?.label ?? "";
      if (source.includes("/hero/")) found.push(source.slice(source.indexOf("/hero/") + 6));
      for (const child of node.children ?? []) visit(child);
    };
    const app = window.lampwarden.app();
    if (app) visit(app.stage);
    return found;
  });

// --- scenarios ----------------------------------------------------------------------------------------------
await page.goto(`${BASE_URL}/?verify=1`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
await settle();

// 1 title
let shot = await shoot("01-title");
const titleStats = await imageStats(shot);
check("title", "canvas is not blank", titleStats.deviation > 12, `luminance sd ${titleStats.deviation.toFixed(1)}`);
const fontsLoaded = () =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const families = (element) =>
      getComputedStyle(element)
        .fontFamily.split(",")
        .map((family) => family.trim().replace(/["']/g, ""));
    const wanted = [...families(document.querySelector(".logo")).slice(0, 1), ...families(document.body).slice(0, 1)];
    return wanted.map((family) => ({
      family,
      ok: [...document.fonts].some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded"),
    }));
  });

const logo = await page.evaluate(() => {
  const image = document.querySelector(".brand img");
  return image && { ok: image.complete && image.naturalWidth === 68, width: image.getBoundingClientRect().width };
});
check(
  "title",
  "logo image loaded at a whole multiple",
  logo?.ok && logo.width % 68 === 0,
  logo && `${logo.width}px wide`,
);
check("title", "start button", await page.getByRole("button", { name: "Light the lamps" }).isVisible());
await checkTitleScroll("title", 1000, 640);
await checkHowToPlay("title", "keyboard", ["W", "A", "S", "D", "J", "K", "mouse"]);
await checkScrollFits("title");
await checkPress(
  "button-press",
  "Light the lamps sinks and darkens",
  page.getByRole("button", { name: "Light the lamps" }),
);
await checkPress("button-press", "a hero card sinks and darkens", page.locator('.hero-card[data-sex="female"]'));
// Enter on the hero card already chosen: the press shows, and letting go chooses what was chosen, changing nothing
await checkCodePress(
  "button-press",
  "Enter on a focused button shows the press for a moment",
  async () => {
    await page.locator(".hero-card[aria-pressed='true']").focus();
    await page.keyboard.down("Enter");
  },
  () => document.querySelector(".hero-card[aria-pressed='true']")?.hasAttribute("data-pressed"),
  () => page.keyboard.up("Enter"),
);
const chosenCards = await page.locator(".hero-card[aria-pressed='true']").count();
check(
  "title",
  "hero choice: two cards, one chosen",
  (await page.locator(".hero-card").count()) === 2 && chosenCards === 1,
);
await checkHeroCards();

await checkTraitIcons("title", "the warden line shows the trait's icon", ".scroll .warden", 1);

// 2 night start: all five lamps lit
await page.getByRole("button", { name: "Light the lamps" }).click();
await page.waitForSelector('[data-phase="night"]');
await checkTraitIcons("night", "the HUD's warden line shows the trait's icon", ".hud .stats > div:first-child", 1);
await freeze();
const lamps = await page.evaluate(() => window.lampwarden.state().lamps.map((lamp) => [lamp.x, lamp.y]));
const head = ([x, y]) => [x - 4, y - 82, 8, 8];
const floor = ([x, y]) => [x + 30, y - 4, 10, 6];
shot = await shoot("02-night-start");
const nightStats = await imageStats(shot);
const litHeads = await luminance(shot, lamps.map(head));
check("night-start", "five lamps in state", lamps.length === 5);
check(
  "night-start",
  "every lit lantern glows",
  litHeads.every((level) => level > 150),
  litHeads.map((level) => level.toFixed(0)).join(" "),
);
check("night-start", "HUD shows 5 lit lamps", (await page.locator(".lamps span.lit").count()) === 5);
// this night's props, laid out from its seed
const liveProps = await drawnProps();
checkPropsOnPlaza("night-start", "the night's plaza", liveProps);
check("night-start", "night is dark overall", nightStats.mean < 110, `mean ${nightStats.mean.toFixed(1)}`);

// 3 combat: one of each monster near lamps, a shot in flight, a lamp being clawed
await page.evaluate(() => {
  const state = window.lampwarden.state();
  const add = (kind, x, y, extra = {}) =>
    state.monsters.push({
      id: state.nextId++,
      kind,
      x,
      y,
      health: kind === "cyclops" ? 2 : 1,
      age: 0,
      wobble: 0,
      snuff: 0,
      attackCooldown: 0,
      hurt: 0,
      ...extra,
    });
  add("satyr", state.lamps[2].x + 4, state.lamps[2].y + 6, { snuff: 1.2 });
  add("harpy", 300, 260);
  add("cyclops", 650, 450);
  state.shots.push({ id: state.nextId++, x: 420, y: 300, velocityX: 300, velocityY: -100, life: 1, hit: [] });
  state.hero.x = 560;
  state.hero.y = 360;
});
await page.evaluate(() => window.lampwarden.scene().setPaused(true));
await settle();
shot = await shoot("03-combat");
const nightStart = readFileSync(`${OUT}/latest/02-night-start.png`).toString("base64");
// sprite boxes: anchor is near the feet, flying monsters are drawn 22 px higher
const spriteBox = (x, y, flying) => [x - 30, y - (flying ? 22 : 0) - 100, 60, 100];
const drawn = [
  await boxDiff(shot, nightStart, spriteBox(300, 260, true)),
  await boxDiff(shot, nightStart, spriteBox(650, 450, false)),
  await boxDiff(shot, nightStart, spriteBox(lamps[2][0] + 4, lamps[2][1] + 6, false)),
];
check(
  "combat",
  "each monster drawn where it stands",
  drawn.every((share) => share > 0.08),
  drawn.map((share) => `${(share * 100).toFixed(0)}%`).join(" "),
);
// stray strokes: the sky band above the plaza should look the same as at night start
const sky = await boxDiff(shot, nightStart, [0, 60, 960, 60]);
check("combat", "no stray strokes across the sky", sky < 0.001, `${(sky * 100).toFixed(2)}% of the sky changed`);

// 3b the hand-made monsters are drawn from their frames: they walk while they travel, claw with the attack frames, idle when a
// hit holds them, and face the way they travel, the three directions that are not drawn mirrored like the warden's
{
  const handMadeFrames = (kind) =>
    page.evaluate((kind) => {
      const found = [];
      const visit = (node) => {
        const label = node.texture?.source?.label ?? "";
        if (label.startsWith(`/sprites/${kind}-frames.png#`) && node.visible && !node.destroyed)
          found.push({
            direction: label.split("#")[1].split("/")[0],
            pose: label.split("/").pop(),
            flipped: node.scale.x < 0,
            x: node.position.x,
            y: node.position.y,
          });
        for (const child of node.children ?? []) visit(child);
      };
      const app = window.lampwarden.app();
      if (app) visit(app.stage);
      return found;
    }, kind);
  const standMonster = (kind, patch) =>
    page.evaluate(
      ([kind, patch]) => {
        const state = window.lampwarden.state();
        window.lampwarden.scene().setPaused(true);
        state.shots = [];
        state.puffs = [];
        state.monsters = [
          {
            id: state.nextId++,
            kind,
            x: 600,
            y: 400,
            health: 5,
            age: 0,
            wobble: 0,
            snuff: 0,
            attackCooldown: 0,
            hurt: 0,
            stun: 0,
            knockX: 0,
            knockY: 0,
            ...patch,
          },
        ];
        state.hero.x = 200;
        state.hero.y = 200;
      },
      [kind, patch],
    );
  const handMadeBox = spriteBox(600, 400, false);
  const view = async (kind, patch) => {
    await standMonster(kind, patch);
    await page.waitForTimeout(100); // the monster list reaches React on the next render
    await settle();
    return (await handMadeFrames(kind))[0];
  };
  const results = {};
  for (const kind of ["satyr", "cyclops", "harpy"]) {
    const walk1 = await view(kind, { age: 0 });
    const walk4 = await view(kind, { age: 0.31 });
    const claw = await view(kind, { snuff: 0.1 });
    const strike = await view(kind, { attackCooldown: 0.95 });
    const rest = await view(kind, { stun: 0.05 });
    results[kind] = { walk1, walk4, claw, strike, rest };
    // a frame that was slid along its cell is drawn that far back, so the monster stands where it does (the monster is at
    // 600, 400 and its age is 0 in the claw and the strike: no bob)
    const lift = kind === "harpy" ? 22 : 0; // the harpy hovers
    const slidBack = (frame) => {
      const cell = creatureAtlasLayout(SHEET_FRAMES[kind]).cells.find(
        (candidate) => candidate.direction === frame?.direction && creaturePoseName(candidate) === frame?.pose,
      );
      const [across, down] = cell?.shift ?? [NaN, NaN];
      return frame?.x === 600 + (frame?.flipped ? across : -across) && frame?.y === 400 - lift - down;
    };
    check(
      "hand-made",
      `a ${kind} frame slid along its cell is drawn back by the slide`,
      [walk1, claw, strike, rest].every(slidBack),
      [claw, strike].map((frame) => `${frame?.pose}@${frame?.x},${frame?.y}`).join(" "),
    );
    check(
      "hand-made",
      `the ${kind} walks, claws and idles in its own frames`,
      walk1?.pose === "walk1" &&
        walk4?.pose === "walk4" &&
        claw?.pose.startsWith("attack") &&
        strike?.pose.startsWith("attack") &&
        rest?.pose.startsWith("idle"),
      [walk1, walk4, claw, strike, rest].map((frame) => frame?.pose).join(" "),
    );
    check(
      "hand-made",
      `the ${kind} faces the middle of the plaza before it moves`,
      walk1?.direction === "se" && walk1?.flipped === true,
      `${walk1?.direction}${walk1?.flipped ? "'" : ""}`,
    );
  }
  // the satyr travels each of the eight ways
  const ways = [
    ["e", [1, 0], "e", false],
    ["se", [Math.SQRT1_2, Math.SQRT1_2], "se", false],
    ["s", [0, 1], "s", false],
    ["sw", [-Math.SQRT1_2, Math.SQRT1_2], "se", true],
    ["w", [-1, 0], "e", true],
    ["nw", [-Math.SQRT1_2, -Math.SQRT1_2], "ne", true],
    ["n", [0, -1], "n", false],
    ["ne", [Math.SQRT1_2, -Math.SQRT1_2], "ne", false],
  ];
  const seen = [];
  let allWays = true;
  const wayShots = {};
  for (const [way, ground, drawn, mirrored] of ways) {
    await standMonster("satyr", { age: 0.31 });
    await page.waitForTimeout(100);
    await settle();
    await page.evaluate(([groundX, groundY]) => {
      const [monster] = window.lampwarden.state().monsters;
      monster.x += groundX * 14;
      monster.y += (groundY * 14) / 2;
    }, ground);
    await settle();
    const frame = (await handMadeFrames("satyr"))[0];
    seen.push(`${way}:${frame?.direction}${frame?.flipped ? "'" : ""}`);
    allWays = allWays && frame?.direction === drawn && frame?.flipped === mirrored && frame?.pose === "walk4";
    if (["e", "sw", "n"].includes(way)) wayShots[way] = await shoot(`03b-satyr-walks-${way}`);
  }
  check("hand-made", "the satyr walks facing each of the eight ways", allWays, seen.join(" "));
  const apart = await boxDiff(wayShots.e, wayShots.n, handMadeBox);
  check(
    "hand-made",
    "the satyr looks different from the east and from the north",
    apart > 0.05,
    `${(apart * 100).toFixed(0)}%`,
  );
  // a blow flashes the frame it is on, white, the same shape
  await standMonster("satyr", { age: 0.31 });
  await page.waitForTimeout(100);
  await settle();
  const satyrPlain = await shoot("03b-satyr-walk");
  await page.evaluate(() => {
    for (const monster of window.lampwarden.state().monsters) monster.hurt = 0.25;
  });
  await settle();
  const satyrFlash = await shoot("03b-satyr-flash");
  const [satyrPlainLight, satyrFlashLight] = await Promise.all([
    luminance(satyrPlain, [handMadeBox]),
    luminance(satyrFlash, [handMadeBox]),
  ]);
  check(
    "hand-made",
    "a blow flashes the satyr's frame white",
    satyrFlashLight[0] > satyrPlainLight[0] + 25,
    `${satyrPlainLight[0].toFixed(0)} → ${satyrFlashLight[0].toFixed(0)}`,
  );
  await standMonster("satyr", { snuff: 0.1 });
  await page.waitForTimeout(100);
  await settle();
  await shoot("03b-satyr-claws");
  await standMonster("cyclops", { age: 0.31 });
  await page.waitForTimeout(100);
  await settle();
  await shoot("03b-cyclops-walks");
  await standMonster("harpy", { age: 0.31 });
  await page.waitForTimeout(100);
  await settle();
  await shoot("03b-harpy-walks");
}

// 4 two dark lamps, one being relit; the lamp-light scenes up to 5 measure bare ground, so the props are put away
await setPropsShown(false);
await page.evaluate(() => {
  const state = window.lampwarden.state();
  state.monsters = [];
  state.shots = [];
  state.lamps[0].lit = false;
  state.lamps[1].lit = false;
  state.lamps[1].relight = 0.5;
  state.hero.x = state.lamps[1].x + 10;
  state.hero.y = state.lamps[1].y + 8;
});
await settle();
await page.waitForTimeout(80);
shot = await shoot("04-dark-lamps");
const darkHeads = await luminance(shot, lamps.map(head));
const darkSky = await boxDiff(shot, nightStart, [0, 60, 960, 60]);
check(
  "dark-lamps",
  "no stray strokes across the sky",
  darkSky < 0.001,
  `${(darkSky * 100).toFixed(2)}% of the sky changed`,
);
check(
  "dark-lamps",
  "dark lanterns are darker than lit ones",
  Math.max(darkHeads[0], darkHeads[1]) + 40 < Math.min(darkHeads[2], darkHeads[3], darkHeads[4]),
  darkHeads.map((level) => level.toFixed(0)).join(" "),
);
const pool = await luminance(shot, lamps.map(floor));
check(
  "dark-lamps",
  "no light pool under dark lamps",
  Math.max(pool[0], pool[1]) + 8 < Math.min(pool[2], pool[3]),
  pool.map((level) => level.toFixed(0)).join(" "),
);

// 4a the ring round a dark lamp is a mark on the ground: it lies under the lamp, whose legs stand in front of it, while the
// relight progress, drawn over the lantern, stays on top and readable
{
  const [darkX, darkY] = lamps[1];
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.lamps[1].relight = 0; // no progress ring for the first look: only the ground's
    state.hero.x = 80;
    state.hero.y = 560;
  });
  const ringShot = await stageShot();
  await showLayers(["ground-marks", "marks"], false);
  const noRing = await stageShot();
  await showLayers(["ground-marks", "marks"], true);
  await showLayers(["marks"], false);
  const ringWithoutMarks = await stageShot();
  await showLayers(["marks"], true);
  await showLayers(["lamp-post", "ground-marks", "marks"], false);
  const noLamp = await stageShot();
  await showLayers(["lamp-post", "ground-marks", "marks"], true);
  await showLayers(["ground-marks", "marks"], false);
  const lampAlone = await stageShot();
  await showLayers(["ground-marks", "marks"], true);
  writeFileSync(`${OUT}/latest/04a-dark-lamp-ring.png`, Buffer.from(ringShot, "base64"));
  shots.push("04a-dark-lamp-ring");
  // the ring's pixels, and how many of them are over the lamp: the lamp's own pixels are those it adds to the scene
  const [ringDrawn, ringOverLamp, ringInGround] = [
    await changedWithin(ringShot, noRing),
    await changedWithin(ringShot, noRing, lampAlone, noLamp),
    await changedWithin(ringWithoutMarks, noRing),
  ];
  check("dark-lamps", "the dark lamp's ring is drawn", ringDrawn.changed > 100, `${ringDrawn.changed} pixels`);
  check(
    "dark-lamps",
    "the ring is on the ground, not in the marks over the sprites",
    ringInGround.changed > 100,
    `${ringInGround.changed} pixels with the marks hidden`,
  );
  check(
    "dark-lamps",
    "the ring lies under the lamp: not one of the lamp's pixels is drawn over by it",
    ringOverLamp.changed === 0,
    `${ringOverLamp.changed} of the lamp's ${ringOverLamp.footprint} pixels`,
  );
  // the lamp being relit shows its progress ring over the lantern
  await page.evaluate(() => {
    window.lampwarden.state().lamps[1].relight = 0.5;
  });
  const progressOn = await stageShot();
  await showLayers(["marks"], false);
  const progressOff = await stageShot();
  await showLayers(["marks"], true);
  const progress = await changedWithin(progressOn, progressOff);
  check(
    "dark-lamps",
    "the relight progress ring is drawn over the lamp's head",
    progress.changed > 30,
    `${progress.changed} pixels at lamp ${darkX},${darkY}`,
  );
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.hero.x = state.lamps[1].x + 10;
    state.hero.y = state.lamps[1].y + 8;
  });
  await settle();
}

// 4b lamp light on the characters: a figure in a pool stands in front of it, is lit warm and casts a shadow away from the lamp
await page.evaluate(() => {
  const state = window.lampwarden.state();
  state.monsters = [];
  state.shots = [];
  for (const lamp of state.lamps) lamp.lit = true;
  state.lamps[1].relight = 0;
  state.hero.animation = "idle";
  state.hero.frameTime = 0;
});
const placeHero = async (x, y) => {
  await page.evaluate(
    ([heroX, heroY]) => {
      const state = window.lampwarden.state();
      state.hero.x = heroX;
      state.hero.y = heroY;
    },
    [x, y],
  );
  await settle();
  await page.waitForTimeout(60);
  return (await page.locator(".stage").screenshot()).toString("base64");
};
const [lampX, lampY] = lamps[2];
const empty = await placeHero(80, 560); // the warden far from every lamp: the ground as it is
// the statue stands in front of the top lamp's pool: the pool lies on the ground under it
const statue = await meanColour(empty, [470, 262, 16, 18]);
check(
  "lamp-lighting",
  "a statue in front of a lamp's pool is not washed by it",
  statue[2] - statue[0] > 20,
  `statue torso rgb ${statue.map((level) => level.toFixed(0)).join(",")}`,
);
const heroAt = async (x, y, name) => {
  const withHero = await placeHero(x, y);
  writeFileSync(`${OUT}/latest/${name}.png`, Buffer.from(withHero, "base64"));
  shots.push(name);
  return withHero;
};
const east = await heroAt(lampX + 44, lampY + 8, "04b-hero-east-of-lamp");
await heroAt(lampX - 44, lampY + 8, "04b-hero-west-of-lamp");
const darkCorner = await placeHero(140, 322);
const emptyDark = await placeHero(80, 560);
const heroBox = (x, y) => [x - 22, y - 90, 44, 90];
// How much darker the ground in a box is with a satyr standing beside it than without: its shadow. A satyr, as the
// warden's own light would lift the ground around him.
const satyrAt = async (x, y) => {
  await page.evaluate(
    ([satyrX, satyrY]) => {
      const state = window.lampwarden.state();
      state.monsters = [
        {
          id: state.nextId++,
          kind: "satyr",
          x: satyrX,
          y: satyrY,
          health: 1,
          age: 0,
          wobble: 0,
          snuff: 0,
          attackCooldown: 99,
          hurt: 0,
        },
      ];
    },
    [x, y],
  );
  await page.waitForTimeout(100); // the monster list reaches React on the next render
  return placeHero(80, 560);
};
const shadowDepth = async (withSatyr, box) => {
  const [shadowed, bare] = await Promise.all([luminance(withSatyr, [box]), luminance(empty, [box])]);
  return bare[0] - shadowed[0];
};
const feetRow = lampY + 6;
for (const [side, direction] of [
  ["east", 1],
  ["west", -1],
]) {
  const satyrX = lampX + direction * 44;
  const shot = await satyrAt(satyrX, lampY + 8);
  const farSide = [direction > 0 ? satyrX + 8 : satyrX - 22, feetRow, 14, 7]; // away from the lamp
  const lampSide = [direction > 0 ? satyrX - 22 : satyrX + 8, feetRow, 14, 7];
  const [far, near] = [await shadowDepth(shot, farSide), await shadowDepth(shot, lampSide)];
  check(
    "lamp-lighting",
    `${side} of a lamp a shadow falls ${side}, away from it`,
    far > 12 && far > near * 1.5,
    `ground darker by ${far.toFixed(0)} away from the lamp, ${near.toFixed(0)} on its side`,
  );
}
await page.evaluate(() => {
  window.lampwarden.state().monsters = [];
});
const lit = await changedColour(east, empty, heroBox(lampX + 44, lampY + 8));
const unlit = await changedColour(darkCorner, emptyDark, heroBox(140, 322));
const warmth = ([red, , blue]) => red / blue;
check(
  "lamp-lighting",
  "the warden in a pool is lit warm, far more than in the dark",
  lit.count > 200 && unlit.count > 200 && warmth(lit.colour) > warmth(unlit.colour) * 1.5,
  `red/blue ${warmth(lit.colour).toFixed(2)} in the pool, ${warmth(unlit.colour).toFixed(2)} in the dark`,
);
// the same spot with the lamp dark: no warmth, no shadow from it
await page.evaluate(() => {
  window.lampwarden.state().lamps[2].lit = false;
});
const darkLamp = await placeHero(lampX + 44, lampY + 8);
const darkLampBare = await placeHero(80, 560);
const darkLampHero = await changedColour(darkLamp, darkLampBare, heroBox(lampX + 44, lampY + 8));
check(
  "lamp-lighting",
  "beside a dark lamp the warden keeps the night's colour",
  darkLampHero.count > 200 && warmth(darkLampHero.colour) < warmth(lit.colour) / 1.5,
  `red/blue ${warmth(darkLampHero.colour).toFixed(2)}`,
);
await page.evaluate(() => {
  window.lampwarden.state().lamps[2].lit = true;
  window.lampwarden.state().hero.x = 560;
  window.lampwarden.state().hero.y = 360;
});

// 4b2 the warden and a lit lamp, which of them is nearer the camera (the greater ground y): a lamp's layers, its sprite and
// its lantern glow, halo, foot and glints, draw over the warden only where the lamp is the nearer, and nothing of the
// lamp's, its painted shadow included, which is on the ground, covers him where he stands clear of its body.
{
  const [postX, postY] = lamps[1];
  const LAMP_LAYERS = ["lamp-post", "lamp-glow"];
  const WARDEN_LAYERS = ["warden", "warden-rim"];
  // how many of the warden's pixels the lamp's sprite, and its glow, change when each is switched off
  const lampOverWarden = async (offsetX, offsetY, name) => {
    await page.evaluate(
      ([x, y]) => {
        const state = window.lampwarden.state();
        state.monsters = [];
        state.hero.x = x;
        state.hero.y = y;
        state.hero.octant = 2; // facing the camera
        state.hero.animation = "idle";
        state.hero.frameTime = 0;
      },
      [postX + offsetX, postY + offsetY],
    );
    const full = await stageShot();
    if (name) {
      writeFileSync(`${OUT}/latest/${name}.png`, Buffer.from(full, "base64"));
      shots.push(name);
    }
    await showLayers(["lamp-post"], false);
    const withoutPost = await stageShot();
    await showLayers(["lamp-post"], true);
    await showLayers(["lamp-glow"], false);
    const withoutGlow = await stageShot();
    await showLayers(["lamp-glow"], true);
    await showLayers(["lamp-shadows"], false);
    const withoutShadow = await stageShot();
    await showLayers(["lamp-shadows"], true);
    await showLayers(LAMP_LAYERS, false);
    const wardenAlone = await stageShot();
    await showLayers(WARDEN_LAYERS, false);
    const nobody = await stageShot();
    await showLayers(WARDEN_LAYERS, true);
    await showLayers(LAMP_LAYERS, true);
    return {
      post: await changedWithin(full, withoutPost, wardenAlone, nobody),
      glow: await changedWithin(full, withoutGlow, wardenAlone, nobody),
      shadow: await changedWithin(full, withoutShadow, wardenAlone, nobody),
      shadowDrawn: await changedWithin(full, withoutShadow),
    };
  };
  const covered = (cover) =>
    `${cover.post.changed} by the sprite, ${cover.glow.changed} by the glow of ${cover.post.footprint}`;
  for (const [side, offsetX] of [
    ["left", -14],
    ["on", 0],
    ["right", 14],
    ["far right", 30],
  ]) {
    const cover = await lampOverWarden(offsetX, 6, side === "right" ? "04b2-warden-in-front-of-lamp" : null);
    check(
      "lamp-depth",
      `the warden in front of a lamp, ${side}, is covered by none of its layers`,
      cover.post.changed === 0 && cover.glow.changed === 0,
      covered(cover),
    );
  }
  const behind = await lampOverWarden(4, -8, "04b2-warden-behind-lamp");
  check(
    "lamp-depth",
    "the warden behind a lamp is covered by its post and its glow",
    behind.post.changed > 100 && behind.glow.changed > 100,
    covered(behind),
  );
  const beside = await lampOverWarden(40, -6, "04b2-warden-behind-beside-lamp");
  check(
    "lamp-depth",
    "the warden behind a lamp but clear of its post is not covered by its painted shadow",
    beside.post.changed === 0 && beside.shadow.changed === 0 && beside.shadowDrawn.changed > 100,
    `${covered(beside)}, the shadow on the ground (${beside.shadowDrawn.changed} pixels) over ${beside.shadow.changed} of his`,
  );
  await page.evaluate(() => {
    window.lampwarden.state().hero.x = 560;
    window.lampwarden.state().hero.y = 360;
  });
}

// 4b3 the blow's wedge on the ground lies under the figures: a monster standing in it is drawn over it
{
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.hero.x = 560;
    state.hero.y = 360;
    state.hero.octant = 0; // facing east
    state.hero.animation = "melee";
    state.hero.frameTime = 0.05;
    state.monsters = [
      {
        id: state.nextId++,
        kind: "satyr",
        x: 600,
        y: 362,
        health: 1,
        age: 0,
        wobble: 0,
        snuff: 0,
        attackCooldown: 99,
        hurt: 0,
      },
    ];
  });
  await page.waitForTimeout(100); // the monster list reaches React on the next render
  const withWedge = await stageShot();
  writeFileSync(`${OUT}/latest/04b3-wedge-under-monster.png`, Buffer.from(withWedge, "base64"));
  shots.push("04b3-wedge-under-monster");
  await showLayers(["sweep"], false);
  const withoutWedge = await stageShot();
  await showLayers(["monster", "monster-rim"], false);
  const neither = await stageShot();
  await showLayers(["sweep", "monster", "monster-rim"], true);
  const wedgeDrawn = await changedWithin(withWedge, withoutWedge);
  const wedgeOverMonster = await changedWithin(withWedge, withoutWedge, withoutWedge, neither);
  check("melee-sweep", "the wedge is drawn", wedgeDrawn.changed > 200, `${wedgeDrawn.changed} pixels`);
  check(
    "melee-sweep",
    "a monster in the wedge is drawn over it, none of its pixels covered",
    wedgeOverMonster.changed === 0 && wedgeOverMonster.footprint > 500,
    `${wedgeOverMonster.changed} of its ${wedgeOverMonster.footprint} pixels`,
  );
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.monsters = [];
    state.hero.animation = "idle";
    state.hero.frameTime = 0;
  });
  await page.waitForTimeout(100);
}

// 4b4 the warden's own light lights what is around him, not only the ground: in the dark a monster near him is warmer than
// one far from him, the small props at his side are lit, and at dawn all of it has faded like the lamps' light
{
  const wardenAt = [300, 450];
  await page.evaluate(([x, y]) => {
    const state = window.lampwarden.state();
    for (const lamp of state.lamps) lamp.lit = false;
    state.monsters = [];
    state.shots = [];
    state.hero.x = x;
    state.hero.y = y;
    state.hero.octant = 0;
    state.hero.animation = "idle";
    state.hero.frameTime = 0;
  }, wardenAt);
  const setSatyr = async (x, y) => {
    await page.evaluate(
      ([satyrX, satyrY]) => {
        const state = window.lampwarden.state();
        state.monsters = [];
        if (satyrX !== null)
          state.monsters.push({
            id: state.nextId++,
            kind: "satyr",
            x: satyrX,
            y: satyrY,
            health: 1,
            age: 0,
            wobble: 0,
            snuff: 0,
            attackCooldown: 99,
            hurt: 0,
          });
      },
      [x, y],
    );
    await page.waitForTimeout(100); // the monster list reaches React on the next render
  };
  const satyrBox = (x, y) => [x - 30, y - 100, 60, 100];
  // the red over blue of a satyr standing at (x, y), against the same scene without it
  const satyrWarmth = async (x, y) => {
    await setSatyr(null, null);
    const bare = await stageShot();
    await setSatyr(x, y);
    const withSatyr = await stageShot();
    const found = await changedColour(withSatyr, bare, satyrBox(x, y));
    return { warmth: warmth(found.colour), count: found.count, shot: withSatyr };
  };
  const near = await satyrWarmth(wardenAt[0] + 30, wardenAt[1] + 8);
  const far = await satyrWarmth(wardenAt[0] + 130, wardenAt[1] + 8);
  writeFileSync(`${OUT}/latest/04b4-monster-near-warden.png`, Buffer.from(near.shot, "base64"));
  shots.push("04b4-monster-near-warden");
  check(
    "warden-light",
    "in the dark a monster near the warden is warmer than one far from him",
    near.count > 200 && far.count > 200 && near.warmth > far.warmth * 1.12,
    `red/blue ${near.warmth.toFixed(2)} near him, ${far.warmth.toFixed(2)} far`,
  );
  await setSatyr(null, null);
  // the statue, in the dark, with the warden far, then beside it, then a lamp's pool brought to its feet
  const statueBase = [480, 334];
  const statueTorso = [470, 262, 16, 18];
  await page.evaluate(() => {
    window.lampwarden.state().hero.x = 80;
    window.lampwarden.state().hero.y = 560;
  });
  const statueAlone = await stageShot();
  await page.evaluate(([x, y]) => {
    window.lampwarden.state().hero.x = x + 34;
    window.lampwarden.state().hero.y = y + 8;
  }, statueBase);
  const statueByWarden = await stageShot();
  writeFileSync(`${OUT}/latest/04b4-statue-by-warden.png`, Buffer.from(statueByWarden, "base64"));
  shots.push("04b4-statue-by-warden");
  await page.evaluate(() => {
    window.lampwarden.state().hero.x = 80;
    window.lampwarden.state().hero.y = 560;
  });
  // only the lamp's numbers move (its sprites stand where they were mounted), which is all the statue's tint reads
  await page.evaluate(() => {
    const lamp = window.lampwarden.state().lamps[4];
    lamp.y = 300;
    lamp.lit = true;
  });
  const statueByLamp = await stageShot();
  await page.evaluate(() => {
    const lamp = window.lampwarden.state().lamps[4];
    lamp.y = 246;
  });
  const statueWarmth = async (encoded) => warmth(await meanColour(encoded, statueTorso));
  const [alone, byWarden, byLamp] = [
    await statueWarmth(statueAlone),
    await statueWarmth(statueByWarden),
    await statueWarmth(statueByLamp),
  ];
  check(
    "warden-light",
    "the statue is lit when the warden stands beside it",
    byWarden > alone * 1.08,
    `red/blue ${byWarden.toFixed(2)} beside him, ${alone.toFixed(2)} alone`,
  );
  check(
    "warden-light",
    "the statue is lit when a lamp's light reaches its base",
    byLamp > alone * 1.08,
    `red/blue ${byLamp.toFixed(2)} in a lamp's pool, ${alone.toFixed(2)} alone`,
  );
  // dawn: the lights are gone, near the warden and far from him a monster is the same colour
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.lamps[4].lit = false;
    state.elapsed = state.length;
    state.hero.x = 300;
    state.hero.y = 450;
  });
  const dawnNear = await satyrWarmth(330, 458);
  const dawnFar = await satyrWarmth(430, 458);
  check(
    "warden-light",
    "at dawn the warden's light has faded: a monster beside him is no warmer than one far away",
    dawnNear.count > 200 && Math.abs(dawnNear.warmth - dawnFar.warmth) < 0.05,
    `red/blue ${dawnNear.warmth.toFixed(2)} near him, ${dawnFar.warmth.toFixed(2)} far`,
  );
  await setSatyr(null, null);
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.elapsed = 0;
    for (const lamp of state.lamps) lamp.lit = true;
    state.hero.x = 560;
    state.hero.y = 360;
  });
  await settle();
}

// 4c a monster's blow on the warden: a white flash frame, the red vignette, the burst at the claw, a jolt of the screen
// and the health bar, then the warden thrown away from the attacker. The sim is slowed to a tenth and stopped at each
// step of the hurt, so every stage can be looked at.
const woundedSprites = () =>
  page.evaluate(() => {
    const found = { flash: [], vignette: [] };
    const visit = (node) => {
      const label = node.texture?.source?.label ?? "";
      if (node.visible && node.alpha > 0 && label.startsWith("flash:") && label.includes("/hero/"))
        found.flash.push({ label, x: node.x, y: node.y, scaleX: node.scale.x });
      if (node.visible && node.alpha > 0 && label.startsWith("vignette/")) found.vignette.push(label);
      for (const child of node.children ?? []) visit(child);
    };
    const app = window.lampwarden.app();
    if (app) visit(app.stage);
    return found;
  });
// runs the sim at a tenth speed until the warden has been hit and his hurt has run down to `limit`, then stops it;
// reports the largest the screen's jolt got meanwhile
const runHurtTo = (limit) =>
  page.evaluate(async (limit) => {
    const scene = window.lampwarden.scene();
    const state = window.lampwarden.state();
    const app = window.lampwarden.app();
    let jolt = 0;
    scene.setSpeed(0.1);
    scene.setPaused(false);
    await new Promise((resolve) => {
      const watch = () => {
        jolt = Math.max(jolt, Math.abs(app.stage.position.x), Math.abs(app.stage.position.y));
        if (state.hero.hits > 0 && state.hero.hurt <= limit) {
          scene.setPaused(true);
          resolve();
        } else requestAnimationFrame(watch);
      };
      watch();
    });
    scene.setSpeed(1);
    return jolt;
  }, limit);
const placeClawer = (heroX, heroY) =>
  page.evaluate(
    ([heroX, heroY]) => {
      const state = window.lampwarden.state();
      state.shots = [];
      state.monsters = [];
      state.hero.x = heroX;
      state.hero.y = heroY;
      state.hero.animation = "idle";
      state.hero.frameTime = 0;
      state.hero.octant = 2;
      state.monsters.push({
        id: state.nextId++,
        kind: "satyr",
        x: heroX + 20,
        y: heroY,
        health: 1,
        age: 0,
        wobble: 0,
        snuff: 0,
        attackCooldown: 99, // it waits until the scene is set
        hurt: 0,
        stun: 0,
        knockX: 0,
        knockY: 0,
      });
    },
    [heroX, heroY],
  );
{
  const woundX = 560;
  const woundY = 360;
  await placeClawer(woundX, woundY);
  await settle();
  await page.waitForTimeout(80);
  // the claw's satyr is drawn from frames and changes picture as it strikes, so the pictures that measure the warden's flash
  // are taken without it
  await showLayers(["monster", "monster-rim"], false);
  const unhurt = await stageShot();
  await showLayers(["monster", "monster-rim"], true);
  const unhurtSprites = await woundedSprites();
  check(
    "hero-hit",
    "an unhurt warden shows no flash and no vignette",
    unhurtSprites.flash.length === 0 && unhurtSprites.vignette.length === 0,
  );
  await page.evaluate(() => {
    window.lampwarden.state().monsters[0].attackCooldown = 0;
  });
  const jolt = await runHurtTo(0.39);
  await settle();
  const struck = await page.evaluate(() => {
    const { hero } = window.lampwarden.state();
    return { hits: hero.hits, hurt: hero.hurt, mercy: hero.mercy, health: hero.health, maxHealth: hero.maxHealth };
  });
  const flashing = await woundedSprites();
  await shoot("04c-hero-hit-1-flash");
  await showLayers(["monster", "monster-rim"], false);
  const flashClean = await stageShot();
  await showLayers(["monster", "monster-rim"], true);
  check("hero-hit", "a monster's claw wounds the warden once", struck.hits === 1 && struck.health < struck.maxHealth);
  check(
    "hero-hit",
    "the warden is a white flash frame, on his own frame, where he stands",
    flashing.flash.length === 1 &&
      Math.abs(flashing.flash[0].x - woundX) < 40 &&
      /\/hero\/male_idle\d/.test(flashing.flash[0].label),
    JSON.stringify(flashing.flash),
  );
  const white = await changedColour(flashClean, unhurt, [woundX - 22, woundY - 90, 44, 90]);
  check(
    "hero-hit",
    "the flash is white pixels on the warden",
    white.count > 150 && Math.min(...white.colour) > 205,
    `${white.count} pixels, mean rgb ${white.colour.map((level) => level.toFixed(0)).join(",")}`,
  );
  check(
    "hero-hit",
    "the vignette is on at full strength",
    flashing.vignette.length === 1 && flashing.vignette[0] === "vignette/3",
    flashing.vignette.join(" "),
  );
  const edge = await changedColour(flashClean, unhurt, [0, 150, 40, 300]);
  check(
    "hero-hit",
    "the vignette reddens the screen's edge",
    edge.count > 300 && edge.colour[0] > edge.colour[2] * 1.4,
    `${edge.count} pixels, mean rgb ${edge.colour.map((level) => level.toFixed(0)).join(",")}`,
  );
  const burst = await changedColour(flashClean, unhurt, [woundX - 24, woundY - 70, 60, 30]);
  check("hero-hit", "an impact burst at the claw", burst.count > 60, `${burst.count} pixels changed at the chest`);
  check("hero-hit", "the health bar flashes and jolts", (await page.locator(".bar.struck").count()) === 1);
  check("hero-hit", "the screen jolts harder than a kill does", jolt >= 3, `${jolt}px`);
  await runHurtTo(0.3);
  await settle();
  await shoot("04c-hero-hit-2-red");
  await runHurtTo(0.2);
  await settle();
  const fading = await woundedSprites();
  await shoot("04c-hero-hit-3-fading");
  check(
    "hero-hit",
    "the flash is over after its first frames, the vignette thinner",
    fading.flash.length === 0 && fading.vignette.length === 1 && fading.vignette[0] === "vignette/2",
    `${fading.flash.length} flash, ${fading.vignette.join(" ")}`,
  );
  await runHurtTo(0.1);
  await settle();
  await shoot("04c-hero-hit-4-fading");
  await runHurtTo(0);
  await settle();
  await page.waitForTimeout(80);
  const over = await woundedSprites();
  const after = await page.evaluate(() => {
    const { hero } = window.lampwarden.state();
    return { x: hero.x, y: hero.y, stun: hero.stun, hits: hero.hits };
  });
  await shoot("04c-hero-hit-5-over");
  check(
    "hero-hit",
    "when the hurt is over the flash and the vignette are gone",
    over.flash.length === 0 && over.vignette.length === 0,
  );
  check(
    "hero-hit",
    "the warden was thrown away from the attacker",
    woundX - after.x > 15,
    `${(woundX - after.x).toFixed(0)}px`,
  );
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.monsters = [];
    Object.assign(state.hero, { hurt: 0, mercy: 0, stun: 0, knockX: 0, knockY: 0, x: 560, y: 360 });
  });
  await settle();
}

// 4d the warden faces the eight ways he strikes: pointing the stick (or the keys) a way turns him to it, every frame
// he is drawn with is the frame of that direction (the sw, w and nw ones mirrored from the se, e and ne), and the wedge
// a swing draws on the ground is centred on the direction he is shown facing
{
  const heroSprite = () =>
    page.evaluate(() => {
      let found = null;
      const visit = (node) => {
        const label = node.texture?.source?.label ?? "";
        if (node.visible && label.includes("/hero/") && !label.startsWith("flash:"))
          found = { name: label.slice(label.indexOf("/hero/") + 6), mirrored: node.scale.x < 0 };
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.lampwarden.app().stage);
      return found;
    });
  // the ground angle, in degrees clockwise from east, the swing's wedge is centred on; null when none is drawn
  const wedgeAngle = () =>
    page.evaluate(() => {
      let angle = null;
      const visit = (node) => {
        for (const instruction of node.context?.instructions ?? []) {
          const steps = instruction.data?.path?.instructions;
          if (instruction.action !== "fill" || !steps || steps.length < 10) continue;
          const [centreX, centreY] = steps[0].data;
          const rim = steps.slice(1, -1).map((step) => step.data);
          const meanX = rim.reduce((total, [x]) => total + x, 0) / rim.length - centreX;
          const meanY = rim.reduce((total, [, y]) => total + y, 0) / rim.length - centreY;
          angle = (Math.atan2(meanY * 2, meanX) * 180) / Math.PI;
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.lampwarden.app().stage);
      return angle;
    });
  const COMPASS = [
    // name, stick x, stick y, the drawn direction and whether it is mirrored
    ["e", 1, 0, "e", false],
    ["se", 1, 1, "se", false],
    ["s", 0, 1, "s", false],
    ["sw", -1, 1, "se", true],
    ["w", -1, 0, "e", true],
    ["nw", -1, -1, "ne", true],
    ["n", 0, -1, "n", false],
    ["ne", 1, -1, "ne", false],
  ];
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.monsters = [];
    state.shots = [];
    state.spawnTimer = 1e9;
    for (const lamp of state.lamps) lamp.lit = true;
    window.lampwarden.scene().setPaused(false);
  });
  const facings = [];
  for (const [index, [name, stickX, stickY, drawn, mirrored]] of COMPASS.entries()) {
    await page.evaluate(
      ([x, y]) => {
        const hero = window.lampwarden.state().hero;
        hero.x = 480;
        hero.y = 450;
        hero.animation = "idle";
        hero.frameTime = 0;
        window.lampwarden.scene().stick(x, y);
      },
      [stickX, stickY],
    );
    await page.waitForTimeout(160);
    const walking = await heroSprite();
    await page.evaluate(() => {
      window.lampwarden.scene().stick(0, 0);
      window.lampwarden.scene().press("melee");
    });
    await page.waitForTimeout(90);
    const striking = await heroSprite();
    const wedge = await wedgeAngle();
    const octant = await page.evaluate(() => window.lampwarden.state().hero.octant);
    await page.waitForFunction(() => window.lampwarden.state().hero.animation === "idle");
    await page.waitForTimeout(60);
    const standing = await heroSprite();
    // a shot with no mouse aim (the K key, a touch button with nothing to aim at) flies the way he faces on the ground:
    // on the screen that is the stick's direction with its y halved
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.shots = [];
      state.hero.shotCooldown = 0;
      window.lampwarden.scene().press("ranged");
    });
    await page.waitForFunction(() => window.lampwarden.state().shots.length > 0, null, { timeout: 4000 });
    const [shotX, shotY] = await page.evaluate(() => {
      const [shot] = window.lampwarden.state().shots;
      return [shot.velocityX, shot.velocityY];
    });
    const shotAngle = (Math.atan2(shotY, shotX) * 180) / Math.PI;
    const wantedAngle = (Math.atan2(stickY / 2, stickX) * 180) / Math.PI;
    const shotOff = Math.abs(((shotAngle - wantedAngle + 540) % 360) - 180);
    await page.waitForFunction(() => window.lampwarden.state().hero.animation === "idle");
    const shown = (sprite, animation) =>
      sprite?.name.startsWith(`male_${animation}`) &&
      sprite.name.endsWith(`_${drawn}.png`) &&
      sprite.mirrored === mirrored;
    facings.push({
      name,
      ok: shown(walking, "walk") && shown(striking, "melee") && shown(standing, "idle") && octant === index,
      detail: `${walking?.name}${walking?.mirrored ? " mirrored" : ""}, ${striking?.name}, ${standing?.name}`,
      wedge: wedge === null ? null : ((wedge % 360) + 360) % 360,
      shotOff,
    });
    const stage = await page.locator(".stage").boundingBox();
    await page.screenshot({
      path: `${OUT}/latest/hero-direction-${index}-${name}.png`,
      clip: { x: stage.x + 480 - 60, y: stage.y + 450 - 110, width: 120, height: 130 },
    });
  }
  for (const facing of facings)
    check(
      "hero-facing",
      `facing ${facing.name}: walks, strikes and stands in that direction's frames`,
      facing.ok,
      facing.detail,
    );
  check(
    "hero-facing",
    "the swing's wedge is centred on the direction shown, in all eight",
    facings.every(
      (facing, index) => facing.wedge !== null && Math.abs(((facing.wedge - index * 45 + 540) % 360) - 180) < 4,
    ),
    facings.map((facing) => `${facing.name} ${facing.wedge?.toFixed(0)}`).join(" "),
  );
  check(
    "hero-facing",
    "a shot with no mouse aim flies the way he faces, in all eight (within a degree)",
    facings.every((facing) => facing.shotOff < 1),
    facings.map((facing) => `${facing.name} ${facing.shotOff.toFixed(1)}`).join(" "),
  );
  await page.evaluate(() => {
    const hero = window.lampwarden.state().hero;
    window.lampwarden.scene().setPaused(true);
    window.lampwarden.scene().stick(0, 0);
    hero.x = 560;
    hero.y = 360;
  });
  await settle();
}

// 5 just before dawn: the tint has warmed
await setPropsShown(true);
await page.evaluate(() => {
  const state = window.lampwarden.state();
  for (const lamp of state.lamps) lamp.lit = true;
  state.elapsed = state.length * 0.97;
});
await settle();
await page.waitForTimeout(80);
shot = await shoot("05-near-dawn");
const dawnStats = await imageStats(shot);
check(
  "near-dawn",
  "scene brightens towards dawn",
  dawnStats.mean > nightStats.mean + 25,
  `night ${nightStats.mean.toFixed(1)} → dawn ${dawnStats.mean.toFixed(1)}`,
);

// 6 dawn screen
await seedWeaponShop();
await page.evaluate(() => {
  const state = window.lampwarden.state();
  state.elapsed = state.length - 0.01;
  state.stats.kills = 12;
  state.oilEarned = 12;
  window.lampwarden.scene().setPaused(false);
});
await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
await freeze();
shot = await shoot("06-dawn");
const dawnFonts = await fontsLoaded();
check(
  "dawn",
  "pixel fonts loaded (title, UI)",
  dawnFonts.every((font) => font.ok),
  dawnFonts.map((font) => `${font.family}:${font.ok ? "loaded" : "MISSING"}`).join(" "),
);
check(
  "dawn",
  "dawn panel with three upgrades on offer",
  (await text(".logo")).join("").includes("DAWN") && (await page.locator(".btn.up").count()) === 3,
);
const icons = await page.locator(".btn.up .icon").count();
check("dawn", "every upgrade has an icon", icons === 3, `${icons} icons`);
await checkPress("button-press", "a shop card sinks and darkens", page.locator(".btn.up:not([disabled])").first());
await checkPress("button-press", "Into night sinks and darkens", page.getByRole("button", { name: /Into night/ }));
await checkWeaponShop("dawn", "male");
// each offer shows its label, level pips, effect text and cost, and they are three different upgrades
const offerCards = await page.locator(".btn.up").evaluateAll((cards) =>
  cards.map((card) => ({
    id: card.dataset.upgrade,
    label: card.querySelector("b")?.textContent ?? "",
    pips: card.querySelector("em")?.textContent ?? "",
    effect: card.querySelector("span")?.textContent ?? "",
    cost: card.querySelector("i")?.textContent ?? "",
  })),
);
check(
  "dawn",
  "three different offers, each with label, pips, effect and cost",
  new Set(offerCards.map((card) => card.id)).size === 3 &&
    offerCards.every(
      (card) =>
        card.label.length > 0 &&
        /^[●○]{3}$/.test(card.pips) &&
        card.effect.length > 10 &&
        /^\d+ oil$|^max$/.test(card.cost),
    ),
  JSON.stringify(offerCards.map((card) => `${card.id} ${card.pips} ${card.cost}`)),
);
const savedOffers = await page.evaluate(() => ({
  shown: window.lampwarden.legacy().offers,
  saved: JSON.parse(localStorage.getItem("lampwarden:legacy:v1") ?? "{}").offers,
}));
check(
  "dawn",
  "the offers are saved with the legacy, so a reload keeps them",
  JSON.stringify(savedOffers.shown) === JSON.stringify(savedOffers.saved) &&
    JSON.stringify(savedOffers.shown) === JSON.stringify(offerCards.map((card) => card.id)),
  JSON.stringify(savedOffers),
);

// 7 heir screen after the lamps go dark
await page.getByRole("button", { name: /Into night/ }).click();
await page.waitForSelector('[data-phase="night"]');
await checkTouchIcons("night", "male");
// the next night, the one the replay below shows, is laid out afresh from a seed of its own
const lastNightProps = await drawnProps();
checkPropsOnPlaza("night-two", "the second night's plaza", lastNightProps);
check(
  "night-two",
  "the second night stands on a plaza of its own",
  !sameProps(lastNightProps, liveProps),
  JSON.stringify(lastNightProps),
);
await seedWeaponShop();
await page.evaluate(() => {
  for (const lamp of window.lampwarden.state().lamps) lamp.lit = false;
});
await page.waitForSelector('[data-phase="heir"]', { timeout: 5000 });
await freeze();
shot = await shoot("07-heir");
check("heir", "three heirs offered", (await page.locator(".btn.heir").count()) === 3);
await checkTraitIcons("heir", "each heir button shows its trait's icon", ".btn.heir", 3);
await checkPress("button-press", "an heir button sinks and darkens", page.locator(".btn.heir").first());
// until an heir is picked, the button that starts their night is disabled, and a disabled button does not press
await checkPress(
  "button-press",
  "a disabled button does not press",
  page.getByRole("button", { name: "Choose an heir" }),
  true,
);
// the shop is for the fallen warden until an heir is picked, then for the heir (a daughter if one is offered)
await checkWeaponShop("heir", "male");
{
  const heirCards = await page.locator(".btn.heir").evaluateAll((cards) =>
    cards.map((card) => ({
      name: card.querySelector("b")?.textContent,
      daughter: card.textContent.includes("sling"),
    })),
  );
  // a reload on the heir panel offers the same heirs again, not the fallen warden
  await page.reload();
  await page.waitForSelector('[data-phase="heir"]', { timeout: 15000 });
  const reloadedNames = await page.locator(".btn.heir b").allTextContents();
  check(
    "heir",
    "a reload offers the same heirs",
    JSON.stringify(reloadedNames) === JSON.stringify(heirCards.map((heir) => heir.name)),
    JSON.stringify(reloadedNames),
  );
  check(
    "heir",
    "after a reload no heir is chosen yet, so the night cannot start",
    (await page.getByRole("button", { name: "Choose an heir" }).isDisabled()) &&
      (await page.locator('.btn.heir[aria-pressed="true"]').count()) === 0,
  );
  const picked = heirCards.find((heir) => heir.daughter) ?? heirCards[0];
  const keptHeir = await page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:legacy:v1")).heir);
  await page.locator(".btn.heir", { hasText: picked.name }).click();
  await checkWeaponShop("heir-picked", picked.daughter ? "female" : "male");
  await page.evaluate((heir) => {
    const { heirChoice: _open, ...saved } = JSON.parse(localStorage.getItem("lampwarden:legacy:v1"));
    // the later scenes keep their warden, on the title (an heir choice left open would bring the heir panel back)
    localStorage.setItem("lampwarden:legacy:v1", JSON.stringify({ ...saved, heir }));
  }, keptHeir);
}

// 8 replay of the night just played (kept locally)
await page.goto(`${BASE_URL}/?replay=last`);
await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
await page.waitForTimeout(1200);
await freeze();
shot = await shoot("08-replay");
check("replay", "replay bar shown", (await text(".replaybar")).join("").includes("REPLAY"));
{
  // the replay lays the plaza out again from the recorded seed: the one the night was played on
  const replayedProps = await drawnProps();
  const playedSeed = await page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:lastPlay") ?? "null")?.seed);
  check(
    "replay",
    "a replay shows the plaza the night was played on",
    sameProps(replayedProps, lastNightProps) && sameProps(replayedProps, laidOutProps(playedSeed)),
    `played ${JSON.stringify(lastNightProps)}, replayed ${JSON.stringify(replayedProps)}`,
  );
}

// 8b a recording is replayed only on the sim it was played on (the sim fingerprint every play carries). The recording
// just made on this build matches; one from another version, and one from before fingerprints, are described, not played.
{
  const lastPlay = await page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:lastPlay") ?? "null"));
  check(
    "replay",
    "the night just played carries this build's sim",
    /^[0-9a-f]{12}$/.test(lastPlay?.sim ?? ""),
    lastPlay?.sim,
  );
  const sameSim = { ...lastPlay, id: "2026-10-24-21-00-00-samesim1" };
  await page.route(`**/api/plays/${sameSim.id}`, serveFixturePlay(sameSim));
  await page.goto(`${BASE_URL}/?replay=${sameSim.id}`);
  await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
  check(
    "replay",
    "a recording from the same sim, served by the API, replays",
    (await text(".replaybar")).join("").includes(sameSim.id),
  );

  // 8c six plazas: the same recording under six seeds lays out six plazas, each inside its rim (the contact sheet shows them
  // side by side). The recorded seed is all a replay has, and it lays out what the seed says.
  for (const [index, seed] of [11, 22, 33, 44, 55, 3000000000].entries()) {
    const seeded = { ...lastPlay, id: `2026-10-24-21-00-0${index}-layout${index}`, seed };
    await page.route(`**/api/plays/${seeded.id}`, serveFixturePlay(seeded));
    await page.goto(`${BASE_URL}/?replay=${seeded.id}`);
    await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
    await page.evaluate(() => window.lampwarden.scene().setPaused(true));
    await freeze();
    const plaza = await shoot(`08c-plaza-${index + 1}`);
    await checkBridge("plazas", `seed ${seed}`, plaza, seed);
    const props = await drawnProps();
    check(
      "plazas",
      `seed ${seed}: the replay shows the plaza the seed lays out`,
      sameProps(props, laidOutProps(seed)),
      JSON.stringify(props),
    );
    checkPropsOnPlaza("plazas", `seed ${seed}`, props);
  }

  for (const [label, play, shotName] of REFUSED_PLAYS) {
    await page.route(`**/api/plays/${play.id}`, serveFixturePlay(play));
    await page.goto(`${BASE_URL}/?replay=${play.id}`);
    await page.waitForSelector('[data-phase="replayRefused"]', { timeout: 15000 });
    const cleared = await page.evaluate(() => window.lampwarden.state()?.elapsed);
    await page.waitForTimeout(700);
    const afterwards = await page.evaluate(() => ({
      phase: document.querySelector(".stage")?.dataset.phase,
      elapsed: window.lampwarden.state()?.elapsed,
      replayBar: document.querySelector(".replaybar") !== null,
    }));
    const panel = (await text('[data-panel="replay-refused"]')).join(" ");
    check(
      "replay-refused",
      `${label}: the panel says it was an earlier version and shows the night's summary`,
      panel.includes("earlier version of Lampwarden and can't be replayed exactly") &&
        panel.includes(`${play.legacy.heir.name}, night 3: dawn, 17 slain, 1 lamps snuffed, 40 s.`),
      panel,
    );
    check(
      "replay-refused",
      `${label}: no night runs`,
      afterwards.phase === "replayRefused" && !afterwards.replayBar && afterwards.elapsed === cleared,
      JSON.stringify({ cleared, ...afterwards }),
    );
    await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
    await settle();
    await shoot(shotName);
    if (play === REFUSED_PLAYS.at(-1)?.[1]) {
      await page.getByRole("button", { name: "Back to the title" }).click();
      await page.waitForSelector('[data-phase="title"]', { timeout: 15000 });
      check("replay-refused", "the way back leads to the title", !page.url().includes("replay"), page.url());
    }
  }
}

// 9 gamepad: a mocked standard-mapping pad drives the menus and the warden
{
  const padPage = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  await stubSea(padPage);
  await stubDirector(padPage);
  padPage.on("pageerror", (error) => errors.push(`gamepad: ${error}`));
  await padPage.addInitScript(() => {
    const pad = {
      id: "Verifier pad",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
    };
    window.verifierPad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  const mainPage = page;
  page = padPage;
  const tapButton = async (index) => {
    await page.evaluate((index) => {
      window.verifierPad.buttons[index].pressed = true;
    }, index);
    await page.waitForTimeout(120);
    await page.evaluate((index) => {
      window.verifierPad.buttons[index].pressed = false;
    }, index);
    await page.waitForTimeout(120);
  };
  const setAxes = (axes) =>
    page.evaluate((axes) => {
      window.verifierPad.axes = axes;
    }, axes);
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await checkHowToPlay("gamepad", "keyboard", ["W", "A", "S", "D", "J", "K", "mouse"]); // until a pad connects
  await page.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  await page.waitForSelector('.scroll .controls[data-controls="gamepad"]', { timeout: 3000 });
  await checkHowToPlay("gamepad", "gamepad", ["pad-left-stick", "pad-A", "pad-B", "pad-RT"]);
  await checkScrollFits("gamepad");
  await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
  await settle();
  await shoot("09-gamepad-title");
  // the d-pad walks the title's buttons to a hero card and A chooses it: the daughter, then the son again
  const focusHeroCard = async (sex, direction) => {
    for (let move = 0; move < 8; move++) {
      if (await page.evaluate((sex) => document.activeElement?.dataset?.sex === sex, sex)) return true;
      await tapButton(direction);
    }
    return page.evaluate((sex) => document.activeElement?.dataset?.sex === sex, sex);
  };
  const padChoices = [];
  for (const [sex, direction] of [
    ["female", 13],
    ["male", 12],
  ]) {
    const focused = await focusHeroCard(sex, direction);
    await tapButton(0);
    padChoices.push({ sex, focused, chosen: await page.evaluate(() => window.lampwarden.legacy().heir.sex) });
  }
  check(
    "gamepad",
    "d-pad focuses the hero cards and A chooses one",
    padChoices.every((choice) => choice.focused && choice.chosen === choice.sex),
    padChoices.map((choice) => `${choice.sex}: focused ${choice.focused}, chosen ${choice.chosen}`).join("; "),
  );
  // A held on the focused hero card shows the press while it is held
  await checkCodePress(
    "button-press",
    "the pad's A shows the press on the focused button",
    async () => {
      await page.evaluate(() => {
        window.verifierPad.buttons[0].pressed = true;
      });
      await page.waitForTimeout(50);
    },
    () => document.activeElement?.hasAttribute("data-pressed") ?? false,
    () =>
      page.evaluate(() => {
        window.verifierPad.buttons[0].pressed = false;
      }),
  );
  await tapButton(9); // Start presses the title's primary button
  const started = await page.waitForSelector('[data-phase="night"]', { timeout: 3000 }).then(
    () => true,
    () => false,
  );
  check("gamepad", "Start lights the lamps", started);
  if (started) {
    check("gamepad", "help line shows pad controls", (await text(".help")).join("").includes("Left stick"));
    const startX = await page.evaluate(() => window.lampwarden.state().hero.x);
    await setAxes([1, 0, 0, 0]);
    await page.waitForTimeout(500);
    await setAxes([0, 0, 0, 0]);
    const movedX = await page.evaluate(() => window.lampwarden.state().hero.x);
    check("gamepad", "left stick moves the warden", movedX - startX > 30, `Δx ${(movedX - startX).toFixed(0)}`);
    await tapButton(0);
    check("gamepad", "A strikes", (await page.evaluate(() => window.lampwarden.state().hero.animation)) === "melee");
    await page.waitForTimeout(500);
    await setAxes([0, 0, -1, 0]); // right stick left, then the right trigger shoots that way
    await tapButton(7);
    await page.waitForTimeout(250);
    const firstShot = await page.evaluate(() => {
      const [inFlight] = window.lampwarden.state().shots;
      return inFlight ? { velocityX: inFlight.velocityX, x: inFlight.x, y: inFlight.y } : null;
    });
    check(
      "gamepad",
      "right trigger shoots along the right stick",
      firstShot !== null && firstShot.velocityX < 0,
      firstShot ? `velocityX ${firstShot.velocityX.toFixed(0)}` : "no shot",
    );
    await setAxes([0, 0, 0, 0]);
    if (firstShot) {
      await freeze();
      shot = await shoot("09-gamepad-arrow");
      const now = await page.evaluate(() => {
        const [inFlight] = window.lampwarden.state().shots;
        return inFlight ? { x: inFlight.x, y: inFlight.y } : null;
      });
      if (now) {
        const arrowBox = [Math.round(now.x) - 10, Math.round(now.y) - 10, 21, 21];
        const [around] = await luminance(shot, [arrowBox]);
        check(
          "gamepad",
          "arrow sprite drawn where the shot is",
          around > 40,
          `mean luminance ${around.toFixed(0)} around (${Math.round(now.x)}, ${Math.round(now.y)})`,
        );
      }
      await page.evaluate(() => window.lampwarden.scene().setPaused(false));
    }
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.elapsed = state.length - 0.01;
      state.oilEarned = 40;
    });
    await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
    await page.waitForTimeout(200);
    await setAxes([0, 1, 0, 0]);
    await page.waitForTimeout(80);
    await setAxes([0, 0, 0, 0]); // down: focus the first button
    const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? "");
    await tapButton(0);
    const levels = await page.evaluate(() => window.lampwarden.legacy().levels);
    check(
      "gamepad",
      "d-pad focuses and A buys an upgrade",
      Object.values(levels).some((level) => level > 0),
      `focused "${focusedText.slice(0, 20)}", levels ${JSON.stringify(levels)}`,
    );
    await freeze();
    await shoot("10-gamepad-dawn");
  }
  page = mainPage;
  await padPage.close();
}

// 11 hero choice: the daughter, the son again, then the daughter takes up the lamp and the night shows her
{
  const heroPage = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  await stubSea(heroPage);
  await stubDirector(heroPage);
  heroPage.on("pageerror", (error) => errors.push(`hero choice: ${error}`));
  const mainPage = page;
  page = heroPage;
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
  const heir = () => page.evaluate(() => window.lampwarden.legacy().heir);
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:legacy:v1") ?? "null")?.heir ?? null);
  const first = await heir();
  await page.click('.hero-card[data-sex="female"]');
  await settle();
  const daughter = await heir();
  const savedDaughter = await saved();
  check(
    "hero-choice",
    "choosing the daughter makes the warden female with a new name, saved",
    daughter.sex === "female" &&
      daughter.name !== first.name &&
      daughter.trait === first.trait &&
      savedDaughter?.sex === "female" &&
      (await page.locator('.hero-card[data-sex="female"]').getAttribute("aria-pressed")) === "true",
    `${first.name} (${first.sex}) → ${daughter.name} (${daughter.sex}), saved ${savedDaughter?.name}`,
  );
  const wardenLine = (await text(".scroll .warden")).join("");
  check("hero-choice", "the warden line names her", wardenLine.includes(daughter.name), wardenLine);
  await shoot("11-hero-choice");
  // every trait: its icon on the warden line (a saved legacy with that trait), and the five icons are all different
  const drawings = [];
  for (const trait of Object.values(TRAIT_ICONS)) {
    await page.evaluate((trait) => {
      const saved = JSON.parse(localStorage.getItem("lampwarden:legacy:v1"));
      localStorage.setItem("lampwarden:legacy:v1", JSON.stringify({ ...saved, heir: { ...saved.heir, trait } }));
    }, trait);
    await page.reload();
    await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
    const shown = await page.locator(".scroll .warden [data-icon]").evaluateAll((icons) =>
      icons.map((icon) => ({
        name: icon.dataset.icon,
        drawing: [...icon.querySelectorAll("rect")]
          .map((rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")},${rect.getAttribute("fill")}`)
          .join(";"),
      })),
    );
    check("traits", `the ${trait} trait shows the ${trait} icon`, shown.length === 1 && shown[0].name === trait);
    drawings.push(shown[0]?.drawing);
  }
  check("traits", "the five trait icons are all different", new Set(drawings).size === drawings.length);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
  await page.click('.hero-card[data-sex="female"]');
  await page.click('.hero-card[data-sex="male"]');
  const son = await heir();
  check(
    "hero-choice",
    "choosing the son sets it back",
    son.sex === "male" && son.name === first.name && (await saved())?.sex === "male",
    `${son.name} (${son.sex})`,
  );
  await page.click('.hero-card[data-sex="female"]');
  await page.getByRole("button", { name: "Light the lamps" }).click();
  await page.waitForSelector('[data-phase="night"]');
  await freeze();
  const textures = await heroTextures();
  check(
    "hero-choice",
    "the night shows the female warden",
    (await heir()).sex === "female" && textures.length > 0 && textures.every((key) => key.startsWith("female_")),
    textures.join(" "),
  );
  await shoot("12-hero-choice-night");
  await checkTouchIcons("hero-choice", "female");
  // she holds the night: her shop sells the spear and the pouch of stones
  await seedWeaponShop();
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.elapsed = state.length - 0.01;
    state.oilEarned = 40;
    window.lampwarden.scene().setPaused(false);
  });
  await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
  await freeze();
  await checkWeaponShop("hero-choice", "female");
  await shoot("12-hero-choice-dawn");
  page = mainPage;
  await heroPage.close();
}

// 13 the unroll: without ?verify=1 it starts rolled up; a click, Enter or the pad's A completes it and does nothing
// else; with reduced motion it starts unrolled
{
  const unrollContext = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  await unrollContext.addInitScript(() => {
    const pad = {
      id: "Verifier pad",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
    };
    window.verifierPad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
    localStorage.clear();
  });
  await stubSea(unrollContext);
  await stubDirector(unrollContext);
  const unrollPage = await unrollContext.newPage();
  unrollPage.on("pageerror", (error) => errors.push(`unroll: ${error}`));
  const stageOf = () => unrollPage.evaluate(() => document.querySelector(".scroll")?.dataset.stage);
  const untouched = () =>
    unrollPage.evaluate(
      () =>
        document.querySelector(".stage")?.dataset.phase === "title" && window.lampwarden?.legacy().heir.sex === "male",
    );
  await unrollPage.goto(BASE_URL);
  await unrollPage.waitForSelector(".scroll:not([hidden])");
  const opening = await stageOf();
  await unrollPage.waitForSelector('.scroll[data-stage="writing"]', { timeout: 6000 });
  // the controls ink in with the other lines
  const inking = await unrollPage.evaluate(() => {
    const animationOf = (selector) => getComputedStyle(document.querySelector(selector)).animationName;
    return { controls: animationOf(".controls"), heading: animationOf(".scroll-heading") };
  });
  check(
    "unroll",
    "How to play is inked in like the other lines",
    inking.controls === "ink-in" && inking.controls === inking.heading,
    `${inking.controls}, the heading's ${inking.heading}`,
  );
  // a click on the daughter's card while the lines are being written completes the scroll and chooses nothing
  const card = await unrollPage.locator('.hero-card[data-sex="female"]').boundingBox();
  await unrollPage.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
  const afterClick = { stage: await stageOf(), untouched: await untouched() };
  check(
    "unroll",
    "starts rolled; a click while it unrolls completes it and presses nothing",
    opening === "unrolling" && afterClick.stage === "done" && afterClick.untouched,
    `${opening} → ${afterClick.stage}, title and son kept: ${afterClick.untouched}`,
  );
  await unrollPage.reload();
  await unrollPage.waitForSelector('.scroll[data-stage="unrolling"]');
  await unrollPage.keyboard.press("Enter");
  const afterEnter = { stage: await stageOf(), untouched: await untouched() };
  check(
    "unroll",
    "Enter completes it and presses nothing",
    afterEnter.stage === "done" && afterEnter.untouched,
    `${afterEnter.stage}, untouched ${afterEnter.untouched}`,
  );
  await unrollPage.reload();
  await unrollPage.waitForSelector('.scroll[data-stage="unrolling"]');
  await unrollPage.evaluate(() => {
    window.verifierPad.buttons[0].pressed = true;
  });
  await unrollPage.waitForTimeout(150);
  await unrollPage.evaluate(() => {
    window.verifierPad.buttons[0].pressed = false;
  });
  await unrollPage.waitForTimeout(150);
  const afterPad = { stage: await stageOf(), untouched: await untouched() };
  check(
    "unroll",
    "the pad's A completes it and presses nothing",
    afterPad.stage === "done" && afterPad.untouched,
    `${afterPad.stage}, untouched ${afterPad.untouched}`,
  );
  await unrollContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1000, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await stubSea(reducedContext);
  await stubDirector(reducedContext);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(BASE_URL);
  await reducedPage.waitForSelector(".scroll:not([hidden])");
  const reducedStage = await reducedPage.evaluate(() => document.querySelector(".scroll")?.dataset.stage);
  check("reduced-motion", "the scroll starts unrolled", reducedStage === "done", reducedStage);
  const mainPage = page;
  page = reducedPage;
  await checkTitleScroll("reduced-motion", 1000, 640);
  // a blow on the warden with reduced motion: the screen does not shake and the bar does not jolt; the vignette stays,
  // steady
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await page.getByRole("button", { name: "Light the lamps" }).click();
  await page.waitForSelector('[data-phase="night"]');
  await freeze();
  await placeClawer(560, 360);
  await page.evaluate(() => {
    window.lampwarden.state().monsters[0].attackCooldown = 0;
  });
  const calmJolt = await runHurtTo(0.39);
  await settle();
  const calmSprites = await woundedSprites();
  check("reduced-motion", "a blow does not shake the screen", calmJolt === 0, `${calmJolt}px`);
  check(
    "reduced-motion",
    "the vignette and the flash still mark the blow",
    calmSprites.vignette.length === 1 && calmSprites.flash.length === 1,
    `${calmSprites.vignette.join(" ")}, ${calmSprites.flash.length} flash`,
  );
  page = mainPage;
  await reducedContext.close();
}

// 14 to 21 the creature from the sea (API stubbed, see above)
{
  const seaContext = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  await stubSea(seaContext);
  await stubDirector(seaContext);
  const seaPage = await seaContext.newPage();
  seaPage.on("pageerror", (error) => errors.push(`sea: ${error}`));
  seaPage.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
      errors.push(`sea: ${message.text()}`);
  });
  seaPage.on("response", (response) => {
    if (response.status() >= 400) errors.push(`sea: HTTP ${response.status()} ${response.url()}`);
  });
  const mainPage = page;
  page = seaPage;
  const openTitle = async () => {
    await page.goto(`${BASE_URL}/?verify=1`);
    await page.evaluate(() => localStorage.clear());
    sea.polls = 0;
    await page.reload();
    await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
    await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
    await settle();
  };
  const startFromTitle = async () => {
    await page.getByRole("button", { name: "Light the lamps" }).click();
    await page.waitForSelector('[data-phase="night"]');
    await freeze();
  };
  const night = () =>
    page.evaluate(() => {
      const state = window.lampwarden.state();
      return {
        creature: state.creature && { id: state.creature.id, health: state.creature.stats.health },
        creatureMonsters: state.monsters.filter((monster) => monster.kind === "creature").length,
        bestiary: window.lampwarden.legacy().bestiary,
        saved: JSON.parse(localStorage.getItem("lampwarden:legacy:v1") ?? "{}").bestiary,
      };
    });
  // sprites on the stage whose texture came from the creature API
  const seaSprites = () =>
    page.evaluate(() => {
      let found = 0;
      const visit = (node) => {
        if ((node.texture?.source?.label ?? "").includes("/api/creatures/") && node.visible && !node.destroyed) found++;
        for (const child of node.children ?? []) visit(child);
      };
      const app = window.lampwarden.app();
      if (app) visit(app.stage);
      return found;
    });
  // the dawn screen, reached the way the earlier scenarios do
  const toDawn = async () => {
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.elapsed = state.length - 0.01;
      state.oilEarned = 12;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
    await freeze();
  };
  const lastAsked = () => JSON.stringify(sea.asked.at(-1));
  const creatureBox = spriteBox(600, 400, false);

  // 14 nothing is coming: the title has no panel, the night is the night it was
  sea.mode = "none";
  await openTitle();
  await page.waitForTimeout(300);
  check("sea-none", "the sea was asked, with nothing met yet", lastAsked() === "[]", lastAsked());
  check("sea-none", "no creature panel on the title", (await page.locator(".sea").count()) === 0);
  await startFromTitle();
  const noneNight = await night();
  check("sea-none", "the night has no creature", noneNight.creature === null && noneNight.creatureMonsters === 0);
  check("sea-none", "nothing was met", noneNight.bestiary.length === 0);
  shot = await shoot("14-sea-none-night");
  const unchanged = await diff(shot, nightStart, propFrames(liveProps, await drawnProps()));
  check("sea-none", "the night start looks as it did", unchanged < 0.005, `${(unchanged * 100).toFixed(2)}% changed`);

  // 15 still being made: its step shows, and the night can start without it
  sea.mode = "generating";
  sea.jobsDone = false;
  sea.steps = ["queued", "drawing", "rendering"];
  await openTitle();
  await page.waitForSelector('.sea[data-state="generating"]', { timeout: 5000 });
  check(
    "sea-generating",
    "the sea is shaping something",
    (await text(".sea")).join(" ").includes("The sea is shaping something"),
  );
  await page.waitForSelector('.sea[data-step="drawing"]', { timeout: 8000 });
  const stepLine = (await text(".sea")).join(" ");
  check(
    "sea-generating",
    "the job's step shows and follows the job",
    stepLine.includes("its shape is being drawn"),
    stepLine,
  );
  await checkTitleScroll("sea-generating", 1000, 640);
  await shoot("15-sea-generating");
  const startButton = page.getByRole("button", { name: "Light the lamps" });
  check(
    "sea-generating",
    "starting the night is not blocked",
    (await startButton.isEnabled()) && (await startButton.isVisible()),
  );
  await startButton.click();
  await page.waitForSelector('[data-phase="night"]');
  await freeze();
  const generatingNight = await night();
  check(
    "sea-generating",
    "the night runs without a creature",
    generatingNight.creature === null && generatingNight.bestiary.length === 0,
  );
  const pollsAtStart = sea.polls;
  const askedAtStart = sea.asked.length;
  await page.waitForTimeout(2600);
  check(
    "sea-generating",
    "the job is still followed once the night has begun",
    sea.polls > pollsAtStart,
    `${pollsAtStart} → ${sea.polls}`,
  );
  // the job finishes during the night (the sea would answer "generating" to a second asking, so the creature that
  // shows at dawn can only come from the job that was followed): it is announced for the next night, and met in it
  sea.jobsDone = true;
  await toDawn();
  await page.waitForSelector('.panel .sea[data-state="ready"]', { timeout: 5000 });
  check(
    "sea-generating",
    "the finished creature is announced at dawn",
    (await text(".panel .sea")).join(" ").includes(SEA_CREATURE.name),
  );
  check(
    "sea-generating",
    "the job was kept, not asked for again, from the title to the dawn",
    sea.asked.length === askedAtStart,
    `${askedAtStart} → ${sea.asked.length}`,
  );
  await checkCreatureText("sea-dawn", "dawn", SEA_CREATURE);
  await shoot("16-sea-dawn");
  await page.getByRole("button", { name: /Into night/ }).click();
  await page.waitForSelector('[data-phase="night"]');
  await freeze();
  const metNight = await night();
  check("sea-generating", "it is met on the later night", metNight.creature?.id === SEA_CREATURE.id);
  check(
    "sea-generating",
    "meeting it is saved in the bestiary",
    metNight.bestiary.join() === SEA_CREATURE.id && metNight.saved?.join() === SEA_CREATURE.id,
    JSON.stringify(metNight),
  );
  await toDawn();
  await page.waitForSelector(".panel .sea", { timeout: 5000 });
  check(
    "sea-generating",
    "the next asking names what has been met",
    lastAsked() === JSON.stringify([SEA_CREATURE.id]),
    lastAsked(),
  );
  sea.jobsDone = false;

  // 15b a run of nights: each one's creature is asked for as the night before begins, so it is ready by dawn
  sea.mode = "sequence";
  sea.made = 0;
  await openTitle();
  await page.waitForSelector('.sea[data-state="generating"]', { timeout: 5000 });
  await startFromTitle();
  const sequenceNights = [(await night()).creature?.id ?? null];
  for (let nightNumber = 2; nightNumber <= 4; nightNumber++) {
    sea.made = nightNumber - 1; // the job asked for as the last night began has finished by its dawn
    await toDawn();
    const coming = SEQUENCE[nightNumber - 2];
    await page.waitForSelector(`.panel .sea[data-state="ready"][data-creature="${coming.id}"]`, { timeout: 6000 });
    check(
      "sea-nights",
      `dawn ${nightNumber - 1} announces ${coming.name}`,
      (await text(".panel .sea")).join(" ").includes(coming.name),
    );
    if (nightNumber === 3) await shoot("16b-sea-dawn-second");
    await page.getByRole("button", { name: /Into night/ }).click();
    await page.waitForSelector('[data-phase="night"]');
    await freeze();
    sequenceNights.push((await night()).creature?.id ?? null);
  }
  check(
    "sea-nights",
    "three nights in a row each meet a different creature, the first night having none",
    JSON.stringify(sequenceNights) === JSON.stringify([null, ...SEQUENCE.map((creature) => creature.id)]),
    JSON.stringify(sequenceNights),
  );
  check(
    "sea-nights",
    "each night asked with what the line had met, in order",
    JSON.stringify(sea.asked.slice(-4)) ===
      JSON.stringify([[], [SEQUENCE[0].id], [SEQUENCE[0].id, SEQUENCE[1].id], SEQUENCE.map((creature) => creature.id)]),
    JSON.stringify(sea.asked.slice(-4)),
  );

  // 17 ready on the title: the panel, then the creature in the night
  sea.mode = "ready";
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => {
    const section = document.querySelector(".sea");
    const portrait = section?.querySelector("canvas.sea-sprite");
    const box = portrait?.getBoundingClientRect();
    return {
      label: section?.querySelector(".sea-label")?.textContent ?? "",
      name: section?.querySelector(".sea-name")?.textContent ?? "",
      lore: section?.querySelector(".sea-lore")?.textContent ?? "",
      source: portrait?.getAttribute("data-src") ?? "",
      loaded: portrait?.getAttribute("data-loaded") === "1",
      scale: Number(portrait?.getAttribute("data-scale") ?? 0),
      // drawn at a whole multiple of the cropped figure, and big enough to read
      whole: !!portrait && !!box && box.width === portrait.width * Number(portrait.dataset.scale) && box.height >= 48,
      height: box?.height ?? 0,
    };
  });
  check("sea-title", "the panel says what the sea sends", panel.label.startsWith("Tonight the sea sends"), panel.label);
  check(
    "sea-title",
    "the panel names the creature and gives its lore",
    panel.name === SEA_CREATURE.name && panel.lore === SEA_CREATURE.lore,
    `${panel.name}: ${panel.lore}`,
  );
  await checkCreatureText("sea-title", "title", SEA_CREATURE);
  check(
    "sea-title",
    "the panel shows its sprite, from its sprite path",
    panel.loaded && panel.source.includes(`/api/creatures/${SEA_CREATURE.id}/sprite.png`) && panel.whole,
    `${panel.source} ${panel.scale}x, ${panel.height}px tall`,
  );
  check("sea-title", "the sea was asked with nothing met", lastAsked() === "[]", lastAsked());
  await checkTitleScroll("sea-title", 1000, 640);
  // with a creature announced too, the whole title still fits the desktop parchment (it overflowed by 94 px before the
  // setting buttons went)
  await checkScrollFits("sea-title");
  await shoot("17-sea-title");
  await startFromTitle();
  const readyNight = await night();
  check(
    "sea-night",
    "the creature joins the night, with its stats",
    readyNight.creature?.id === SEA_CREATURE.id && readyNight.creature.health === 1,
    JSON.stringify(readyNight.creature),
  );
  check("sea-night", "no panel in the night", (await page.locator(".sea").count()) === 0);
  check("sea-night", "meeting it is saved", readyNight.saved?.join() === SEA_CREATURE.id);
  // let the spawner send it: from a fifth of the night in, a share of the spawns (the verifier hurries the clock and keeps the warden alive)
  let sent = false;
  for (let attempt = 0; attempt < 80 && !sent; attempt++) {
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.monsters = state.monsters.filter((monster) => monster.kind === "creature");
      state.spawnTimer = 0;
      state.elapsed = Math.max(state.elapsed, 9);
      state.hero.health = state.hero.maxHealth;
      for (const lamp of state.lamps) lamp.lit = true;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForTimeout(100);
    sent = await page.evaluate(() => window.lampwarden.state().monsters.some((monster) => monster.kind === "creature"));
  }
  check("sea-night", "the spawner sends the creature", sent);
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    window.lampwarden.scene().setPaused(true);
    state.monsters = state.monsters.filter((monster) => monster.kind === "creature").slice(0, 1);
    for (const monster of state.monsters) {
      monster.x = 600;
      monster.y = 400;
      monster.hurt = 0;
      monster.stun = 0;
    }
    state.hero.x = 300;
    state.hero.y = 330;
    state.puffs = [];
  });
  await freeze();
  await page.waitForTimeout(80);
  check("sea-night", "its sprite is on the stage, loaded from the gallery's file", (await seaSprites()) >= 1);
  const plain = await shoot("18-sea-night");
  const drawnShare = await boxDiff(plain, nightStart, creatureBox, propFrames(liveProps, await drawnProps()));
  check("sea-night", "the creature is drawn where it stands", drawnShare > 0.08, `${(drawnShare * 100).toFixed(0)}%`);
  // the white flash after a blow, then the red tint of the hurt monster
  await page.evaluate(() => {
    for (const monster of window.lampwarden.state().monsters) monster.hurt = 0.25;
  });
  await settle();
  const flashShot = await shoot("19-sea-flash");
  await page.evaluate(() => {
    for (const monster of window.lampwarden.state().monsters) monster.hurt = 0.1;
  });
  await settle();
  const tintShot = await shoot("20-sea-hurt");
  const [plainLight, flashLight] = await Promise.all([
    luminance(plain, [creatureBox]),
    luminance(flashShot, [creatureBox]),
  ]);
  check(
    "sea-night",
    "a blow flashes the creature white",
    flashLight[0] > plainLight[0] + 25,
    `${plainLight[0].toFixed(0)} → ${flashLight[0].toFixed(0)}`,
  );
  const redOverBlue = (encoded) =>
    lab.evaluate(
      async ({ encoded, box }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(box[0], box[1], box[2], box[3]).data;
        let red = 0;
        let blue = 0;
        for (let index = 0; index < data.length; index += 4) {
          red += data[index];
          blue += data[index + 2];
        }
        return red / Math.max(1, blue);
      },
      { encoded, box: creatureBox },
    );
  const [plainRed, tintRed] = [await redOverBlue(plain), await redOverBlue(tintShot)];
  check(
    "sea-night",
    "the hurt creature is tinted red",
    tintRed > plainRed * 1.03,
    `red/blue ${plainRed.toFixed(2)} → ${tintRed.toFixed(2)}`,
  );

  // 20b the heir screen announces the coming creature too, name and lore whole
  sea.mode = "ready";
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await startFromTitle();
  await page.evaluate(() => {
    for (const lamp of window.lampwarden.state().lamps) lamp.lit = false;
    window.lampwarden.scene().setPaused(false);
  });
  await page.waitForSelector('[data-phase="heir"]', { timeout: 5000 });
  await page.waitForSelector('.panel .sea[data-state="ready"]', { timeout: 5000 });
  await freeze();
  await checkCreatureText("sea-heir", "heir", SEA_CREATURE);
  await shoot("20b-sea-heir");

  // 21 a sprite that will not load: nothing is announced and the night has no creature
  sea.mode = "broken";
  await openTitle();
  await page.waitForTimeout(1500);
  check("sea-broken", "a creature whose sprite fails is not announced", (await page.locator(".sea").count()) === 0);
  await startFromTitle();
  const brokenNight = await night();
  check(
    "sea-broken",
    "the night goes without it, and does not count it as met",
    brokenNight.creature === null && brokenNight.bestiary.length === 0,
  );

  // 21b an animated creature: its record has frame counts, the gallery serves its atlas, and the night draws the frame
  // its animation is at (walk while it travels, attack while it claws a lamp or has just struck the warden, idle at
  // rest), flipped as the other monsters are, with the flash, the hurt tint and the lamps' light on every frame
  sea.mode = "animated";
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await startFromTitle();
  const animatedNight = await night();
  check("sea-animated", "the animated creature joins the night", animatedNight.creature?.id === SEA_ANIMATED.id);
  let animatedSent = false;
  for (let attempt = 0; attempt < 80 && !animatedSent; attempt++) {
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.monsters = state.monsters.filter((monster) => monster.kind === "creature");
      state.spawnTimer = 0;
      state.elapsed = Math.max(state.elapsed, 9);
      state.hero.health = state.hero.maxHealth;
      for (const lamp of state.lamps) lamp.lit = true;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForTimeout(100);
    animatedSent = await page.evaluate(() =>
      window.lampwarden.state().monsters.some((monster) => monster.kind === "creature"),
    );
  }
  check("sea-animated", "the spawner sends the animated creature", animatedSent);
  // stands it somewhere clear, as the sim would hold it, and sets what the animation reads (all of it render-only state)
  const stand = (patch) =>
    page.evaluate((patch) => {
      const state = window.lampwarden.state();
      window.lampwarden.scene().setPaused(true);
      state.monsters = state.monsters.filter((monster) => monster.kind === "creature").slice(0, 1);
      for (const monster of state.monsters)
        Object.assign(monster, { x: 600, y: 400, hurt: 0, stun: 0, snuff: 0, attackCooldown: 0, age: 0 }, patch);
      state.hero.x = 300;
      state.hero.y = 330;
      state.puffs = [];
    }, patch);
  // the frames the stage shows for the creature: the pose each sprite's texture came from, and how it is drawn
  const creatureFramesOf = (id) =>
    page.evaluate((id) => {
      const found = [];
      const visit = (node) => {
        const label = node.texture?.source?.label ?? "";
        if (label.startsWith(`/api/creatures/${id}/`) && node.visible && !node.destroyed)
          found.push({
            pose: label.split("/").pop(),
            direction: label.split("#")[1]?.split("/")[0],
            flipped: node.scale.x < 0,
            // the painted shadow is cut out and the pixels kept, which is what the lamps' rim light needs
            shadowless: node.texture.source.resource instanceof Uint8Array,
          });
        for (const child of node.children ?? []) visit(child);
      };
      const app = window.lampwarden.app();
      if (app) visit(app.stage);
      return found;
    }, id);
  const creatureFrames = () => creatureFramesOf(SEA_ANIMATED.id);
  const poseNow = async () => (await creatureFrames()).map((frame) => frame.pose).join();
  const poseShot = async (name, patch) => {
    await stand(patch);
    await freeze();
    await page.waitForTimeout(60);
    return { shot: await shoot(name), pose: await poseNow() };
  };
  const walkFirst = await poseShot("21-sea-animated-walk1", { age: 0 });
  const walkLater = await poseShot("22-sea-animated-walk4", { age: 0.31 });
  check(
    "sea-animated",
    "it walks: a different frame a third of a second on",
    walkFirst.pose === "walk1" && walkLater.pose === "walk4",
    `${walkFirst.pose} then ${walkLater.pose}`,
  );
  const walkChange = await boxDiff(walkLater.shot, walkFirst.shot, creatureBox);
  check(
    "sea-animated",
    "the picture changes between the two walk frames",
    walkChange > 0.02,
    `${(walkChange * 100).toFixed(1)}%`,
  );
  const walkingPoses = new Set();
  for (const age of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
    await stand({ age });
    await settle();
    walkingPoses.add(await poseNow());
  }
  check("sea-animated", "its walk goes through all six frames", walkingPoses.size === 6, [...walkingPoses].join(" "));
  const claw = await poseShot("23-sea-animated-attack", { snuff: 0.1 });
  check("sea-animated", "it claws a lamp with the attack frames", claw.pose.startsWith("attack"), claw.pose);
  const strike = await poseShot("24-sea-animated-strike", { attackCooldown: 0.95 });
  check("sea-animated", "it strikes the warden with the attack frames", strike.pose.startsWith("attack"), strike.pose);
  const rest = await poseShot("25-sea-animated-idle", { stun: 0.05 });
  check("sea-animated", "it stands in the idle frames when a hit holds it", rest.pose.startsWith("idle"), rest.pose);
  const frame = (await creatureFrames())[0];
  check(
    "sea-animated",
    "a frame has its painted shadow cut out, ready for the lamps' rim light",
    frame?.shadowless === true,
  );
  const rightSide = (await creatureFrames())[0]?.flipped;
  await stand({ x: 200, age: 0 });
  await settle();
  const leftSide = (await creatureFrames())[0]?.flipped;
  check("sea-animated", "it faces the middle of the plaza from either side", rightSide === true && leftSide === false);
  // it faces the way it travels: each of the eight ways on the ground, seen from the drawn direction that looks that way
  // (the five drawn ones as they are, the other three mirrored left to right, as the warden's are)
  const WAYS = [
    { way: "e", ground: [1, 0], drawn: "e", mirrored: false },
    { way: "se", ground: [Math.SQRT1_2, Math.SQRT1_2], drawn: "se", mirrored: false },
    { way: "s", ground: [0, 1], drawn: "s", mirrored: false },
    { way: "sw", ground: [-Math.SQRT1_2, Math.SQRT1_2], drawn: "se", mirrored: true },
    { way: "w", ground: [-1, 0], drawn: "e", mirrored: true },
    { way: "nw", ground: [-Math.SQRT1_2, -Math.SQRT1_2], drawn: "ne", mirrored: true },
    { way: "n", ground: [0, -1], drawn: "n", mirrored: false },
    { way: "ne", ground: [Math.SQRT1_2, -Math.SQRT1_2], drawn: "ne", mirrored: false },
  ];
  const facing = {};
  const wayShots = {};
  for (const { way, ground } of WAYS) {
    await stand({ age: 0.31 });
    await settle();
    // a stride of the walk: ground y is twice the screen's
    await page.evaluate(([groundX, groundY]) => {
      const [monster] = window.lampwarden.state().monsters;
      monster.x += groundX * 14;
      monster.y += (groundY * 14) / 2;
    }, ground);
    await settle();
    facing[way] = (await creatureFrames())[0];
    if (["e", "sw", "n"].includes(way)) wayShots[way] = await shoot(`28a-sea-animated-walks-${way}`);
  }
  check(
    "sea-animated",
    "it walks facing each of the eight ways: the matching direction's frames, mirrored for three",
    WAYS.every(
      ({ way, drawn, mirrored }) =>
        facing[way]?.direction === drawn && facing[way]?.flipped === mirrored && facing[way]?.pose === "walk4",
    ),
    WAYS.map(({ way }) => `${way}:${facing[way]?.direction}${facing[way]?.flipped ? "'" : ""}`).join(" "),
  );
  const eastVersusNorth = await boxDiff(wayShots.e, wayShots.n, creatureBox);
  const mirrorVersusAhead = await boxDiff(wayShots.sw, wayShots.e, creatureBox);
  check(
    "sea-animated",
    "the pictures differ from one way to the next",
    eastVersusNorth > 0.05 && mirrorVersusAhead > 0.05,
    `${(eastVersusNorth * 100).toFixed(0)}% ${(mirrorVersusAhead * 100).toFixed(0)}%`,
  );
  // held by a blow it keeps the way it faced, and at the warden's side it faces him
  await stand({ age: 0.31 });
  await settle();
  await page.evaluate(() => {
    const [monster] = window.lampwarden.state().monsters;
    monster.x -= 14;
  });
  await settle();
  await page.evaluate(() => {
    const [monster] = window.lampwarden.state().monsters;
    monster.stun = 0.3;
    monster.x += 40;
    monster.y += 12;
  });
  await settle();
  const held = (await creatureFrames())[0];
  check(
    "sea-animated",
    "a monster thrown by a blow keeps facing the way it was going",
    held?.direction === "e" && held?.flipped === true && held?.pose.startsWith("idle"),
    `${held?.direction}${held?.flipped ? "'" : ""} ${held?.pose}`,
  );
  await stand({ age: 0.31, x: 290, y: 340 });
  await settle();
  const atSide = (await creatureFrames())[0];
  check(
    "sea-animated",
    "at the warden's side it faces him",
    atSide?.direction === "ne" && atSide?.flipped === false,
    `${atSide?.direction}${atSide?.flipped ? "'" : ""} ${atSide?.pose}`,
  );
  await stand({ age: 0, x: 600, y: 400 });
  await settle();
  // the flash and the red tint follow the frame
  await stand({ age: 0.31 });
  await freeze();
  const animatedPlain = await shoot("26-sea-animated-plain");
  await page.evaluate(() => {
    for (const monster of window.lampwarden.state().monsters) monster.hurt = 0.25;
  });
  await settle();
  const animatedFlash = await shoot("27-sea-animated-flash");
  const [animatedPlainLight, animatedFlashLight] = await Promise.all([
    luminance(animatedPlain, [creatureBox]),
    luminance(animatedFlash, [creatureBox]),
  ]);
  check(
    "sea-animated",
    "a blow flashes the frame it is on white",
    animatedFlashLight[0] > animatedPlainLight[0] + 25,
    `${animatedPlainLight[0].toFixed(0)} → ${animatedFlashLight[0].toFixed(0)}`,
  );
  await page.evaluate(() => {
    for (const monster of window.lampwarden.state().monsters) monster.hurt = 0.1;
  });
  await settle();
  const animatedTint = await shoot("28-sea-animated-hurt");
  const [animatedPlainRed, animatedTintRed] = [await redOverBlue(animatedPlain), await redOverBlue(animatedTint)];
  check(
    "sea-animated",
    "the hurt frame is tinted red",
    animatedTintRed > animatedPlainRed * 1.03,
    `red/blue ${animatedPlainRed.toFixed(2)} → ${animatedTintRed.toFixed(2)}`,
  );
  // the sprite the title and the dawn show is the idle picture the job judged
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  const animatedPanel = await page.evaluate(() => {
    const portrait = document.querySelector(".sea canvas.sea-sprite");
    return { loaded: portrait?.dataset.loaded === "1", source: portrait?.dataset.src ?? "" };
  });
  check(
    "sea-animated",
    "the title shows the creature's idle sprite",
    animatedPanel.loaded && animatedPanel.source.includes(`/api/creatures/${SEA_ANIMATED.id}/sprite.png`),
  );

  // 21c a creature made before directions: its record has no `directions`, so it has the one side it was drawn from, flipped
  // by where it stands as the other monsters are, whichever way it travels
  sea.mode = "animated-legacy";
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await startFromTitle();
  let legacySent = false;
  for (let attempt = 0; attempt < 80 && !legacySent; attempt++) {
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.monsters = state.monsters.filter((monster) => monster.kind === "creature");
      state.spawnTimer = 0;
      state.elapsed = Math.max(state.elapsed, 9);
      state.hero.health = state.hero.maxHealth;
      for (const lamp of state.lamps) lamp.lit = true;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForTimeout(100);
    legacySent = await page.evaluate(() =>
      window.lampwarden.state().monsters.some((monster) => monster.kind === "creature"),
    );
  }
  check("sea-animated", "the spawner sends the creature made before directions", legacySent);
  const legacySeen = [];
  for (const [way, ground] of [
    ["e", [1, 0]],
    ["n", [0, -1]],
    ["w", [-1, 0]],
  ]) {
    await stand({ age: 0.31 });
    await settle();
    await page.evaluate(([groundX, groundY]) => {
      const [monster] = window.lampwarden.state().monsters;
      monster.x += groundX * 14;
      monster.y += (groundY * 14) / 2;
    }, ground);
    await settle();
    const [legacyFrame] = await creatureFramesOf(SEA_LEGACY.id);
    legacySeen.push(`${way}:${legacyFrame?.direction}${legacyFrame?.flipped ? "'" : ""} ${legacyFrame?.pose}`);
  }
  check(
    "sea-animated",
    "a creature made before directions keeps its one side and its frames, whichever way it travels",
    legacySeen.every((seen) => seen.includes(":se")) && legacySeen.every((seen) => seen.endsWith("walk4")),
    legacySeen.join(", "),
  );
  await stand({ age: 0.31, x: 600 });
  await settle();
  const legacyRight = (await creatureFramesOf(SEA_LEGACY.id))[0]?.flipped;
  await stand({ age: 0.31, x: 200 });
  await settle();
  const legacyLeft = (await creatureFramesOf(SEA_LEGACY.id))[0]?.flipped;
  check(
    "sea-animated",
    "and it faces the middle of the plaza from either side",
    legacyRight === true && legacyLeft === false,
  );

  page = mainPage;
  await seaContext.close();
  sea.mode = "none";
}

// 21c the building raised on the plaza (API stubbed, see above): the line where the creature is announced, the building
// drawn in the layout's building slot and recorded with the night, shown again on replay, and the committed plaza when its
// sprite will not load or the play is from before buildings
{
  const plazaContext = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  await stubSea(plazaContext);
  await stubDirector(plazaContext);
  const plazaPage = await plazaContext.newPage();
  plazaPage.on("pageerror", (error) => errors.push(`plaza: ${error}`));
  plazaPage.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
      errors.push(`plaza: ${message.text()}`);
  });
  plazaPage.on("response", (response) => {
    if (response.status() >= 400) errors.push(`plaza: HTTP ${response.status()} ${response.url()}`);
  });
  const mainPage = page;
  page = plazaPage;
  const openTitle = async () => {
    await page.goto(`${BASE_URL}/?verify=1`);
    await page.evaluate(() => localStorage.clear());
    plaza.asked.length = 0;
    await page.reload();
    await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
    await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
    await settle();
  };
  const startFromTitle = async () => {
    await page.getByRole("button", { name: "Light the lamps" }).click();
    await page.waitForSelector('[data-phase="night"]');
    await freeze();
  };
  const toDawn = async () => {
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.elapsed = state.length - 0.01;
      state.oilEarned = 12;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
    await freeze();
  };
  const liveKey = `building/${PLAZA_BUILDING.id}`;
  const liveSprites = (props) => props.filter(([key]) => key === liveKey);
  const slotSprites = (props) => props.filter(([key]) => key === liveKey || key === "house" || key === "house-ochre");
  const lastSeen = () => JSON.stringify(plaza.asked.at(-1));
  const expectedPlaza = (seed, withBuilding) => laidOutProps(seed, withBuilding);

  // nothing is coming: no line, the committed plaza
  plaza.mode = "none";
  await openTitle();
  await page.waitForTimeout(300);
  check("plaza-none", "the buildings gallery was asked, with nothing seen yet", lastSeen() === "[]", lastSeen());
  check("plaza-none", "no building line on the title", (await page.locator(".raised").count()) === 0);
  await startFromTitle();
  const plainProps = await drawnProps();
  check(
    "plaza-none",
    "the night's plaza has its committed building and no live one",
    liveSprites(plainProps).length === 0 && slotSprites(plainProps).length === 1,
    JSON.stringify(slotSprites(plainProps)),
  );

  // a building ready: the line on the title, with and without the creature
  plaza.mode = "ready";
  sea.mode = "none";
  await openTitle();
  await page.waitForSelector('.raised[data-state="ready"]', { timeout: 5000 });
  const line = await page.evaluate(() => {
    const element = document.querySelector(".raised");
    return {
      text: element?.textContent ?? "",
      building: element?.getAttribute("data-building") ?? "",
      size: Number.parseFloat(getComputedStyle(element).fontSize),
      inked: element?.hasAttribute("data-line") ?? false,
    };
  });
  check(
    "plaza-title",
    "the line says what was raised on the plaza, by name",
    line.text === `Raised on the plaza tonight: ${PLAZA_BUILDING.name}` && line.building === PLAZA_BUILDING.id,
    line.text,
  );
  check(
    "plaza-title",
    "the line is a line of the scroll, in text of 16 px or more",
    line.inked && line.size >= 16,
    `${line.size}px`,
  );
  check("plaza-title", "the gallery was asked with nothing seen", lastSeen() === "[]", lastSeen());
  await checkBuildingText("plaza-title", "title", PLAZA_BUILDING);
  await checkTitleScroll("plaza-title", 1000, 640);
  await checkScrollFits("plaza-title");
  await shoot("21c-plaza-title");
  // and with a creature announced too: the scroll still holds both
  sea.mode = "ready";
  await openTitle();
  await page.waitForSelector('.sea[data-state="ready"]', { timeout: 5000 });
  await page.waitForSelector('.raised[data-state="ready"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  check(
    "plaza-title-both",
    "the creature and the building are both announced",
    (await page.locator(".sea").count()) === 1 && (await page.locator(".raised").count()) === 1,
  );
  await checkTitleScroll("plaza-title-both", 1000, 640);
  await checkCreatureText("plaza-title-both", "title", SEA_CREATURE);
  await checkBuildingText("plaza-title-both", "title", PLAZA_BUILDING);
  await checkScrollFits("plaza-title-both");
  await shoot("21c-plaza-title-both");
  sea.mode = "none";

  // the night: the building stands in the building slot, drawn from its sprite at the anchor its record gave. A night's seed
  // is random, and a building that fits no spot of the seed's layout is skipped for that night and the committed one stays
  // (src/scene/decor.ts), so a night where it was skipped is checked for that and the next is tried.
  let nightProps = [];
  let placed;
  let skippedNights = 0;
  for (let attempt = 0; attempt < 12 && !placed; attempt++) {
    await openTitle();
    await page.waitForSelector('.raised[data-state="ready"]', { timeout: 5000 });
    await startFromTitle();
    nightProps = await drawnProps();
    placed = nightProps.find(([key]) => key === liveKey);
    if (!placed) {
      skippedNights++;
      check(
        "plaza-night",
        "a night the building fits nowhere keeps the committed one, and no more than one",
        slotSprites(nightProps).length === 1,
        JSON.stringify(slotSprites(nightProps)),
      );
    }
  }
  console.log(`  the live building was skipped on ${skippedNights} night(s) before one placed it`);
  const slot = slotSprites(nightProps);
  check(
    "plaza-night",
    "the live building is drawn, once, instead of the committed one",
    slot.length === 1 && !!placed,
    JSON.stringify(slot),
  );
  check("plaza-night", "no line in the night", (await page.locator(".raised").count()) === 0);
  const anchored = await page.evaluate((id) => {
    let anchorY = null;
    const visit = (node) => {
      if ((node.texture?.source?.label ?? "").includes(`/api/buildings/${id}/sprite.png`) && node.visible)
        anchorY = node.anchor?.y ?? null;
      for (const child of node.children ?? []) visit(child);
    };
    const app = window.lampwarden.app();
    if (app) visit(app.stage);
    return anchorY;
  }, PLAZA_BUILDING.id);
  check(
    "plaza-night",
    "it is drawn at the anchor its record gave",
    anchored !== null && Math.abs(anchored - PLAZA_BUILDING.anchorY) < 1e-6,
    String(anchored),
  );
  checkPropsOnPlaza("plaza-night", "the night's plaza", nightProps);
  await shoot("21c-plaza-night");
  check(
    "plaza-night",
    "the line has seen it: the next question carries its id",
    lastSeen() === JSON.stringify([PLAZA_BUILDING.id]),
    lastSeen(),
  );
  check(
    "plaza-night",
    "seeing it is saved",
    (await page.evaluate(() => localStorage.getItem("lampwarden:raised:v1"))) === JSON.stringify([PLAZA_BUILDING.id]),
  );
  await toDawn();
  await checkBuildingText("plaza-dawn", "dawn", PLAZA_BUILDING);
  const played = await page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:lastPlay") ?? "null"));
  check(
    "plaza-night",
    "the night is recorded with its building",
    played?.building?.id === PLAZA_BUILDING.id && played.building.anchorY === PLAZA_BUILDING.anchorY,
    JSON.stringify(played?.building?.id),
  );
  check(
    "plaza-night",
    "and its plaza is the one its seed lays out with that building",
    sameProps(nightProps, expectedPlaza(played.seed, true)),
    JSON.stringify(nightProps),
  );

  // replay: the same plaza, from the recording alone
  await page.goto(`${BASE_URL}/?replay=last`);
  await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await freeze();
  const replayedProps = await drawnProps();
  check(
    "plaza-replay",
    "a replay shows the plaza with the building the night was played beside",
    sameProps(replayedProps, nightProps) && liveSprites(replayedProps).length === 1,
    JSON.stringify(replayedProps),
  );
  await shoot("21c-plaza-replay");

  // a recording from before buildings has none: it replays on the committed plaza
  const older = { ...played, id: "2026-10-25-09-00-00-nobuilding" };
  delete older.building;
  await page.route(`**/api/plays/${older.id}`, (route) => route.fulfill({ json: older }));
  await page.goto(`${BASE_URL}/?replay=${older.id}`);
  await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await freeze();
  const olderProps = await drawnProps();
  check(
    "plaza-replay",
    "a recording with no building replays on the committed plaza",
    liveSprites(olderProps).length === 0 && sameProps(olderProps, expectedPlaza(older.seed, false)),
    JSON.stringify(olderProps),
  );

  // its sprite will not load: not announced, and the night is the committed plaza
  plaza.mode = "broken";
  await openTitle();
  await page.waitForTimeout(1500);
  check(
    "plaza-broken",
    "a building whose sprite will not load is not announced",
    (await page.locator(".raised").count()) === 0,
  );
  await startFromTitle();
  const brokenProps = await drawnProps();
  check(
    "plaza-broken",
    "the night has the committed plaza",
    liveSprites(brokenProps).length === 0 && slotSprites(brokenProps).length === 1,
    JSON.stringify(slotSprites(brokenProps)),
  );
  check(
    "plaza-broken",
    "and the line has not seen it",
    (await page.evaluate(() => localStorage.getItem("lampwarden:raised:v1"))) === null,
  );
  // the recording of the night that had the building, whose sprite is gone now, replays on the committed plaza
  const gone = { ...played, id: "2026-10-25-09-00-01-bldgone" };
  await page.route(`**/api/plays/${gone.id}`, (route) => route.fulfill({ json: gone }));
  await page.goto(`${BASE_URL}/?replay=${gone.id}`);
  await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await freeze();
  const goneProps = await drawnProps();
  check(
    "plaza-broken",
    "a replay whose building's sprite has gone shows the committed plaza, and does not crash",
    liveSprites(goneProps).length === 0 && sameProps(goneProps, expectedPlaza(gone.seed, false)),
    JSON.stringify(goneProps),
  );

  page = mainPage;
  await plazaContext.close();
  plaza.mode = "none";
  sea.mode = "none";
}

// 22 to 25 the live director (APIs stubbed, see above). A reduced-motion context with no ?verify=1, so the title scroll
// is open and the night's recording is really sent to /api/plays before the director is asked about it.
{
  const directorContext = await browser.newContext({
    viewport: { width: 1000, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await stubSea(directorContext);
  await stubDirector(directorContext);
  const directorPage = await directorContext.newPage();
  directorPage.on("pageerror", (error) => errors.push(`director: ${error}`));
  directorPage.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
      errors.push(`director: ${message.text()}`);
  });
  directorPage.on("response", (response) => {
    if (response.status() >= 400) errors.push(`director: HTTP ${response.status()} ${response.url()}`);
  });
  const mainPage = page;
  page = directorPage;
  const openTitle = async () => {
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    director.asked = [];
    director.uploads = [];
    director.decision = null;
    await page.reload();
    await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
    await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
    await settle();
  };
  const startNight = async (name) => {
    await page.getByRole("button", { name }).click();
    await page.waitForSelector('[data-phase="night"]');
    await freeze();
  };
  // `played`: the warden walks as the night ends, so it reads as engaged; without it nobody touched anything (idle)
  const toDawn = async (played = true) => {
    if (played) {
      // walk for half a second of play first: the recording must show the warden moving for a good part of the night
      await page.evaluate(() => {
        window.lampwarden.scene().stick(1, 0);
        window.lampwarden.scene().setPaused(false);
      });
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => {
      const state = window.lampwarden.state();
      state.elapsed = state.length - 0.01;
      state.oilEarned = 12;
      window.lampwarden.scene().setPaused(false);
    });
    await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
    await freeze();
  };
  const snapshot = () =>
    page.evaluate(() => {
      const state = window.lampwarden.state();
      const legacy = window.lampwarden.legacy();
      return {
        tide: state.tide,
        mix: state.mix,
        creatureShare: state.creatureShare,
        legacyTide: legacy.tide,
        source: legacy.director.source,
        engagement: legacy.director.engagement ?? null,
        directorMix: legacy.director.mix,
        directorShare: legacy.director.creatureShare,
        savedSource: JSON.parse(localStorage.getItem("lampwarden:legacy:v1") ?? "{}").director?.source,
        line: document.querySelector("[data-director-line]")?.textContent ?? null,
        note: [...document.querySelectorAll(".panel p.dim")].map((paragraph) => paragraph.textContent).join(" "),
      };
    });
  const EVEN = { satyr: 1, cyclops: 1, harpy: 1 };

  // 22 the model answers while the dawn panel is up: its line is the sea's answer, and the next night is played under it
  director.mode = "answer";
  await openTitle();
  await startNight("Light the lamps");
  const firstNight = await snapshot();
  check(
    "director-answer",
    "the first night is the rules' night: even mix, a quarter of the spawns the creature's",
    firstNight.source === "rules" &&
      JSON.stringify(firstNight.mix) === JSON.stringify(EVEN) &&
      firstNight.creatureShare === 0.25 &&
      firstNight.tide === 1,
    JSON.stringify(firstNight),
  );
  await toDawn();
  await page.waitForSelector("[data-director-line]", { timeout: 5000 });
  await page.waitForTimeout(300);
  const answered = await snapshot();
  const sentPlay = director.uploads[0];
  check(
    "director-answer",
    "the night's recording went to /api/plays first, and the director was asked about that play",
    director.uploads.length === 1 && director.asked.length === 1 && director.asked[0] === sentPlay?.id,
    `${director.uploads.length} uploads, asked ${director.asked.join()} for ${sentPlay?.id}`,
  );
  check(
    "director-answer",
    "the recording keeps the seconds the tab was hidden (none: it stayed in view), for the engagement summary",
    sentPlay?.hiddenSeconds === 0,
    String(sentPlay?.hiddenSeconds),
  );
  check(
    "director-answer",
    "the recording carries the rules' decision the night was played under",
    sentPlay?.legacy?.director?.source === "rules" && sentPlay.legacy.tide === 1,
    JSON.stringify(sentPlay?.legacy?.director),
  );
  check(
    "director-answer",
    "the dawn panel shows the sea's line, in place of the rules' note",
    answered.line === DIRECTOR_LINE && !/The sea (stays|noticed|draws)/.test(answered.note),
    JSON.stringify({ line: answered.line, note: answered.note }),
  );
  const lineStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector("[data-director-line]"));
    return { italic: style.fontStyle === "italic", colour: style.color };
  });
  check("director-answer", "it is set in the sea's colour, in italics", lineStyle.italic, JSON.stringify(lineStyle));
  check(
    "director-answer",
    "the answer is stored in the legacy (tide included), and saved",
    answered.source === "mubit" &&
      answered.savedSource === "mubit" &&
      answered.legacyTide === director.decision?.tide &&
      answered.legacyTide < 1.1,
    JSON.stringify(answered),
  );
  await shoot("22-director-dawn");

  await startNight(/Into night/);
  const decidedNight = await snapshot();
  check(
    "director-answer",
    "the next night is played at the decision's tide, mix and creature share",
    decidedNight.tide === director.decision?.tide &&
      JSON.stringify(decidedNight.mix) === JSON.stringify(director.decision?.mix) &&
      decidedNight.creatureShare === 0.2,
    JSON.stringify(decidedNight),
  );
  const spawned = await page.evaluate(() => {
    const state = window.lampwarden.state();
    return { satyr: state.mix.satyr, cyclops: state.mix.cyclops, harpy: state.mix.harpy };
  });
  check(
    "director-answer",
    "and the sim's mix is a copy of it (cyclops eased, harpies sharpened)",
    spawned.cyclops === 0.6 && spawned.harpy === 1.5,
    JSON.stringify(spawned),
  );

  // 23 the second night is recorded under the decision, and the model's answer is not asked for twice at once
  director.mode = "fallback";
  await toDawn();
  await page.waitForTimeout(500);
  const secondPlay = director.uploads[1];
  check(
    "director-answer",
    "the second night's recording carries the decision, so a replay builds the same night",
    secondPlay?.legacy?.director?.source === "mubit" &&
      secondPlay.legacy.director.mix.cyclops === 0.6 &&
      secondPlay.legacy.director.creatureShare === 0.2 &&
      secondPlay.legacy.tide === director.decision?.tide,
    JSON.stringify(secondPlay?.legacy?.director),
  );

  // 24 the fallback: the model did not answer in time, so the dawn panel keeps the rules' note and no line
  const fellBack = await snapshot();
  check(
    "director-fallback",
    "no sea line, and the rules' note is shown",
    fellBack.line === null && /^The sea /.test(fellBack.note),
    JSON.stringify({ line: fellBack.line, note: fellBack.note }),
  );
  check(
    "director-fallback",
    "the rules' decision stands: even mix, a quarter, saved as the rules'",
    fellBack.source === "rules" && fellBack.savedSource === "rules",
    JSON.stringify(fellBack),
  );
  await shoot("23-director-fallback-dawn");
  await startNight(/Into night/);
  const fallbackNight = await snapshot();
  check(
    "director-fallback",
    "the next night is the rules' night: its tide, an even mix, a quarter",
    fallbackNight.tide === fallbackNight.legacyTide &&
      JSON.stringify(fallbackNight.mix) === JSON.stringify(EVEN) &&
      fallbackNight.creatureShare === 0.25,
    JSON.stringify(fallbackNight),
  );

  // an unreachable route is the same
  director.mode = "down";
  await toDawn();
  await page.waitForTimeout(500);
  const unreachable = await snapshot();
  check(
    "director-fallback",
    "with the route unreachable the dawn panel is the rules' too, and the shop and Into night work",
    unreachable.line === null &&
      unreachable.source === "rules" &&
      (await page.getByRole("button", { name: /Into night/ }).isEnabled()),
    JSON.stringify(unreachable),
  );

  // 25 an answer that comes after the next night began is ignored
  director.mode = "late";
  let release = () => {};
  director.hold = new Promise((resolve) => {
    release = resolve;
  });
  await startNight(/Into night/);
  await toDawn();
  await page.waitForFunction(() => document.querySelector('[data-phase="dawn"]'));
  await page.waitForTimeout(300);
  const waitingDawn = await snapshot();
  check(
    "director-late",
    "while the answer is awaited the dawn panel is the rules' and the shop can be used",
    waitingDawn.line === null && waitingDawn.source === "rules",
    JSON.stringify(waitingDawn),
  );
  await startNight(/Into night/);
  const lateNightBefore = await snapshot();
  release();
  await page.waitForTimeout(600);
  const lateNightAfter = await snapshot();
  check(
    "director-late",
    "an answer that arrives once the night has begun changes nothing",
    lateNightBefore.tide === lateNightAfter.tide &&
      lateNightAfter.source === "rules" &&
      JSON.stringify(lateNightAfter.mix) === JSON.stringify(EVEN) &&
      lateNightAfter.line === null,
    JSON.stringify({ before: lateNightBefore, after: lateNightAfter }),
  );

  // 26 a night nobody played: it reads idle, and the answer, which tries to ease, is not taken as it stands
  director.mode = "eager";
  // (the night begun in the last scenario is still on stage)
  const tideBeforeIdle = (await snapshot()).legacyTide;
  await toDawn(false);
  await page.waitForSelector("[data-director-line]", { timeout: 5000 });
  const idle = await snapshot();
  check(
    "director-idle",
    "a night with no input reads idle, and the sea's line still shows",
    idle.engagement === "idle" && idle.line === DIRECTOR_LINE,
    JSON.stringify(idle),
  );
  check(
    "director-idle",
    "an answer that eases it is held: the tide at the rules', no weight under 1, the share at least a quarter",
    idle.source === "mubit" &&
      idle.legacyTide === director.decision?.rulesTide &&
      idle.legacyTide >= tideBeforeIdle &&
      Object.values(idle.directorMix).every((weight) => weight >= 1) &&
      idle.directorShare >= 0.25,
    JSON.stringify({ tide: idle.legacyTide, before: tideBeforeIdle, mix: idle.directorMix, share: idle.directorShare }),
  );
  await shoot("25-director-idle-dawn");

  // the heir screen shows the line as well, and a loss nobody played does not lower the tide
  director.mode = "answer";
  await startNight(/Into night/);
  const tideBeforeLoss = (await snapshot()).legacyTide;
  await page.evaluate(() => {
    for (const lamp of window.lampwarden.state().lamps) lamp.lit = false;
    window.lampwarden.scene().setPaused(false);
  });
  await page.waitForSelector('[data-phase="heir"]', { timeout: 5000 });
  await page.waitForSelector("[data-director-line]", { timeout: 5000 });
  await freeze();
  const heirScreen = await snapshot();
  check("director-heir", "the heir screen shows the sea's line too", heirScreen.line === DIRECTOR_LINE);
  check(
    "director-idle",
    "a night lost with nobody playing does not lower the tide (the rules' 0.85 is not applied)",
    heirScreen.engagement === "idle" && heirScreen.legacyTide >= tideBeforeLoss,
    `${tideBeforeLoss} -> ${heirScreen.legacyTide}`,
  );
  await shoot("24-director-heir");

  page = mainPage;
  await directorContext.close();
  director.mode = "off";
}

check("all", "no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

// --- mobile: WebKit (Safari's engine) on phone profiles, with touch ------------------------------------------
const webkitBrowser = await webkit.launch({ headless: HEADLESS });
const boxes = (selector) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, className: element.className };
      }),
    selector,
  );
const overlap = (first, second) =>
  first.x < second.x + second.width &&
  second.x < first.x + first.width &&
  first.y < second.y + second.height &&
  second.y < first.y + first.height;
const inView = (box, viewportWidth, viewportHeight) =>
  box.x >= -1 && box.y >= -1 && box.x + box.width <= viewportWidth + 1 && box.y + box.height <= viewportHeight + 1;
sea.mode = "ready"; // the phone passes show the creature panel on the title and at dawn
plaza.mode = "ready"; // and the line for the building raised on the plaza
director.mode = "answer"; // and the sea's answer at dawn
for (const [tag, device, sex] of [
  ["phone-land", devices["iPhone 14 landscape"], "male"],
  ["phone-port", devices["iPhone 14"], "male"],
  ["phone-land-daughter", devices["iPhone 14 landscape"], "female"], // she is chosen on the title screen first
]) {
  const context = await webkitBrowser.newContext({ ...device });
  await stubSea(context);
  await stubDirector(context);
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${tag}: ${error}`));
  const { width: viewportWidth, height: viewportHeight } = device.viewport;
  await page.goto(`${BASE_URL}/?verify=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="1"]', { timeout: 30000 });
  await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
  await settle();
  const [stage] = await boxes(".stage");
  check(
    tag,
    "canvas fits the screen",
    inView(stage, viewportWidth, viewportHeight),
    `${Math.round(stage.width)}x${Math.round(stage.height)} in ${viewportWidth}x${viewportHeight}`,
  );
  await shoot(`${tag}-1-title`, true);
  await page.waitForSelector('.scroll .sea[data-state="ready"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  await checkTitleScroll(tag, viewportWidth, viewportHeight);
  await checkPhoneText(tag, "title");
  await checkCreatureText(tag, "title", SEA_CREATURE);
  await checkBuildingText(tag, "title", PLAZA_BUILDING);
  await page.locator(".scroll .sea").first().scrollIntoViewIfNeeded();
  const seaTitleBox = await page.locator(".scroll .sea").first().boundingBox();
  check(
    tag,
    "creature panel on the scroll, on screen",
    seaTitleBox && inView(seaTitleBox, viewportWidth, viewportHeight),
    seaTitleBox && `${Math.round(seaTitleBox.width)}x${Math.round(seaTitleBox.height)}`,
  );
  if (sex === "female") {
    await page.locator('.hero-card[data-sex="female"]').tap();
    check(
      tag,
      "tapping her card chooses the daughter",
      (await page.evaluate(() => window.lampwarden.legacy().heir.sex)) === "female",
    );
  }
  await checkHowToPlay(
    tag,
    "touch",
    ["touch-stick", "touch-strike", "touch-shoot"],
    [WEAPONS[sex].strike, WEAPONS[sex].shoot],
  );
  await page.getByRole("button", { name: "Light the lamps" }).scrollIntoViewIfNeeded();
  const [startButton] = await boxes(".btn.big");
  check(tag, "start button on screen (scrolled to)", inView(startButton, viewportWidth, viewportHeight));
  await page.getByRole("button", { name: "Light the lamps" }).tap();
  await page.waitForSelector('[data-phase="night"]');
  await page.waitForTimeout(200);
  const hudBoxes = await boxes(".hud .stats, .hud .nightbar, .hud .lamps");
  const controlBoxes = await boxes(".stick, .tbtn");
  check(
    tag,
    "touch controls shown",
    controlBoxes.length === 3 &&
      controlBoxes.every((box) => box.width > 40 && inView(box, viewportWidth, viewportHeight)),
    controlBoxes.map((box) => `${Math.round(box.width)}px`).join(" "),
  );
  await checkTouchIcons(tag, sex);
  const hudClash = hudBoxes.flatMap((first, index) =>
    hudBoxes
      .slice(index + 1)
      .filter((second) => overlap(first, second))
      .map((second) => `${first.className}×${second.className}`),
  );
  check(tag, "HUD blocks don't overlap", hudClash.length === 0, hudClash.join(" "));
  const controlClash = controlBoxes.flatMap((control) =>
    hudBoxes.filter((hudBox) => overlap(control, hudBox)).map((hudBox) => `${control.className}×${hudBox.className}`),
  );
  check(tag, "controls clear of the HUD", controlClash.length === 0, controlClash.join(" "));
  const hudFontSize = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.querySelector(".hud")).fontSize),
  );
  check(tag, "HUD text at least 16 px", hudFontSize >= 16, `${hudFontSize}px`);
  await checkPhoneText(tag, "night");
  // the closer phone view must not hide gameplay: every plaza corner, every lantern and the top of the spawn rim
  const hiddenPoints = await page.evaluate(() => {
    const canvas = document.querySelector(".stage canvas");
    const stageBox = document.querySelector(".stage")?.getBoundingClientRect();
    if (!canvas || !stageBox) return ["no canvas"];
    const canvasBox = canvas.getBoundingClientRect();
    const toScreen = ([x, y]) => [
      canvasBox.left + (x * canvasBox.width) / 960,
      canvasBox.top + (y * canvasBox.height) / 600,
    ];
    const state = window.lampwarden.state();
    const points = {
      "plaza left": [96, 320],
      "plaza right": [864, 320],
      "plaza top": [480, 128],
      "plaza bottom": [480, 526],
      "spawn rim top": [480, 147 - 22 - 60],
      ...Object.fromEntries(state.lamps.map((lamp, index) => [`lantern ${index + 1}`, [lamp.x, lamp.y - 90]])),
    };
    return Object.entries(points)
      .filter(([, point]) => {
        const [screenX, screenY] = toScreen(point);
        return (
          screenX < stageBox.left || screenX > stageBox.right || screenY < stageBox.top || screenY > stageBox.bottom
        );
      })
      .map(([name]) => name);
  });
  check(tag, "plaza, lanterns and spawn rim all on screen", hiddenPoints.length === 0, hiddenPoints.join(", "));
  // magnification against the plain fit of the whole 960 x 600 canvas into this screen (the layout before cropping)
  const zoom = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.querySelector(".stage canvas");
      if (!canvas) return 0;
      const cssPixelsPerCanvasPixel = canvas.getBoundingClientRect().width / 960;
      const wholeCanvasFit = Math.min(width, height * 1.6) / 960;
      return cssPixelsPerCanvasPixel / wholeCanvasFit;
    },
    { width: viewportWidth, height: viewportHeight },
  );
  check(tag, "playfield shown closer than the whole canvas", zoom > 1.15, `${zoom.toFixed(3)}x the whole-canvas fit`);
  const coveredPoints = await page.evaluate(() => {
    const canvas = document.querySelector(".stage canvas");
    if (!canvas) return ["no canvas"];
    const canvasBox = canvas.getBoundingClientRect();
    const controls = [...document.querySelectorAll(".stick, .tbtn")].map((element) => element.getBoundingClientRect());
    const state = window.lampwarden.state();
    const points = {
      "plaza left": [96, 320],
      "plaza right": [864, 320],
      "plaza bottom": [480, 526],
      ...Object.fromEntries(state.lamps.map((lamp, index) => [`lamp ${index + 1}`, [lamp.x, lamp.y]])),
    };
    return Object.entries(points)
      .filter(([, [x, y]]) => {
        const screenX = canvasBox.left + (x * canvasBox.width) / 960;
        const screenY = canvasBox.top + (y * canvasBox.height) / 600;
        return controls.some(
          (box) => screenX >= box.left && screenX <= box.right && screenY >= box.top && screenY <= box.bottom,
        );
      })
      .map(([name]) => name);
  });
  check(tag, "touch controls cover no lamp or plaza edge", coveredPoints.length === 0, coveredPoints.join(", "));
  // stick: hold right for half a second, the warden must move right
  const startX = await page.evaluate(() => window.lampwarden.state().hero.x);
  const stickBox = controlBoxes.find((box) => box.className.includes("stick"));
  const stickCentre = { x: stickBox.x + stickBox.width / 2, y: stickBox.y + stickBox.height / 2 };
  const touch = { pointerId: 7, isPrimary: true, pointerType: "touch" };
  await page.dispatchEvent(".stick", "pointerdown", { ...touch, clientX: stickCentre.x, clientY: stickCentre.y });
  await page.dispatchEvent(".stick", "pointermove", { ...touch, clientX: stickCentre.x + 50, clientY: stickCentre.y });
  await page.waitForTimeout(500);
  await page.dispatchEvent(".stick", "pointerup", { ...touch, clientX: stickCentre.x + 50, clientY: stickCentre.y });
  const movedX = await page.evaluate(() => window.lampwarden.state().hero.x);
  check(tag, "stick moves the warden", movedX - startX > 30, `Δx ${(movedX - startX).toFixed(0)}`);
  await page.dispatchEvent(".tbtn.melee", "pointerdown", { pointerId: 8, pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(60);
  const animation = await page.evaluate(() => window.lampwarden.state().hero.animation);
  check(tag, "Strike button strikes", animation === "melee", animation);
  const strikePressed = () => page.evaluate(() => document.querySelector(".tbtn.melee")?.hasAttribute("data-pressed"));
  const whileHeld = await strikePressed();
  await page.dispatchEvent(".tbtn.melee", "pointerup", { pointerId: 8, pointerType: "touch", isPrimary: true });
  const afterLetGo = await strikePressed();
  check(
    tag,
    "the Strike button shows the press while held",
    whileHeld === true && afterLetGo === false,
    `${whileHeld}, ${afterLetGo}`,
  );
  await page.evaluate(() => {
    window.lampwarden.state().monsters = [];
    window.lampwarden.scene().freezeClock(1.25);
  });
  await page.waitForTimeout(400);
  await settle();
  await shoot(`${tag}-2-night`, true);
  await seedWeaponShop();
  await page.evaluate(() => {
    const state = window.lampwarden.state();
    state.elapsed = state.length - 0.01;
    state.oilEarned = 40;
  });
  await page.waitForSelector('[data-phase="dawn"]', { timeout: 5000 });
  await page.waitForSelector(".panel .sea", { timeout: 5000 });
  await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
  await settle();
  await checkWeaponShop(tag, sex);
  await checkPhoneText(tag, "dawn");
  await checkCreatureText(tag, "dawn", SEA_CREATURE);
  await checkBuildingText(tag, "dawn", PLAZA_BUILDING);
  await shoot(`${tag}-3-dawn`, true);
  const seaDawn = page.locator(".panel .sea").first();
  await seaDawn.scrollIntoViewIfNeeded();
  const seaDawnBox = await seaDawn.boundingBox();
  check(
    tag,
    "creature panel at dawn reachable",
    seaDawnBox && inView(seaDawnBox, viewportWidth, viewportHeight),
    seaDawnBox && `${Math.round(seaDawnBox.width)}x${Math.round(seaDawnBox.height)}`,
  );
  await shoot(`${tag}-4-dawn-sea`, true);
  await page.waitForSelector("[data-director-line]", { timeout: 5000 });
  const seaLine = page.locator("[data-director-line]");
  await seaLine.scrollIntoViewIfNeeded();
  const seaLineBox = await seaLine.boundingBox();
  check(
    tag,
    "the sea's line at dawn is on screen, inside the panel, and its text is whole",
    seaLineBox &&
      inView(seaLineBox, viewportWidth, viewportHeight) &&
      (await seaLine.textContent()) === DIRECTOR_LINE &&
      (await seaLine.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)),
    seaLineBox && `${Math.round(seaLineBox.width)}x${Math.round(seaLineBox.height)}`,
  );
  await page.waitForTimeout(800); // the line inks in over 0.6 s
  await shoot(`${tag}-5-dawn-line`, true);
  const phoneFonts = await fontsLoaded();
  check(
    tag,
    "pixel fonts loaded",
    phoneFonts.every((font) => font.ok),
    phoneFonts.map((font) => `${font.family}:${font.ok ? "ok" : "MISSING"}`).join(" "),
  );
  // every shop button and the continue button can be scrolled to and tapped
  const upgradeCount = await page.locator(".btn.up").count();
  let reachable = 0;
  for (let index = 0; index < upgradeCount; index++) {
    const upgrade = page.locator(".btn.up").nth(index);
    await upgrade.scrollIntoViewIfNeeded();
    const bounds = await upgrade.boundingBox();
    if (bounds && inView(bounds, viewportWidth, viewportHeight)) reachable++;
  }
  const continueButton = page.getByRole("button", { name: /Into night/ });
  await continueButton.scrollIntoViewIfNeeded();
  const continueBounds = await continueButton.boundingBox();
  check(
    tag,
    "shop and continue reachable",
    upgradeCount === 3 && reachable === 3 && continueBounds && inView(continueBounds, viewportWidth, viewportHeight),
    `${reachable}/${upgradeCount} offers`,
  );
  // a recording from another sim version is described, not played: the panel fits the phone and the way back is in reach
  {
    const [, play] = REFUSED_PLAYS[0];
    await context.route(`**/api/plays/${play.id}`, serveFixturePlay(play));
    await page.goto(`${BASE_URL}/?replay=${play.id}`);
    await page.waitForSelector('[data-phase="replayRefused"]', { timeout: 15000 });
    await page.evaluate(() => window.lampwarden.scene().freezeClock(1.25));
    await settle();
    if (tag !== "phone-land-daughter") await shoot(`${tag}-5-replay-refused`, true);
    const back = page.getByRole("button", { name: "Back to the title" });
    await back.scrollIntoViewIfNeeded();
    const backBounds = await back.boundingBox();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(
      tag,
      "replay of another sim version: the panel and its way back fit the phone",
      backBounds && inView(backBounds, viewportWidth, viewportHeight) && overflow <= 0,
      `button ${backBounds && `${Math.round(backBounds.width)}x${Math.round(backBounds.height)}`}, overflow ${overflow}`,
    );
  }
  await context.close();
}
await webkitBrowser.close();

// --- diffs against the last approved pass, contact sheet ----------------------------------------------------
const diffs = {};
for (const name of shots) {
  const baseline = `${OUT}/baseline/${name}.png`;
  if (existsSync(baseline))
    diffs[name] = await diff(
      readFileSync(`${OUT}/latest/${name}.png`).toString("base64"),
      readFileSync(baseline).toString("base64"),
    );
  if (UPDATE || !existsSync(baseline)) copyFileSync(`${OUT}/latest/${name}.png`, baseline);
}
const sheet = await browser.newPage({ viewport: { width: 1940, height: 800 }, deviceScaleFactor: 1 });
const cells = shots
  .map((name) => {
    const fails = checks.filter((entry) => entry.scene && name.includes(entry.scene) && !entry.ok).length;
    const change = diffs[name] === undefined ? "new" : `${(diffs[name] * 100).toFixed(1)}% changed`;
    return `<figure><img src="data:image/png;base64,${readFileSync(`${OUT}/latest/${name}.png`).toString("base64")}"><figcaption>${name} · ${change}${fails ? ` · <b>${fails} FAILED</b>` : ""}</figcaption></figure>`;
  })
  .join("");
await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:13px monospace;display:grid;grid-template-columns:repeat(4,480px);align-items:start;gap:4px;padding:4px}
figure{margin:0}img{max-width:480px;max-height:520px;image-rendering:pixelated;display:block}figcaption{padding:2px 0}b{color:#ff6b5b}</style>${cells}`);
await sheet.screenshot({ path: `${OUT}/sheet.png`, fullPage: true });

const failed = checks.filter((entry) => !entry.ok);
const report = { url: BASE_URL, visual: !HEADLESS, at: new Date().toISOString(), checks, diffs, failed: failed.length };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const entry of checks)
  console.log(
    `${entry.ok ? "ok  " : "FAIL"} ${entry.scene.padEnd(12)} ${entry.name}${entry.detail ? `  (${entry.detail})` : ""}`,
  );
console.log(
  `\n${HEADLESS ? "HEADLESS (not a visual pass)" : "headed"} · ${checks.length - failed.length}/${checks.length} checks · sheet: ${OUT}/sheet.png`,
);
for (const [name, share] of Object.entries(diffs))
  if (share > 0.01) console.log(`changed vs baseline: ${name} ${(share * 100).toFixed(1)}%`);
await browser.close();
process.exit(failed.length ? 1 : 0);
