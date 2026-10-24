# Architecture

## Directory map

```
src/
  app/               Next App Router only: layout.tsx, page.tsx (renders <GameClient/>), globals.css, fonts/, icons,
                     api/plays (store and serve recorded plays), api/creatures (the live creature routes: next, jobs/:jobId,
                     :id/code, and :id/sprite.png for creatures from before their code was delivered)
  components/        flat: one file per component
    Icon.tsx         16x16 pixel icons (upgrades, oil, kills, touch buttons, the sword and arrow beside the
                     daughter's spear, sling and pouch), drawn as SVG rects; each carries `data-icon` for the verifier
    TouchControls.tsx  on-screen stick and buttons for touch devices; Strike and Shoot show the warden's weapons
    TitleScroll.tsx  the title screen's parchment scroll: unrolls, then inks its lines in; a press skips it, ?verify=1 and
                     reduced motion show it open
    GameClient.tsx   dynamic import with ssr:false (Pixi needs the browser)
    SeaSends.tsx     "Tonight the sea sends…": the creature that joins the coming night (its portrait, drawn from the same
                     render as its sprite in the night; name, lore), or the step of the job still making one; on the title and
                     the dawn and heir panels
    useTonight.ts    asks the gallery which creature comes tonight and follows a job that is still making one; never
                     blocks play (none, a network error and "still generating" all mean the night starts without it)
    Game.tsx         React shell: title (introduction, setting selector, hero choice), night HUD, dawn upgrades, heir
                     choice; owns the Legacy, the night on stage (state, warden, recording or replay driver), pause,
                     replay speed, tonight's creature and its sprite; renders the @pixi/react <Application> and the
                     window.lampwarden debug hook
    Scene.tsx        the scene as @pixi/react components: steps the sim at a fixed 60 Hz (high ticker priority), one
                     component per entity moved every frame through refs, depth-sorted by ground y; re-renders only when a
                     night starts or a monster spawns or dies. Layers, bottom to top: sky, the tinted sea and ground, the
                     lights that lie on the ground (pools, the warden's light, stone and sea glints), the characters'
                     shadows, the depth-sorted sprites (props, characters, lamps, and each lamp's lantern glow and halo
                     sorted with its lamp), the melee sweep, shots and marks
  game/              the game itself, no Pixi
    sim.ts           one night: lamps, monsters, warden, shots, relighting, outcome, dawn bonus, the tide director; every
                     blow (the melee arc, stun, knockback, the puffs that carry impact bursts and killed monsters' ghosts);
                     the night's creature from the sea (kind "creature": its stats via monsterStats, sent with a share of
                     the spawns from 8 s in, drawn from rand(state) only when it can come)
    replay.ts        fixed step, input quantisation, Recorder/Replayer for recorded plays (replay.test.ts: determinism)
    legacy.ts        what outlives a warden: oil, the nine upgrades (three levels each, one cost table), the shop's offers
                     (three drawn from a seed stored in the legacy, advanced each night), heirs and traits (and their
                     sex), tide, the bestiary (ids of the creatures the line has met); localStorage save, validated with Zod on load (a save or recorded play from before an
                     upgrade existed has it at level 0)
    weapons.ts       what the warden carries as the UI shows it (son: sword and bow; daughter: spear and sling): the
                     touch buttons' icons, the shop's label, text and icon per upgrade, and which warden the shop is
                     for; presentation only, never read by the sim
    random.ts        the seeded generator (mulberry32) shared by the sim and the shop's offers
    controls.ts      keyboard, click, stick and button input between frames, turned into the next sim step's input
    gamepad.ts       Gamepad API: the warden during a night, focus and presses in the menus
    creature.ts      the contract with the live generator: the Creature record (with `build`, the SHA-256 of its code and of
                     the pixels it must draw), its stats from an archetype plus bounded modifiers, the API paths and shapes
                     (see docs/LIVE_GENERATION.md)
    creature-build.ts  the check on a creature's code: hash it before it runs and its pixels after, against the record; any
                     mismatch is no creature (the running of the code is injected, so it is tested without a browser)
    creature-api.ts  the game's side of that API: asking for tonight's creature and following a job, answers parsed
                     with Zod; any failure is null
    plays.ts         the recorded-play id format and the /api/plays body schema shared by the API routes and the
                     recorder (the creature a night met is an optional field)
  server/creatures/  what the creature routes do, with storage, clock and the job starter injected: service (next, job reads, the
                     stale rule), job (one generation job and its acceptance), limits (salted-hash visitors, hourly and daily
                     starts), store (the interface) with store.blob (private Vercel Blob) and store.memory (tests), code (the answer of the
                     code route), config (env), deps (the only module that reads env and files and wires Mubit, the renderer and
                     Blob)
  scene/             what the scene looks like, plain Pixi
    assets.ts        sprite keys, frame counts and frames per second, ground anchors, asset list for Assets.load
    layers.ts        textures (and the creature's, drawn at runtime from its code, or loaded from its PNG when its record
                     has no code; a sprite that fails means a night without it), ground (the plaza over the sea), props, night tint (the world below the horizon
                     is tinted; the sky is not), per-frame strokes; monsterLook is the one lookup of a monster's sprite
                     and anchor
    sky.ts           the night sky above the horizon, painted per stage in its final colours: stepped, dithered bands
                     warming to dawn with the night tint, stars, a crescent moon, a headland with a lighthouse and far
                     islands; twinkling stars, the lighthouse's lamp and the moon's path on the sea from the clock
    light.ts         the light as pixel art, painted once into cached textures: stepped and dithered lamp pools, lantern
                     halos, twinkling glints on the stone and brass, reflections on the sea, the warden's own light
    lighting.ts      how the lamps light a character, as numbers (pure, render-only): how lit it is (the pool's own shape,
                     flicker and dawn fade, in whole steps), the warm tint for its sprite, which way its shadows fall and
                     which side its rim is on
    shadow.ts        the cast shadows as pixel art: a tapering lozenge along the ground away from a lamp, per direction and
                     length, painted on first use
    creature-render.ts  draws a creature in the browser: fetches its code, checks it (creature-build.ts), runs it in a Web
                     Worker with a deadline and checks the pixels; one render per creature per page, shared by the scene and the
                     title panel's portrait
    creature-worker.ts  the Web Worker: QuickJS compiled to WebAssembly and the prepared kit, loaded when a creature is
                     announced, one request per worker (code in, 128 x 128 RGBA pixels out)
    rim.ts           character sprites as pixels: the sprite without the shadow it was painted with (from a loaded PNG or from
                     pixels), and a rim of hard warm pixels along the edge that faces a lamp
    water.ts         the sea as pixel art, painted once into a 12-frame loop: stepped, dithered depths darkening to the
                     horizon, a far sea of flat glints, a swell tile of 2:1 crests and sparkles (a TilingSprite
                     drifting down the grid), surf lapping at the plaza's edges, ripples spreading from the moored
                     boats and the dock's posts
    paint.ts         shared by the painted pixel art: RGBA buffers to nearest-sampled textures, Bayer dither, seeded random
    plaza.ts         the plaza's outline in pixels: its top face, its walls, and how far a point of sea lies from it
    projectiles.ts   arrow and sling-stone pixel art
    scroll.ts        the title scroll's parchment and rollers as pixel art, painted into RGBA buffers (DOM canvases)
e2e/verify-visual.mjs  headed visual verifier (Playwright; see the README)
e2e/check-creature-worker.mjs  the browser worker: pixel identity with every committed sprite, isolation probes, timings and bytes
scripts/balance.ts   headless balance check (idle and bot wardens, oil income per night, a campaign that spends it in the shop, and nights with a creature of each archetype), run with bun
scripts/plays.ts     balance report from recorded plays in Blob storage, with a row per creature from the sea
tools/logo/          logo generator: pixel grids, palette, layout, PNG/ICO/SVG encoders (see Logo below)
public/sprites/      PNGs the game loads, <id>.ts (the builder code that made each), hero/ frames, manifest.json
pipeline/            offline asset pipeline (see pipeline/README.md)
  run.ts             CLI: brief → generator → render → verifier → fix → best-of → public/sprites
  loop.ts            the loop for one brief (no filesystem: model, renderer and store injected); sprite-loop.ts is the command line's
                     file-backed wrapper (file-store.ts); mubit.ts is the only code that calls Mubit; verifier-image.ts the verifier's view
  creature-brief.ts  the brief writer for live creatures (prompts/creature.md), validated with the contract in src/game/creature.ts
  runner-bundle.ts, sandbox-snapshot.ts   the kit + runner + pinned Bun that a render sandbox holds, and the script that snapshots them
  render-types.ts    the contract every renderer fulfils (RenderStats, RenderResult); renderers.ts picks one by name
  quickjs-core.ts    runs one build in QuickJS compiled to WebAssembly (no host functions, limits, deadline): the one core the server
                     worker thread, the browser Web Worker and the Node/Bun renderer share; imports nothing from a host
  render-quickjs.ts, quickjs-worker-thread.ts   the `quickjs` renderer: a worker thread per render, terminated at an outer deadline
  prepare-kit.ts, prepared-kit.ts   the kit as plain JavaScript for QuickJS (prepared-kit.ts is generated by `bun run kit`)
  render-finish.ts   a run's stats and pixels as a RenderResult (the PNG is encoded here; server and Node/Bun only)
  render-inprocess-*.ts, measure-inprocess.ts, probe-inprocess.ts   the in-process measurement spike (direct and node-vm are unsafe and
                     measurement-only; quickjs-in-process is what the probes and measurements drive)
  render-local.ts    bun render subprocess with an allowlisted environment
  render-shotcup.ts, render-vercel-sandbox.ts, render-boat.ts   sandboxed renderers (build-code.ts rejects banned identifiers first)
  hero-animation.ts, hero-frames.ts, check-pixels.ts   hero frame builds, regenerating them, and the pixel-identity gate
  assemble-kit.ts    kit/src/*.ts → kit/kit.ts (`bun run kit`)
  prompts/           generator.md (kit API doc), verifier.md
  kit/               building kit: src/*.ts → assemble-kit.ts → kit.ts; exports.json, palette.json, examples/
  render/            local bun runner + canvas shim (also copied into the sandboxes)
docs/ARCHITECTURE.md this file
docs/LIVE_GENERATION.md  design note: live generation behind a server route; Shotcup, Vercel Sandbox and boat.dev compared, with parallelism and Mubit numbers
```

