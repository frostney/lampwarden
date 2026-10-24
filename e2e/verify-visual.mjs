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
import { newLegacy, openShop } from "../src/game/legacy.ts";

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
// job then walks through sea.steps) or "broken" (ready, but its sprite never arrives). sea.asked logs the `seen` lists.
const SEA_CREATURE = {
  id: "brine-hound-satyr",
  name: "Drowned sponge diver", // a real generated name
  // lore as long as the contract allows (160), so a panel that only fits short lore fails here
  lore: "He dove too deep for the sponge beds and never rose. Now he climbs the quay dripping and blows our flames out with his last held breath, one by one, till dawn.",
  brief: "a hound of grey sea foam with a lantern jaw, the verifier's fixture",
  archetype: "skulker",
  modifiers: { speed: 1, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 8,
  createdAt: "2026-10-24T01:00:00.000Z",
};
const SEA_SPRITE = readFileSync("public/sprites/satyr.png");
const sea = { mode: "none", steps: ["queued", "drawing", "rendering"], polls: 0, asked: [] };
async function serveSea(route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  if (pathname.endsWith("/sprite.png"))
    return sea.mode === "broken"
      ? route.abort()
      : route.fulfill({ status: 200, contentType: "image/png", body: SEA_SPRITE });
  if (pathname.endsWith("/next")) {
    sea.asked.push(JSON.parse(request.postData() ?? "{}").seen);
    if (sea.mode === "ready" || sea.mode === "broken")
      return route.fulfill({ json: { kind: "ready", creature: SEA_CREATURE } });
    if (sea.mode === "generating") return route.fulfill({ json: { kind: "generating", jobId: "job-verify" } });
    return route.fulfill({ json: { kind: "none", reason: "unavailable" } });
  }
  if (pathname.includes("/jobs/")) {
    const step = sea.steps[Math.min(sea.polls++, sea.steps.length - 1)];
    return route.fulfill({ json: { jobId: "job-verify", step, updatedAt: SEA_CREATURE.createdAt } });
  }
  return route.fulfill({ status: 404, json: { error: "not part of the verifier's stub" } });
}
const stubSea = (target) => target.route("**/api/creatures/**", serveSea);

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
  timeline: Array.from({ length: 41 }, (_, second) => [second + 1, 0, 3, 5, 0, 0]),
  steps: 2460,
  outcome: "dawn",
  stats: { kills: 17, lampsLost: 1, hpLost: 2, time: 41, oilEarned: 30, hp: 3, maxHp: 5, lit: 3 },
});
const REFUSED_PLAYS = [
  ["another sim version", otherVersionPlay("2026-10-20-21-00-00-othersim1", true), "08b-replay-refused"],
  ["no recorded sim", otherVersionPlay("2026-10-20-21-00-00-nosimrec1", false), "08c-replay-unknown-sim"],
];
const serveFixturePlay = (play) => (route) => route.fulfill({ json: play });

const browser = await chromium.launch({ headless: HEADLESS, args: ["--window-size=1040,760"] });
let page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
await stubSea(page);
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
// share of pixels that differ by more than 24 levels in any channel
const diff = (first, second) =>
  lab.evaluate(
    async ({ first, second }) => {
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
      for (let index = 0; index < firstImage.data.length; index += 4)
        if (
          Math.abs(firstImage.data[index] - secondImage.data[index]) > 24 ||
          Math.abs(firstImage.data[index + 1] - secondImage.data[index + 1]) > 24 ||
          Math.abs(firstImage.data[index + 2] - secondImage.data[index + 2]) > 24
        )
          changed++;
      return changed / (firstImage.data.length / 4);
    },
    { first, second },
  );
// share of pixels in a box that differ between two shots
const boxDiff = (first, second, [x, y, width, height]) =>
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
      let changed = 0;
      for (let index = 0; index < firstData.length; index += 4)
        if (
          Math.abs(firstData[index] - secondData[index]) +
            Math.abs(firstData[index + 1] - secondData[index + 1]) +
            Math.abs(firstData[index + 2] - secondData[index + 2]) >
          30
        )
          changed++;
      return changed / (firstData.length / 4);
    },
    { first, second, x, y, width, height },
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
      const visit = (node) => {
        if (labels.includes(node.label)) node.renderable = shown;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.lampwarden.app().stage);
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

