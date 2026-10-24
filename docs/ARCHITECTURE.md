# Architecture

## Directory map

```
app/                 Next App Router: layout.tsx, page.tsx (renders <GameClient/>), globals.css
components/
  GameClient.tsx     dynamic import with ssr:false (Pixi needs the browser)
  Game.tsx           the scene: <Application>, ground/plaza drawing, depth-sorted sprites, HUD, settings
lib/
  assets.ts          sprite keys, frame counts/fps, ground anchors, asset list for Assets.load
  sim.ts             game state + update(): movement, melee/ranged, monsters, town health
public/sprites/      PNGs the game loads, <id>.ts (the builder code that made each), hero/ frames, manifest.json
pipeline/            offline asset pipeline (see pipeline/README.md)
  run.py             brief → generator → render → verifier → fix → best-of → public/sprites
  prompts/           generator.md (kit API doc), verifier.md
  kit/               building kit: src/*.ts → assemble.sh → kit.ts; exports.json, palette.json, examples/
  render/            local bun renderer + canvas shim
  shotcup_*.py       Shotcup renderer (REST client untested)
  hero_frames.py     regenerate hero animation frames
docs/ARCHITECTURE.md this file
```

## Sprite flow

1. `npm run assets -- "your brief"`, or hand-write `pipeline/kit/examples/ex_x.ts` and render it locally:
   `cd pipeline/render && RIG_OUT=../../public/sprites bun --preload ./shim_plugin.ts run_local.ts ../kit/examples/ex_x.ts x` (this is how `temple` and `house` were made; re-running it for `ex_house.ts` reproduces the committed `house.png`). It also writes `x_x4.png`; delete that. Add the `.ts` and a manifest row by hand.
2. Check `public/sprites/<slug>.png` and its manifest score; a passing sprite scores ≥ 7.
3. Add the key to `SINGLE` and a `ANCHOR_Y` entry in `lib/assets.ts` (fraction of 128 px where the sprite's base touches the ground; tune by eye).
4. Place it in `Game.tsx` (static props are listed in the scene's depth-sorted entity list) or in `lib/sim.ts` (`MonsterKind` + `MONSTER` stats + spawn logic) if it should move.

## Add a setting (Norse, Egyptian…)

1. Kit: add a theme to `THEMES` in `pipeline/kit/src/kit_v6.ts` (the `Theme` type lists the colour slots: metal, trim, cloth, cloth2, accent, leather, wood, skin, hair, sail, hull trim, water, stone), then `npm run kit`. Add builders for setting-specific props (column/temple styles etc.) in `kit_props.ts` if needed, and document them in `prompts/generator.md`.
2. Assets: generate the sprite set with `setting:'norse'` in the briefs and write them under `public/sprites/<setting>/` (the current Greek set is at the top level; moving it is a choice for whoever builds this out).
3. App: `SETTINGS` in `components/Game.tsx` has `{id, label, live}`; flip `live` once the assets exist and make `lib/assets.ts` take a setting id when building paths and the ground palette in `drawGround`.
