# Architecture

## Directory map

```
app/                 Next App Router: layout.tsx, page.tsx (renders <GameClient/>), globals.css
components/
  GameClient.tsx     dynamic import with ssr:false (Pixi needs the browser)
  Game.tsx           React shell: title + setting selector, night HUD, dawn upgrades, heir choice; owns the Legacy, the night on
                     stage (state, warden, recording or replay driver), pause, replay speed; renders the @pixi/react <Application>
  Scene.tsx          the scene as @pixi/react components: steps the sim at a fixed 60 Hz (high ticker priority), one component
                     per entity moved every frame through refs, depth-sorted by ground y; re-renders only when a night starts or
                     a monster spawns or dies
  TouchControls.tsx  on-screen stick and buttons for touch devices
lib/
  assets.ts          sprite keys, frame counts/fps, ground anchors, asset list for Assets.load
  scene.ts           what the scene looks like, plain Pixi: textures, ground, props, night tint, per-frame strokes
  light.ts           the light as pixel art, painted once into cached textures: stepped and dithered lamp pools, lantern
                     halos, twinkling glints on the stone and brass, reflections on the sea, the warden's own light
  controls.ts        keyboard, click, stick and button input between frames, turned into the next sim step's input
  sim.ts             one night, no Pixi: lamps, monsters, warden, shots, relighting, outcome, dawn bonus, the tide director
  replay.ts          fixed step, input quantisation, Recorder/Replayer for recorded plays
  legacy.ts          what outlives a warden: oil, upgrades, heirs and traits, tide; localStorage save
scripts/balance.ts   headless balance check (idle and bot wardens), run with bun
public/sprites/      PNGs the game loads, <id>.ts (the builder code that made each), hero/ frames, manifest.json
pipeline/            offline asset pipeline (see pipeline/README.md)
  run.py             brief → generator → render → verifier → fix → best-of → public/sprites
  local_render.py    bun render subprocess with an allowlisted environment (shared by run.py and hero_frames.py)
  prompts/           generator.md (kit API doc), verifier.md
  kit/               building kit: src/*.ts → assemble.sh → kit.ts; exports.json, palette.json, examples/
  render/            local bun renderer + canvas shim
  shotcup_*.py       Shotcup renderer (REST client, run against the API)
  hero_frames.py     regenerate hero animation frames
docs/ARCHITECTURE.md this file
docs/LIVE_GENERATION.md  design note: live generation behind a server route, Shotcup timings and sandbox probes
```

## Sprite flow

1. `npm run assets -- "your brief"`, or hand-write `pipeline/kit/examples/ex_x.ts` and render it locally:
   `cd pipeline/render && KIT_OUT=../../public/sprites bun --preload ./shim_plugin.ts run_local.ts ../kit/examples/ex_x.ts x` (this is how the building sprites `temple`, `house`, `lamp-lit`, `lamp-unlit`, `wall` and `stall` were made from `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts` and `ex_stall.ts`; re-running it reproduces the committed PNGs, checked for `house.png` and `lamp-lit.png`). It also writes `x_x4.png`; delete that. Add the `.ts` and a manifest row by hand.
2. Check `public/sprites/<slug>.png` and its manifest score; a passing sprite scores ≥ 7.
3. Add the key to `SINGLE` and a `ANCHOR_Y` entry in `lib/assets.ts` (fraction of 128 px where the sprite's base touches the ground; tune by eye).
4. Place it in `lib/scene.ts` (`PROPS`, static and depth-sorted by ground y; `components/Scene.tsx` renders them) or in `lib/sim.ts` (`MonsterKind` + `MONSTER` stats + `pickKind`) if it should move. Lamps are `LAMP_SPOTS` in `lib/sim.ts`.

## Add a setting (Norse, Egyptian…)

1. Kit: add a theme to `THEMES` in `pipeline/kit/src/kit_themes.ts` (the `Theme` type lists the colour slots: metal, trim, cloth, cloth2, accent, leather, wood, skin, hair, sail, hull trim, water, stone), then `npm run kit`. Add builders for setting-specific props in `kit_props.ts` and buildings (temple, house, lamp, wall, stall styles) in `kit_buildings.ts` if needed, and document them in `prompts/generator.md`.
2. Assets: generate the sprite set with `setting:'norse'` in the briefs and write them under `public/sprites/<setting>/` (the current Greek set is at the top level; moving it is a choice for whoever builds this out).
3. App: `SETTINGS` in `components/Game.tsx` has `{id, label, live}`; flip `live` once the assets exist and make `lib/assets.ts` take a setting id when building paths, and `drawGround` / `PROPS` in `lib/scene.ts` take the setting's palette and props.