// 4 two dark lamps, one being relit
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
  await showLayers(["lamp-post"], true);
  const ringShot = await stageShot();
  await showLayers(["ground-marks", "marks"], false); // before the ring had its own layer it was in the marks
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
  lit.count > 200 && unlit.count > 200 && warmth(lit.colour) > warmth(unlit.colour) * 1.8,
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
    await showLayers(LAMP_LAYERS, false);
    const wardenAlone = await stageShot();
    await showLayers(WARDEN_LAYERS, false);
    const nobody = await stageShot();
    await showLayers(WARDEN_LAYERS, true);
    await showLayers(LAMP_LAYERS, true);
    return {
      post: await changedWithin(full, withoutPost, wardenAlone, nobody),
      glow: await changedWithin(full, withoutGlow, wardenAlone, nobody),
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
    beside.post.changed === 0,
    covered(beside),
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
  const unhurt = (await page.locator(".stage").screenshot()).toString("base64");
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
  const flashShot = await shoot("04c-hero-hit-1-flash");
  check("hero-hit", "a monster's claw wounds the warden once", struck.hits === 1 && struck.health < struck.maxHealth);
  check(
    "hero-hit",
    "the warden is a white flash frame, on his own frame, where he stands",
    flashing.flash.length === 1 &&
      Math.abs(flashing.flash[0].x - woundX) < 40 &&
      /\/hero\/male_idle\d/.test(flashing.flash[0].label),
    JSON.stringify(flashing.flash),
  );
  const white = await changedColour(flashShot, unhurt, [woundX - 22, woundY - 90, 44, 90]);
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
  const edge = await changedColour(flashShot, unhurt, [0, 150, 40, 300]);
  check(
    "hero-hit",
    "the vignette reddens the screen's edge",
    edge.count > 300 && edge.colour[0] > edge.colour[2] * 1.4,
    `${edge.count} pixels, mean rgb ${edge.colour.map((level) => level.toFixed(0)).join(",")}`,
  );
  const burst = await changedColour(flashShot, unhurt, [woundX - 24, woundY - 70, 60, 30]);
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
  const picked = heirCards.find((heir) => heir.daughter) ?? heirCards[0];
  const keptHeir = await page.evaluate(() => JSON.parse(localStorage.getItem("lampwarden:legacy:v1")).heir);
  await page.locator(".btn.heir", { hasText: picked.name }).click();
  await checkWeaponShop("heir-picked", picked.daughter ? "female" : "male");
  await page.evaluate((heir) => {
    const saved = JSON.parse(localStorage.getItem("lampwarden:legacy:v1"));
    localStorage.setItem("lampwarden:legacy:v1", JSON.stringify({ ...saved, heir })); // the later scenes keep their warden
  }, keptHeir);
}

// 8 replay of the night just played (kept locally)
await page.goto(`${BASE_URL}/?replay=last`);
await page.waitForSelector('[data-phase="replay"]', { timeout: 15000 });
await page.waitForTimeout(1200);
await freeze();
shot = await shoot("08-replay");
check("replay", "replay bar shown", (await text(".replaybar")).join("").includes("REPLAY"));

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
        panel.includes(`${play.legacy.heir.name}, night 3: dawn, 17 slain, 1 lamps snuffed, 41 s.`),
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
  const unchanged = await diff(shot, nightStart);
  check("sea-none", "the night start looks as it did", unchanged < 0.005, `${(unchanged * 100).toFixed(2)}% changed`);

  // 15 still being made: its step shows, and the night can start without it
  sea.mode = "generating";
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
  await page.waitForTimeout(2600);
  check(
    "sea-generating",
    "the job is no longer followed once the night has begun",
    sea.polls === pollsAtStart,
    `${pollsAtStart} → ${sea.polls}`,
  );
  // by the dawn the creature is finished: it is announced for the next night, and met in it
  sea.mode = "ready";
  await toDawn();
  await page.waitForSelector('.panel .sea[data-state="ready"]', { timeout: 5000 });
  check(
    "sea-generating",
    "the finished creature is announced at dawn",
    (await text(".panel .sea")).join(" ").includes(SEA_CREATURE.name),
  );
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
  // let the spawner send it: from 8 s in, a share of the spawns (the verifier hurries the clock and keeps the warden alive)
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
  const drawnShare = await boxDiff(plain, nightStart, creatureBox);
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

  page = mainPage;
  await seaContext.close();
  sea.mode = "none";
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
for (const [tag, device, sex] of [
  ["phone-land", devices["iPhone 14 landscape"], "male"],
  ["phone-port", devices["iPhone 14"], "male"],
  ["phone-land-daughter", devices["iPhone 14 landscape"], "female"], // she is chosen on the title screen first
]) {
  const context = await webkitBrowser.newContext({ ...device });
  await stubSea(context);
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
