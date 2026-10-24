# Progress
11:18 started; gh auth ok (frostney), node 20.19.2, npm 11, google-chrome present
11:18 repo frostney/lampwarden created (public, desc set), topics set, git init done
11:19 pipeline/ copied (kit, prompts, render shims) + run.py written (shotcup mode needs pipeline/shotcup_render.py)
11:19 sprites + manifest copied from loop6 (10 key sprites, 2 hero stills, hero frames)
11:20 first 4 commits pushed (kit, prompts, runner, sprites, package.json). Shotcup: write_drive supports {path,url} import -> try raw.githubusercontent kit
11:38 kit completeness audit: assemble.sh reproduces kit.ts exactly (sha 0fadc77d9a7e); export names compared with rig/ v2/v3 prop kit, nothing dropped; kit has no house/temple/wall/stall builders. palette.json added (identical to PALETTE). exports.json (53 names) added.
11:38 examples: ex_column, ex_hoplite (ported), ex_temple, ex_house (hand-written, not Mubit output). temple + house rendered locally and placed in the scene.
11:38 app: Next 16 + @pixi/react scene (plaza, hero m/f, melee/ranged, wandering monsters, town health, kills, game over, settings stub). next build passes. Checked in headless Chrome against the dev server: render, keys, click, kills count, health to game over. Screenshot: screenshot.png.
11:38 Shotcup: kit on drive `lampwarden`, mounted ro at /kit. 11 renders via MCP pixel-identical to local; much slower than local (18 s/hero frame, 41-61 s/sprite vs ~0.4 s local). Kit shrinking would not help (load 0.23 s). shotcup_render.py (REST) written but NOT run against the API.
11:38 docs: README (incl. Building kit), pipeline/README.md, docs/ARCHITECTURE.md. hero_frames.py added (local run reproduces 40/40 committed frames).

## Built vs not
Built: pipeline + kit + sprites, Pixi scene, settings stub, docs above.
Not built: Norse/Egyptian, persistence/upgrades, audio, tests, deploy. Sim balance rough. Weak sprites: lion 5, cyclops 5.5, hydra 5, Zeus 6, satyr 6.5, harpy 6.
Not verified: run.py end-to-end against Mubit from this repo; shotcup_render.py against the API.
