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
12:13 env audit: gitleaks over history and tree, no leaks; Vercel project has no env vars; deployed JS has no key strings. Found and fixed: generated build code could read the renderer's env (regex bypass); render subprocess now gets an allowlisted env (local_render.py), RIG_OUT renamed KIT_OUT. Hero frames reproduce 40/40.
12:20 game loop rework: lamps, nights to dawn, relighting, warden health, oil + upgrades, heirs + traits, tide director, localStorage. Plain Pixi instead of @pixi/react. scripts/balance.ts. Checked in headless Chrome (dawn and darkness paths, no console errors).
12:22 Knips clip of the initial version (11d2de0, the deployed build): 7.0 s, 1920x1188 H.264, recorded as a canvas region with knips record, trimmed with knips export. Kept outside the repo.

13:10 PR #1 merged. Plays: seeded RNG + fixed 60 Hz step, Recorder/Replayer (lib/replay.ts), /api/plays → private Blob store lampwarden-plays (lhr1), /?replay=<id>, scripts/plays.ts, scripts/replay-check.ts (30/30). One browser-played bot night stored, reported and replayed to the same end (then deleted). Upgrade + oil pixel icons. Visual verifier (scripts/verify-visual.mjs, headed): its first pass caught stray lines from progress rings (arc without moveTo), fixed; 17/17 checks.
13:10 Pixel fonts: researched with licences; in-game captures of 4 pairings; recommendation Ithaca (title) + Tiny5 (UI), not applied yet.

13:20 PR #2 merged. @pixi/react spike (measured, headed Chromium, M1 Max 120 Hz): the 11d2de0 pattern held 120 fps at real loads but updated the scene on only 62-68% of frames (judder) and cost ~1.6x main-thread time; idiomatic @pixi/react is within noise of imperative at normal/200/1000 monsters. Port to idiomatic @pixi/react under way (separate PR).
13:30 Fonts applied (Ithaca titles, Tiny5 UI). Mobile: touch controls, scaled HUD, full-screen menus, both orientations. Verifier: font checks + iPhone landscape/portrait in WebKit; 38/38. Hero anchor fix.
13:30 Dev series (Knips, ~/Movies/knips/lampwarden-series): ep1 the spike (7.0 s), ep2 keep the lamps lit (8.0 s, dawn fast-forwarded via the debug hook), ep3 every night recorded (7.8 s, real night replayed at 4x). A first ep2 take was discarded: another agent's headed browser overlapped the capture region.
13:55 Scene ported to idiomatic @pixi/react as the only renderer (components/Scene.tsx; lib/scene.ts keeps the plain-Pixi drawing, lib/controls.ts the input). Game renders <Application> directly; night/paused/speed/frozen clock are props, input is a mutable controls object; window.lampwarden keeps state/legacy/scene() (setPaused, freezeClock, setSpeed, stick, press) and adds app(). Headed verifier 38/38, every scene screenshot pixel-identical to the imperative build except random heir names, the replay id and the hero's idle frame on the phone night shot (the sim runs there). Bench (headed, 120 Hz, same session, imperative vs port): normal 119.5/119.6 fps, stress 119.6/119.7 fps, script ms/frame within ±0.2; 1000 monsters 119.1 vs 118.0 fps, p99 9.3 vs 16.5 ms (about 1% of frames late), script +0.2 ms. balance and replay-check (30/30) unchanged.

## Built vs not
Built: pipeline + kit + sprites, Pixi scene with the night/lamp/heir loop and persistence, settings stub, docs above. Deployed (initial version) at lampwarden.vercel.app.
Not built: Norse/Egyptian, audio, tests. Balance checked with a bot only, not human-tested. Weak sprites: lion 5, cyclops 5.5, hydra 5, Zeus 6, satyr 6.5, harpy 6.
Not verified: run.py end-to-end against Mubit from this repo; shotcup_render.py against the API.
