# Lampwarden

A Rogue Legacy-style town-defence game, built at the Mubit Night Shift hackathon (London, 24 Oct 2026). You are the lampwarden of a Greek seaside town: keep the town's health up while satyrs, cyclops and harpies wander in from the sea.

The sprites are generated, verified and corrected through [Mubit](https://mubit.ai): a model writes small builder scripts against a fixed isometric renderer, a second model call looks at the rendered image and scores it, and its feedback drives one fix pass.

**Status: a one-screen prototype plus the asset pipeline.** See "What's built" below.

## Stack

Next.js 16 (App Router, TypeScript) · React 19 · `pixi.js` 8 with `@pixi/react` 8 (client-only scene) · npm, Node 20. The asset pipeline is Python 3 (+ Pillow) and [bun](https://bun.sh) for local rendering.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (passes; no deployment has been done)
```

Controls: **WASD / arrows** move, **J / Space** melee, **K / click** ranged shot (towards the cursor on click), the **Male hero / Female hero** buttons switch the hero, and the **Settings** buttons list Greek (active) and Norse / Egyptian ("coming soon" stubs).

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
| `src/kit_v5.ts` | `humanoid`, `tree`, `hydra` |
| `src/kit_v6.ts` | `THEMES`/`theme()`, `hero`, `ship` |
| `assemble.sh` | `npm run kit`: concatenates the 8 modules into `kit.ts` (rewrites `** 2` to `sq(...)`, asserts no `**`, `==`, `!=` remain). Re-running it reproduces the committed `kit.ts` exactly (checked, sha256 `0fadc77d9a7e…`) |
| `kit.ts` | the assembled single file the renderers import (163,785 bytes) |
| `exports.json` | the 53 names destructured into model code |
| `palette.json` | material ramps (identical to the kit's `PALETTE`; checked) |
| `examples/` | `ex_column.ts`, `ex_hoplite.ts` (ported), `ex_temple.ts`, `ex_house.ts` (hand-written, see below) |

Related: `pipeline/prompts/generator.md` (the API doc given to the model) and `verifier.md`, and `pipeline/render/` (local bun runner and the `shotcup:canvas` shim).

A build script is `export function build(k) { ... }`. Space is u/v ground, z up, origin `[0,0]` at the tile centre; sprites are 128×128 and auto-scaled to fit. Options below were read from the kit source and `generator.md`; anything omitted falls back to a default.

**Builders (all take `(k, params)`)**

- `hero` `{sex:'male'|'female', melee:'xiphos'|'sword'|'spear'|'axe'|'club'|'hammer', ranged:'bow'|'sling'|'javelin'|'throwspear', ready:'melee'|'ranged', pose, at, facing, setting:'greek', helmet:'none'|'corinthian'|'attic', cape, height, build, palette:{cloth,accent,hair,skin,metal}}`. Poses: `idle`, `idle1-4`, `walk1-6`, `melee1-5`, `ranged1-5`, `hurt`, `death`.
- `humanoid` `{gender, material, robe, ...}` and `humanoidCore`/`spartan`/`cyclops`/`minotaur`/`satyr`/`harpy`/`winged` share the humanoid params: `at, facing, height, build:'slim'|'average'|'heavy'|'giant', pose, skin, head:{type,hair,helmet,helmetMat,crest,beard,eyes,hairStyle}, torso:{armour,colour,trim,skirtColour}, legs:{greaves,sandals,lower,colour}, arms:{bracers,colour}, weapon, weaponMat, shield, stow, fem, skirt, cape, capeStyle, wings:{type,colour,span}`. `harpy`/`winged` also take `span`. Poses also include `attack1-5` for monsters.
- `quadruped` `{at, facing, kind:'horse'|'bull'|'lion'|'dog'|'boar'|'goat', colour, mane, size, pose, rider}`; `centaur` `{at, facing, colour, pose, upper}`; `hydra` `{at, facing, heads, colour}`.
- `ship` `{at, facing, kind:'trireme'|'galley', sail, oars, dock, setting}`; `tree` `{at, kind:'olive'|'cypress'|'laurel', height, leaf}`.
- Props: `column` `{at, order:'doric'|'ionic', height, mat, broken}`; `amphora` `{at, height, style:'black-figure'|'red-figure'|'plain', mat, figure:'warriors'|'horses'|'rider', border:'meander'|'palmette'}`; `brazier` `{at, height, mat, fire}`; `altar` `{at, w, h, mat, fire}`; `statueBase` `{at, w, h, mat}` returns its top z.
- Low level (`k.*`): `sphere`, `ellipsoid`, `capsule`, `box`, `cyl`, `lathe`, `plate`, `ring` (each `(…, material, {shift, glow, tex})`), and the shape algebra `S.sphere/ellipsoid/capsule/box/obox/cyl/lathe/plate/ring/half/limb/tube/fold/drape/union/smooth/sub/inter` for `k.solid(shape, mat)`.
- Themes: only `greek` exists in `THEMES` (`kit_v6.ts`).

**There are no house, temple, wall or stall builders in the kit** (`ship` has a `dock` option, and that is the only building-like thing). Buildings are composed by hand from the `S.*` shapes and `column`. `examples/ex_temple.ts` and `examples/ex_house.ts` do that, and render to `public/sprites/temple.png` and `house.png` (used in the scene). They were hand-written for this repo: they are **not** Mubit output and were never scored by the verifier (their manifest rows say so). Nothing from the earlier v2/v3 prop kit was dropped in the port; the export names were compared.

## What's built, what isn't

Built and run:
- Next app with a client-only Pixi scene: Greek iso plaza with a temple, a house, olives and a Zeus statue, hero (male/female) with idle/walk/melee/ranged animation, wandering satyrs/cyclops/harpies, projectile, town health, kills HUD, game over + restart, settings stub. `next build` passes; the scene was checked in headless Chrome against the dev server (render, keys, mouse, kills counting, town health to game over).
- Asset pipeline (`pipeline/`), kit, 12 sprites from earlier Mubit loop runs (2 hero stills, trireme, galley-dock, lion, olive, Zeus statue, cyclops, satyr, harpy, hydra, Hephaestus), 40 hero animation frames (deterministic builder code, no model call), and 2 hand-written buildings.

Not built / not claimed:
- Norse and Egyptian settings (buttons only), persistence, upgrades or "legacy" progression, audio, mobile controls, tests.
- Sim balance is rough: with no input the town falls in well under a minute.
- Several Mubit sprites scored under the verifier's pass mark and are weak: lion 5, cyclops 5.5, hydra 5, Zeus statue 6 (marble bolt), satyr 6.5, harpy 6; hero heads and weapons are small. Scores are in `public/sprites/manifest.json`. Pre-generated sprites come from earlier loop runs, not from a run of this repo's `run.py`.
- `pipeline/run.py` was ported and its local render path was exercised (render, flags, no-key shotcup error), but no full Mubit round trip was run from this repo.
- **Shotcup:** the kit was rendered on Shotcup 11 times through its MCP server with pixel-identical output to local, but it was much slower than local (see `pipeline/README.md`), and the Python REST client (`pipeline/shotcup_render.py`) has never been run against the API.

## Deploy on Vercel

Not deployed yet. It is a standard Next.js app: import the repo in Vercel, framework preset "Next.js", default build (`npm run build`), no environment variables needed for the game. `MUBIT_API_KEY` and `SHOTCUP_API_KEY` are only for the offline asset pipeline; do not set them on the deployment. Sprites are static files under `public/sprites/`.

## More

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): directory map, sprite flow, how to add a sprite or setting. [`PROGRESS.md`](PROGRESS.md): build log.
