# Lampwarden

A night-defence roguelite built at the Mubit Night Shift hackathon (London, 24 Oct 2026). Every night the sea sends its creatures to put out the lamps of Lychnos, a Greek harbour town. You are its lampwarden: strike them down, relight the lamps they snuff, and keep at least one burning until dawn. When a warden falls, an heir takes up the lamp and keeps the oil the line has saved.

The sprites are generated, verified and corrected through [Mubit](https://mubit.ai): a model writes small builder scripts against a fixed isometric renderer, a second model call looks at the rendered image and scores it, and its feedback drives one fix pass.

**Status: a playable one-screen night loop plus the asset pipeline.** See "What's built" below. Live at https://lampwarden.vercel.app (the deployment may lag behind `main`).

## Stack

Next.js 16 (App Router, TypeScript) · React 19 · `pixi.js` 8 with `@pixi/react` (client-only scene in `components/Scene.tsx`: one small component per entity, moved every frame through refs, re-rendered only when a night starts or a monster spawns or dies) · npm. The asset pipeline is Python 3 (+ Pillow) and [bun](https://bun.sh) for local rendering.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
bun scripts/balance.ts   # headless balance check: an idle and a bot warden play nights 1-7
npm run verify:visual -- --url http://localhost:3000   # visual verifier (needs `npm start` running), see below
```

## Checking a change visually

`scripts/verify-visual.mjs` drives the real game in a **headed** Chromium into fixed scenarios (title, night start, combat, dark lamps, near dawn, dawn shop, heir choice, replay) with the sim paused and the clock frozen, screenshots each, and checks pixels and DOM: every lit lantern glows, dark lamps have no light pool, monsters are drawn where they stand, no stray strokes cross the sky, the scene brightens towards dawn, each upgrade has its icon, no console errors or failed requests. Each pass is diffed against the last approved one and laid out in `verify-out/sheet.png` (git-ignored); look at the sheet after every change. `--update` approves the current pass as the new baseline. `--headless` exists but the report then says the pass was not visual.

## Recorded plays

Every night is recorded and sent to `/api/plays`, which stores it as a private blob in the `lampwarden-plays` Vercel Blob store (London). A recording holds the night's seed, the legacy it started from, the warden's input changes at the fixed 60 Hz sim step, and a per-second timeline (kills, lamps lit, health, monsters, lamps lost): about 2.5 KB for a 40 s night, no personal data, a random per-browser session id. The title screen says so.

- Watch one: `/?replay=<id>` (or `/?replay=last` for your own last night), at 1×, 2× or 4×. The end screen says whether the replay ended exactly where the live night did.
- Balance report: `vercel env pull .env.local` once, then `bun scripts/plays.ts [--since 2026-10-24] [--verify]`: outcomes, length, kills per minute, lamps and health lost per night number, and when lost nights go dark.
- `bun scripts/replay-check.ts` records bot nights and checks that every replay ends identically (30/30 when last run).
- The visual verifier opens the game with `?verify=1`, and those nights are not uploaded.

Controls: **WASD / arrows** move, **J / Space** melee, **K / click** ranged shot (towards the cursor on click). Stand next to a dark lamp to relight it.

## The loop

1. **Night.** Five lamps ring the plaza. Satyrs, harpies and (from night 2) cyclops come out of the sea and go for the nearest lit lamp; a monster at a lamp claws it out over a second or two (a red ring shows how far it has got). Lit lamps slow anything in their light. Monsters that get close to the warden turn on them instead.
2. **Relight.** Standing by a dark lamp relights it (gold ring). The night is lost when every lamp is out or the warden falls.
3. **Dawn.** Survive the night timer and the sun burns the stragglers away. Kills and lamps still burning pay out **oil**, which buys upgrades that last for the whole bloodline: brighter wicks, a keener blade, a deeper quiver, a warden's heart.
4. **Heirs.** When a night is lost, the warden is gone and the line starts again from night 1 with the oil and upgrades kept. You pick one of three heirs (male: sword and bow, female: spear and sling), each with a trait (swift, stout, lamplighter, long-armed, keen-eyed).
5. **The tide.** A director reads each night as implicit feedback (kill rate, lamps lost, health kept) and makes the next night's sea calmer or rougher. Nothing is asked of the player.

Progress (generation, night, oil, upgrades, tide) is saved in `localStorage`. The setting buttons on the title screen list Greek (live) and Norse / Egyptian ("soon").

## How the sprites are made (the Mubit loop)

```
brief → Opus via Mubit → build(k) code → render → verifier (Opus via Mubit, sees the image) → one fix → best-of → PNG + code + manifest
```

Details, options and the Shotcup renderer are in [`pipeline/README.md`](pipeline/README.md). The Mubit console's Good/Bad button rates a single model output; the improvement loop here is the verifier's score and issues, fed into the fix call.

### Regenerate assets

```bash
export MUBIT_API_KEY=...        # environment only; never committed (see .env.example)
npm run assets -- "Ionic marble column"
# or: MUBIT_API_KEY=... npm run assets -- "brief one" "brief two"
```

This overwrites/adds files in `public/sprites/` and `public/sprites/manifest.json`. Needs `python3` with Pillow and `bun` on PATH.

## Building kit

The kit is the renderer plus every builder the model may call. It lives in `pipeline/kit/`:

| File | Purpose |
|---|---|
| `src/kit_core.ts` | vector maths, `PALETTE`/`MATS` (29 materials, also in `palette.json`), light/view constants, signed-distance shapes `S`, `Frame` |
| `src/kit_render.ts` | `Kit` class (`k`), z-buffer renderer, outline/shadow, `post()` QA flags, image helpers (`text`, `blank`, `blit`, `onBg`, `montage`) |
| `src/kit_build.ts` | `pose()`, `POSE_NAMES`, `humanoidCore`, `winged` |
| `src/kit_anat.ts` | `spartan`, `cyclops`, `minotaur`, `satyr`, `harpy` |
| `src/kit_beasts.ts` | `quadruped`, `centaur` |
| `src/kit_props.ts` | `column`, `amphora`, `brazier`, `altar`, `statueBase` |
| `src/kit_buildings.ts` | `temple`, `house`, `lampstand`, `wall`, `stall`, plus their internal helpers (local building frame, uniform scale-to-fit, ashlar masonry texture, tiled gable roof) |
| `src/kit_figures.ts` | `humanoid`, `tree`, `hydra` |
| `src/kit_themes.ts` | `THEMES`/`theme()`, `hero`, `ship` |
| `assemble.sh` | `npm run kit`: concatenates the 9 modules into `kit.ts` (rewrites `** 2` to `sq(...)`, asserts no `**`, `==`, `!=` remain). Re-running it reproduces the committed `kit.ts` exactly (checked, sha256 `cf66f505c9e9…`) |
| `kit.ts` | the assembled single file the renderers import (212,457 bytes) |
| `exports.json` | the 58 names destructured into model code |
| `palette.json` | material ramps (identical to the kit's `PALETTE`; checked) |
| `examples/` | `ex_column.ts`, `ex_hoplite.ts` (ported); `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts`, `ex_stall.ts` (hand-written calls to the building builders, see below) |

Related: `pipeline/prompts/generator.md` (the API doc given to the model) and `verifier.md`, and `pipeline/render/` (local bun runner and the `shotcup:canvas` shim).

A build script is `export function build(k) { ... }`. Space is u/v ground, z up, origin `[0,0]` at the tile centre; sprites are 128×128 and auto-scaled to fit. Options below were read from the kit source and `generator.md`; anything omitted falls back to a default.

**Builders (all take `(k, params)`)**

- `hero` `{sex:'male'|'female', melee:'xiphos'|'sword'|'spear'|'axe'|'club'|'hammer', ranged:'bow'|'sling'|'javelin'|'throwspear', ready:'melee'|'ranged', pose, at, facing, setting:'greek', helmet:'none'|'corinthian'|'attic', cape, height, build, palette:{cloth,accent,hair,skin,metal}}`. Poses: `idle`, `idle1-4`, `walk1-6`, `melee1-5`, `ranged1-5`, `hurt`, `death`.
- `humanoid` `{gender, material, robe, ...}` and `humanoidCore`/`spartan`/`cyclops`/`minotaur`/`satyr`/`harpy`/`winged` share the humanoid params: `at, facing, height, build:'slim'|'average'|'heavy'|'giant', pose, skin, head:{type,hair,helmet,helmetMat,crest,beard,eyes,hairStyle}, torso:{armour,colour,trim,skirtColour}, legs:{greaves,sandals,lower,colour}, arms:{bracers,colour}, weapon, weaponMat, shield, stow, fem, skirt, cape, capeStyle, wings:{type,colour,span}`. `harpy`/`winged` also take `span`. Poses also include `attack1-5` for monsters.
- `quadruped` `{at, facing, kind:'horse'|'bull'|'lion'|'dog'|'boar'|'goat', colour, mane, size, pose, rider}`; `centaur` `{at, facing, colour, pose, upper}`; `hydra` `{at, facing, heads, colour}`.
- `ship` `{at, facing, kind:'trireme'|'galley', sail, oars, dock, setting}`; `tree` `{at, kind:'olive'|'cypress'|'laurel', height, leaf}`.
- Props: `column` `{at, order:'doric'|'ionic', height, mat, broken}`; `amphora` `{at, height, style:'black-figure'|'red-figure'|'plain', mat, figure:'warriors'|'horses'|'rider', border:'meander'|'palmette'}`; `brazier` `{at, height, mat, fire}`; `altar` `{at, w, h, mat, fire}`; `statueBase` `{at, w, h, mat}` returns its top z.
- Buildings: `temple` `{at, order:'doric'|'ionic', cols, depth, mat, roof:'terracotta'|'marble', ruined, front:'u'|'v', setting}`; `house` `{at, w, d, storeys:1|2, wall:'whitewash'|'ochre'|'sand'|'stone'|'rose', roof:'flat'|'tiled', door:'u'|'v'|'none', doorColour, windows, shutters, extras:['pots','amphora','chimney','awning','stair','bougainvillea']}`; `lampstand` `{at, height, mat, lit, base:'tripod'|'column', head:'lantern'|'bowl'}`; `wall` `{at, len, height, thick, mat, crenels, gate, sea, axis:'u'|'v'}`; `stall` `{at, w, d, awning, stripe, goods:'fruit'|'fish'|'amphorae'}`. Unlike the other builders they scale themselves down to fit the 128 px frame.
- Low level (`k.*`): `sphere`, `ellipsoid`, `capsule`, `box`, `cyl`, `lathe`, `plate`, `ring` (each `(…, material, {shift, glow, tex})`), and the shape algebra `S.sphere/ellipsoid/capsule/box/obox/cyl/lathe/plate/ring/half/limb/tube/fold/drape/union/smooth/sub/inter` for `k.solid(shape, mat)`.
- Themes: only `greek` exists in `THEMES` (`kit_themes.ts`).

**Buildings come from `kit_buildings.ts`.** `temple`, `house`, `lampstand`, `wall` and `stall` build detailed, parametric structures (stylobate, peristyle of `column()` builders, triglyph or sculpted frieze, sculpted pediment and tiled roof; recessed framed doors and shuttered windows; ashlar masonry; striped awnings; a lit or unlit lantern), and they are documented for the model in `generator.md`. The six examples `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts` and `ex_stall.ts` call them and render to `public/sprites/temple.png`, `house.png`, `lamp-lit.png`, `lamp-unlit.png`, `wall.png` and `stall.png`. Only `temple` and `house` are placed in the scene so far. These examples were hand-written for this repo: they are **not** Mubit output and were never scored by the verifier (their manifest rows say so). No Mubit run has used the building builders yet. Nothing from the earlier v2/v3 prop kit was dropped in the port; the export names were compared.

## What's built, what isn't

Built and run:
- Next app with a client-only Pixi scene: the Lychnos plaza at night (multiplied night tint warming to dawn; lamp light drawn as pixel art in `lib/light.ts`: stepped amber bands with ordered dithering, lit tile bevels, twinkling glints on the stone and the brass lanterns, reflections on the sea), the loop above (nights, lamps, relighting, dawn upgrades, heirs and traits, tide director, persistence), hero (male/female) with idle/walk/melee/ranged animation. `next build` passes; checked in headless Chrome against `next start` with a scripted warden: a full night to dawn (16 kills, all lamps kept, no console errors) and an idle warden losing the lamps to the heir screen.
- Balance from `bun scripts/balance.ts` (150 runs each): an idle warden loses night 1 in about 20 s; the bot warden (perfect information, 150 ms reaction, no upgrades) holds nights 1-3 every time, night 5 about 85-90% and night 7 about 20%. Human play-testing has not been done.
- Asset pipeline (`pipeline/`), kit, 12 sprites from earlier Mubit loop runs (2 hero stills, trireme, galley-dock, lion, olive, Zeus statue, cyclops, satyr, harpy, hydra, Hephaestus), 40 hero animation frames (deterministic builder code, no model call), and 6 hand-written building sprites from the kit's building builders (temple, house, lit and unlit lamp, wall, stall), all in the scene.

Not built / not claimed:
- Norse and Egyptian settings (buttons only), audio, mobile controls, automated tests (the balance script is a check, not a test suite).
- Several Mubit sprites scored under the verifier's pass mark and are weak: lion 5, cyclops 5.5, hydra 5, Zeus statue 6 (marble bolt), satyr 6.5, harpy 6; hero heads and weapons are small. Scores are in `public/sprites/manifest.json`. Pre-generated sprites come from earlier loop runs, not from a run of this repo's `run.py`.
- `pipeline/run.py` was ported and its local render path was exercised (render, flags, no-key shotcup error), but no full Mubit round trip was run from this repo.
- **Shotcup:** the REST client (`pipeline/shotcup_render.py`) was run against the API: 47 renders of 6 sprites were pixel-identical to local, but 118-314x slower (10-107 s per sprite against 0.1-0.3 s), and batching or parallel runs don't help (see `pipeline/README.md`). A design for live generation with Shotcup as the only place model code runs is in [`docs/LIVE_GENERATION.md`](docs/LIVE_GENERATION.md); no Mubit round trip has been run through it.

## Deploy on Vercel

Deployed at https://lampwarden.vercel.app as a standard Next.js app (framework preset "Next.js", default build). The Vercel project has no environment variables, and none are needed for the game. `MUBIT_API_KEY` and `SHOTCUP_API_KEY` are only for the offline asset pipeline; do not set them on the deployment. Sprites are static files under `public/sprites/`.

## More

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): directory map, sprite flow, how to add a sprite or setting. [`PROGRESS.md`](PROGRESS.md): build log.