## Sprite flow

1. `bun run assets -- "your brief"` (`--render local|shotcup|vercel|boat`), or hand-write `pipeline/kit/examples/ex_x.ts` and render it locally:
   `cd pipeline/render && KIT_OUT=../../public/sprites bun --preload ./shim_plugin.ts run_local.ts ../kit/examples/ex_x.ts x` (this is how the building sprites `temple`, `house`, `lamp-lit`, `lamp-unlit`, `wall` and `stall` were made from `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts` and `ex_stall.ts`; re-running it reproduces the committed PNGs, checked for `house.png` and `lamp-lit.png`). It also writes `x_x4.png`; delete that. Add the `.ts` and a manifest row by hand.
2. Check `public/sprites/<slug>.png` and its manifest score; a passing sprite scores ≥ 7.
3. Add the key to `SINGLE` and a `ANCHOR_Y` entry in `src/scene/assets.ts` (fraction of 128 px where the sprite's base touches the ground; tune by eye).
4. Place it in `src/scene/layers.ts` (`PROPS`, static and depth-sorted by ground y; `src/components/Scene.tsx` renders them) or in `src/game/sim.ts` (`MonsterKind` + `MONSTER` stats + `pickKind`) if it should move. Lamps are `LAMP_SPOTS` in `src/game/sim.ts`.

## A creature from the sea

1. `POST /api/creatures/next` answers the newest gallery creature the player has not met, or starts a job (one at a time,
   rate limited). The job writes a brief, has the model draw three candidates as `build(k)` code, renders each in QuickJS in a
   worker thread, has the verifier model judge the pixels, and keeps the best one when it is good enough: the code in Blob
   (`sprites/<id>.ts`) and a record with the SHA-256 of that code and of the pixels the verifier saw. No image is stored.
2. The game gets the record. When the creature is announced it fetches `GET /api/creatures/:id/code`, checks the code's hash,
   runs it in a Web Worker (the same QuickJS core and prepared kit, a fresh runtime, memory and stack limits, a 5 s
   deadline) and checks the pixels' hash. The pixels become the night's texture (flash, painted-shadow removal, rim light
   and anchor as for any character) and the portrait on the title panel. Any failure is no creature that night.
3. A record without `build` (drawn before the code was delivered) is loaded from `sprite.png` as before.

## Logo

The logo and everything derived from it (`public/logo/logo.png`, `logo@4x.png`, `logo-noglow.png`, `logo.svg`, and
`src/app/icon.png`, `favicon.ico`, `apple-icon.png`, `opengraph-image.png`, `twitter-image.png`) are generated by
`bun run logo` (`bun tools/logo/build.ts`). The oil-lamp emblem and the 16 px favicon lamp are character grids in
`tools/logo/pixel-art.ts`, coloured by `tools/logo/palette.ts`; the wordmark is `LAMPWARDEN` in Ithaca at 16 px and the
social card's tagline is Tiny5 at 8 px (`src/app/fonts/tiny5/`, OFL), both rasterised from the font files in headless
Chromium through Playwright; `tools/logo/compose.ts` adds outlines, the extruded shadow and the stepped glow and lays
everything out. `bun tools/logo/build.ts --check` writes nothing and reports whether each committed asset still
matches a fresh build.

## Add a setting (Norse, Egyptian…)

1. Kit: add a theme to `THEMES` in `pipeline/kit/src/kit_themes.ts` (the `Theme` type lists the colour slots: metal, trim, cloth, cloth2, accent, leather, wood, skin, hair, sail, hull trim, water, stone), then `bun run kit`. Add builders for setting-specific props in `kit_props.ts` and buildings (temple, house, lamp, wall, stall styles) in `kit_buildings.ts` if needed, and document them in `prompts/generator.md`.
2. Assets: generate the sprite set with `setting:'norse'` in the briefs and write them under `public/sprites/<setting>/` (the current Greek set is at the top level; moving it is a choice for whoever builds this out).
3. App: `SETTINGS` in `src/components/Game.tsx` has `{id, label, live}`; flip `live` once the assets exist and make `src/scene/assets.ts` take a setting id when building paths, and `drawGround` / `PROPS` in `src/scene/layers.ts` take the setting's palette and props.
