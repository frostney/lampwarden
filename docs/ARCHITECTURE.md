# Architecture

## Directory map

```
src/
  app/               Next App Router only: layout.tsx, page.tsx (renders <GameClient/>), globals.css, fonts/, icons,
                     api/plays (store and serve recorded plays)
  components/        flat: one file per component
    Icon.tsx         16x16 pixel icons (upgrades, oil, kills, touch buttons), drawn as SVG rects
    TouchControls.tsx  on-screen stick and buttons for touch devices
    TitleScroll.tsx  the title screen's parchment scroll: unrolls, then inks its lines in; a press skips it, ?verify=1 and
                     reduced motion show it open
    GameClient.tsx   dynamic import with ssr:false (Pixi needs the browser)
    Game.tsx         React shell: title (introduction, setting selector, hero choice), night HUD, dawn upgrades, heir
                     choice; owns the Legacy, the night on stage (state, warden, recording or replay driver), pause,
                     replay speed; renders the @pixi/react <Application> and the window.lampwarden debug hook
    Scene.tsx        the scene as @pixi/react components: steps the sim at a fixed 60 Hz (high ticker priority), one
                     component per entity moved every frame through refs, depth-sorted by ground y; re-renders only when a
                     night starts or a monster spawns or dies
  game/              the game itself, no Pixi
    sim.ts           one night: lamps, monsters, warden, shots, relighting, outcome, dawn bonus, the tide director
    replay.ts        fixed step, input quantisation, Recorder/Replayer for recorded plays (replay.test.ts: determinism)
    legacy.ts        what outlives a warden: oil, upgrades, heirs and traits (and their sex), tide; localStorage save
    controls.ts      keyboard, click, stick and button input between frames, turned into the next sim step's input
    gamepad.ts       Gamepad API: the warden during a night, focus and presses in the menus
    plays.ts         the recorded-play id format shared by the API routes
  scene/             what the scene looks like, plain Pixi
    assets.ts        sprite keys, frame counts and frames per second, ground anchors, asset list for Assets.load
    layers.ts        textures, ground (the plaza over the sea), props, night tint (the world below the horizon is
                     tinted; the sky is not), per-frame strokes
    sky.ts           the night sky above the horizon, painted per stage in its final colours: stepped, dithered bands
                     warming to dawn with the night tint, stars, a crescent moon, a headland with a lighthouse and far
                     islands; twinkling stars, the lighthouse's lamp and the moon's path on the sea from the clock
    light.ts         the light as pixel art, painted once into cached textures: stepped and dithered lamp pools, lantern
                     halos, twinkling glints on the stone and brass, reflections on the sea, the warden's own light
    water.ts         the sea as pixel art, painted once into a 12-frame loop: stepped, dithered depths darkening to the
                     horizon, a far sea of flat glints, a swell tile of 2:1 crests and sparkles (a TilingSprite
                     drifting down the grid), surf lapping at the plaza's edges, ripples spreading from the moored
                     boats and the dock's posts
    paint.ts         shared by the painted pixel art: RGBA buffers to nearest-sampled textures, Bayer dither, seeded random
    plaza.ts         the plaza's outline in pixels: its top face, its walls, and how far a point of sea lies from it
    projectiles.ts   arrow and sling-stone pixel art
    scroll.ts        the title scroll's parchment and rollers as pixel art, painted into RGBA buffers (DOM canvases)
e2e/verify-visual.mjs  headed visual verifier (Playwright; see the README)
scripts/balance.ts   headless balance check (idle and bot wardens), run with bun
scripts/plays.ts     balance report from recorded plays in Blob storage
tools/logo/          logo generator: pixel grids, palette, layout, PNG/ICO/SVG encoders (see Logo below)
public/sprites/      PNGs the game loads, <id>.ts (the builder code that made each), hero/ frames, manifest.json
pipeline/            offline asset pipeline (see pipeline/README.md)
  run.py             brief → generator → render → verifier → fix → best-of → public/sprites
  local_render.py    bun render subprocess with an allowlisted environment (shared by run.py and hero_frames.py)
  prompts/           generator.md (kit API doc), verifier.md
  kit/               building kit: src/*.ts → assemble.sh → kit.ts; exports.json, palette.json, examples/
  render/            local bun renderer + canvas shim
  shotcup_*.py       Shotcup renderer (REST client untested)
  hero_frames.py     regenerate hero animation frames
docs/ARCHITECTURE.md this file
```

## Sprite flow

1. `bun run assets -- "your brief"`, or hand-write `pipeline/kit/examples/ex_x.ts` and render it locally:
   `cd pipeline/render && KIT_OUT=../../public/sprites bun --preload ./shim_plugin.ts run_local.ts ../kit/examples/ex_x.ts x` (this is how the building sprites `temple`, `house`, `lamp-lit`, `lamp-unlit`, `wall` and `stall` were made from `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts` and `ex_stall.ts`; re-running it reproduces the committed PNGs, checked for `house.png` and `lamp-lit.png`). It also writes `x_x4.png`; delete that. Add the `.ts` and a manifest row by hand.
2. Check `public/sprites/<slug>.png` and its manifest score; a passing sprite scores ≥ 7.
3. Add the key to `SINGLE` and a `ANCHOR_Y` entry in `src/scene/assets.ts` (fraction of 128 px where the sprite's base touches the ground; tune by eye).
4. Place it in `src/scene/layers.ts` (`PROPS`, static and depth-sorted by ground y; `src/components/Scene.tsx` renders them) or in `src/game/sim.ts` (`MonsterKind` + `MONSTER` stats + `pickKind`) if it should move. Lamps are `LAMP_SPOTS` in `src/game/sim.ts`.

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
