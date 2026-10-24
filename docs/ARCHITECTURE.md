# Architecture

## Directory map

```
src/
  app/               Next App Router only: layout.tsx, page.tsx (renders <GameClient/>), globals.css, fonts/, icons,
                     api/plays (store and serve recorded plays), api/creatures (the live creature routes: next, jobs/:jobId,
                     :id/sprite.png), api/director (the live director: one POST per finished night)
  components/        flat: one file per component
    Icon.tsx         16x16 pixel icons (upgrades, the heirs' five traits, oil, kills, touch buttons, the sword and
                     arrow beside the daughter's spear, sling and pouch), drawn as SVG rects; each carries `data-icon`
                     for the verifier
    TouchControls.tsx  on-screen stick and buttons for touch devices; Strike and Shoot show the warden's weapons
    HowToPlay.tsx    the title scroll's "How to play": the controls of the input in use (touch on a coarse pointer, the pad
                     while one is connected, else keyboard and mouse), keys, mouse, pad and touch buttons drawn as pixel
                     art from code; each glyph carries `data-glyph` for the verifier
    TitleScroll.tsx  the title screen's parchment scroll: unrolls, then inks its lines in; a press skips it, ?verify=1 and
                     reduced motion show it open
    GameClient.tsx   dynamic import with ssr:false (Pixi needs the browser)
    SeaSends.tsx     "Tonight the sea sends…": the creature that joins the coming night (sprite, name, lore), or the step
                     of the job still making one; on the title and the dawn and heir panels
    useTonight.ts    asks the gallery which creature comes tonight and follows a job that is still making one; never
                     blocks play (none, a network error and "still generating" all mean the night starts without it)
    Game.tsx         React shell: title (introduction, hero choice), night HUD, dawn upgrades, heir
                     choice; owns the Legacy, the night on stage (state, warden, recording or replay driver), pause,
                     replay speed, tonight's creature and its sprite; renders the @pixi/react <Application> and the
                     window.lampwarden debug hook
    Scene.tsx        the scene as @pixi/react components: steps the sim at a fixed 60 Hz (high ticker priority), one
                     component per entity moved every frame through refs, depth-sorted by ground y; re-renders only when a
                     night starts or a monster spawns or dies. Layers, bottom to top: sky, the tinted sea and ground, the
                     lights that lie on the ground (pools, the warden's light, stone and sea glints), the characters'
                     shadows, the depth-sorted sprites (props, characters, lamps, and each lamp's lantern glow and halo
                     sorted with its lamp), the melee sweep, shots, white blow flashes, marks and the wound vignette
  game/              the game itself, no Pixi
    sim.ts           one night: lamps, monsters, warden, shots, relighting, outcome, dawn bonus, the tide the rules pick (rulesTide) and the live director's mix and creature share; every
                     blow (the melee arc, stun, knockback, the puffs that carry impact bursts and killed monsters' ghosts);
                     a monster's blow on the warden (his hit-stop, knockback and mercy frames); the night's creature from
                     the sea (kind "creature": its stats via monsterStats, sent with a share of the spawns from 8 s in,
                     drawn from rand(state) only when it can come)
    replay.ts        fixed step, input quantisation, Replayer and headless verification of recorded plays (replay.test.ts:
                     determinism); covered by the sim fingerprint (see Sim fingerprint)
    recording.ts     the Play record, Recorder and upload; not part of the sim fingerprint; keeps `hiddenSeconds`, the time the tab was hidden
                     during the night (it stops the sim), which says how long the player was away
    engagement.ts    was the player there? from a recorded play: the share of the night spent moving, strikes, shots, and
                     time away, classed engaged, idle, paused or left; a night that is not engaged is never eased after
                     (the rules' director and the live one both; see docs/DIRECTOR.md)
    director.ts      the live director's contract, shared by the game and the server: what it may change (tide within 0.15 of
                     the rules', a 0.5 to 2 weight per kind, the creature's share 0.1 to 0.4, a 90-character plain line), and
                     the code that enforces it (clampProposal, checkedDecision, directorFrom); a decision applies to one night
    director-api.ts  the game's side of POST /api/director: the request and answer shapes, and asking (any failure is null)
    legacy.ts        what outlives a warden: oil, the nine upgrades (three levels each, one cost table), the shop's offers
                     (three drawn from a seed stored in the legacy, advanced each night), heirs and traits (and their
                     sex), tide and the live director's decision for the coming night, the bestiary (ids of the creatures the line has met); localStorage save, validated with Zod on load (a save or recorded play from before an
                     upgrade existed has it at level 0)
    weapons.ts       what the warden carries as the UI shows it (son: sword and bow; daughter: spear and sling): the
                     touch buttons' icons, the shop's label, text and icon per upgrade, and which warden the shop is
                     for; presentation only, never read by the sim
    random.ts        the seeded generator (mulberry32) shared by the sim and the shop's offers
    controls.ts      keyboard, click, stick and button input between frames, turned into the next sim step's input
    gamepad.ts       Gamepad API: the warden during a night, focus and presses in the menus
    creature.ts      the contract with the live generator: the Creature record, its stats from an archetype plus
                     bounded modifiers, the API paths and shapes (see docs/LIVE_GENERATION.md)
    creature-frames.ts  the animation extension of the creature record (`frames`: idle 4, walk 6, attack 5), the atlas layout and the
                     paces; kept out of creature.ts so the sim fingerprint does not move (frames are drawn, never played)
    creature-api.ts  the game's side of that API: asking for tonight's creature and following a job, answers parsed
                     with Zod; any failure is null
    pressed.ts       the pressed look for buttons that code presses (a pad's A, Enter): `data-pressed` for 100 ms, which
                     the CSS shows like :active (every button sinks onto its 2 px edge and its face darkens)
    plays.ts         the recorded-play id format and the /api/plays body schema shared by the API routes and the
                     recorder (the creature a night met and the sim fingerprint it was played on are optional fields), the
                     running build's fingerprint (RUNNING_SIM) and replaysExactlyOn
  server/creatures/  what the creature routes do, with storage, clock and the job starter injected: service (next, job reads, the
                     stale rule), job (one generation job and its acceptance), limits (salted-hash visitors, hourly and daily
                     starts), store (the interface) with store.blob (private Vercel Blob) and store.memory (tests), config (env), deps
                     (the only module that reads env and files and wires Mubit, the sandbox and Blob)
  server/director/   what the director route does, with store, clock, model and log injected: service (the play, the limits,
                     the model call, the fallbacks, the log), summary (the night as the model is told it, from the stored play),
                     log (the decision record), config (env, limits), store (the interface) with store.blob and store.memory,
                     deps (the only module that reads env and the prompt and wires Mubit and Blob); the prompt is
                     pipeline/prompts/director.md
  scene/             what the scene looks like, plain Pixi
    assets.ts        sprite keys, frame counts and frames per second, ground anchors, asset list for Assets.load; the
                     warden's eight directions (octants), the five of them drawn and the three mirrored
    creature-animation.ts  which frame a creature from the sea shows (walk, attack, idle) from what the sim says about it; drawing only
    layers.ts        textures (and the creature's, loaded at runtime from its sprite path and, with frames, its atlas; a sprite that fails means a
                     night without it), ground (the plaza over the sea), props, night tint (the world below the horizon
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
    rim.ts           character sprites as pixels: the sprite without the shadow it was painted with, and a rim of hard warm
                     pixels along the edge that faces a lamp
    water.ts         the sea as pixel art, painted once into a 12-frame loop: stepped, dithered depths darkening to the
                     horizon, a far sea of flat glints, a swell tile of 2:1 crests and sparkles (a TilingSprite
                     drifting down the grid), surf lapping at the plaza's edges, ripples spreading from the moored
                     boats and the dock's posts
    paint.ts         shared by the painted pixel art: RGBA buffers to nearest-sampled textures, Bayer dither, seeded random
    plaza.ts         the plaza's outline in pixels: its top face, its walls, and how far a point of sea lies from it
    projectiles.ts   arrow and sling-stone pixel art
    vignette.ts      the red vignette that pulses at the screen's edges when the warden is wounded: a dithered ring of hard pixels
                     in three strengths, painted once
    scroll.ts        the title scroll's parchment and rollers as pixel art, painted into RGBA buffers (DOM canvases)
e2e/verify-visual.mjs  headed visual verifier (Playwright; see docs/tooling.md)
scripts/balance.ts   headless balance check (idle and bot wardens, oil income per night, a campaign that spends it in the shop, and nights with a creature of each archetype), run with bun; `--director` plays the same nights under stub director decisions (eased, pushed, each half)
scripts/plays.ts     balance report from recorded plays in Blob storage, with a row per creature from the sea
scripts/measure-pixel-scaling.mjs  headed-browser measurement of where the pixel scaling is done and what it costs (see Pixel scaling)
tools/logo/          logo generator: pixel grids, palette, layout, PNG/ICO/SVG encoders (see Logo below)
tools/sim-fingerprint/  the sim fingerprint: a hash of the sources that decide a night (see Sim fingerprint)
public/sprites/      PNGs the game loads, <id>.ts (the builder code that made each), hero/ frames, manifest.json
pipeline/            offline asset pipeline (see pipeline/README.md)
  run.ts             CLI: brief → generator → render → verifier → fix → best-of → public/sprites
  loop.ts            the loop for one brief (no filesystem: model, renderer and store injected); sprite-loop.ts is the command line's
                     file-backed wrapper (file-store.ts); mubit.ts is the only code that calls Mubit; verifier-image.ts the verifier's view
  creature-frames.ts the frame set of a creature: its code rendered in every pose in one batch, checked (every frame renders, the walk moves) and packed into the atlas
  creature-brief.ts  the brief writer for live creatures (prompts/creature.md), validated with the contract in src/game/creature.ts
  runner-bundle.ts, sandbox-snapshot.ts   the kit + runner + pinned Bun that a render sandbox holds, and the script that snapshots them
  render-types.ts    the renderer's contract (RenderStats, RenderResult) and the validation of what a sandbox sends back
  render-vercel-sandbox.ts   the only renderer: a batch of builds in one Vercel Sandbox VM (build-code.ts rejects banned identifiers first);
                     render-checkout.ts is its entry for the command line (runner files from this checkout, snapshot from the environment)
  hero-animation.ts, hero-frames.ts, check-pixels.ts   hero frame builds, regenerating them, and the pixel-identity check (both in the sandbox)
  assemble-kit.ts    kit/src/*.ts → kit/kit.ts (`bun run kit`)
  prompts/           generator.md (kit API doc), verifier.md
  kit/               building kit: src/*.ts → assemble-kit.ts → kit.ts; exports.json, palette.json, examples/
  render/            what a sandbox VM runs: batch.ts (the batch driver), runner.ts (one sprite) and the canvas shim
docs/ARCHITECTURE.md this file
docs/DIRECTOR.md  design note: the live director (state, bounds, route, loop, a live run against Mubit, balance with stub decisions)
docs/LIVE_GENERATION.md  design note: live generation behind a server route, why only Vercel Sandbox renders, with parallelism and Mubit numbers
```

## Sprite flow

1. `bun run assets -- "your brief"`, or hand-write `pipeline/kit/examples/ex_x.ts` and render it in the sandbox:
   `bun --no-env-file pipeline/render-file.ts pipeline/kit/examples/ex_x.ts x public/sprites` (both need Vercel auth: `docs/tooling.md`; this is how the sprites `lamp-lit`, `lamp-unlit` and the fallbacks `temple-handwritten`, `house-handwritten`, `wall-handwritten` and `stall-handwritten` were made from `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_temple.ts`, `ex_house.ts`, `ex_wall.ts` and `ex_stall.ts`; re-running it reproduces the committed PNGs, checked for `house-handwritten.png` and `lamp-lit.png`). Add the `.ts` and a manifest row by hand. Scenery (buildings and decorations) goes through Mubit instead: `bun run assets -- --candidates 3 --file briefs.json` (pipeline/README.md), then the key goes in `SCENERY` in `src/scene/assets.ts`, which loads it sprite by sprite, with its `ANCHOR_Y` from the manifest's `anchor_y`; a building keeps a `<name>-handwritten` sprite that is drawn when the Mubit one does not load.
2. Check `public/sprites/<slug>.png` and its manifest score; a passing sprite scores ≥ 7.
3. Add the key to `SINGLE` and a `ANCHOR_Y` entry in `src/scene/assets.ts` (fraction of 128 px where the sprite's base touches the ground; tune by eye).
4. Place it in `src/scene/layers.ts` (`PROPS`, static and depth-sorted by ground y; `src/components/Scene.tsx` renders them) or in `src/game/sim.ts` (`MonsterKind` + `MONSTER` stats + `pickKind`) if it should move. Lamps are `LAMP_SPOTS` in `src/game/sim.ts`.

## Sim fingerprint

A recorded night replays exactly only on the sim it was played on: each recording replays to the same end with the code
of the build that recorded it (checked on all nine plays in the store), but a later change to the rules shows a different
night. So the build carries a **sim fingerprint** and every play records the one it was played on.
- **What it is:** the first 12 hex digits of a SHA-256 over the contents (line endings normalised) of the sim's sources,
  `SIM_SOURCES` in `tools/sim-fingerprint/sim-fingerprint.ts`: `src/game/sim.ts`, `random.ts`, `legacy.ts`,
  `director.ts` (the decision a night is played under), `creature.ts`, `replay.ts` and `src/scene/assets.ts`. That is the value-import closure of `step()`, `newNight()` and
  the replay driver (`STEP`, `quantise`, `Replayer`, `legacyOf`, `creatureOf`); a test derives the closure from the
  imports and fails when the list drifts from it. The Recorder and `upload` live in `recording.ts`, outside it.
- **Why a content hash at build time, not the git sha:** it changes only when one of those files changes, so a
  README-only or UI-only commit keeps it and old plays stay replayable. Any edit to those files changes it, a comment
  included: that errs towards refusing an exact replay, never towards showing a wrong night.
- **How it reaches the app:** `next.config.ts` computes it with `simFingerprint(process.cwd())` and inlines it as
  `NEXT_PUBLIC_SIM_FINGERPRINT`; `RUNNING_SIM` in `src/game/plays.ts` reads it. The Recorder stores it as the play's
  optional `sim` field, validated at `/api/plays` (12 lowercase hex digits). `scripts/plays.ts` computes the same hash
  from the checkout. The value is read when Next starts, so under `next dev` restart the server after editing one of
  the sources, or nights recorded afterwards carry the old fingerprint.
- **What it does not cover:** the JavaScript engine's own maths (`Math.sin`, `Math.hypot` and the like), which a
  different engine or version could round differently. The recorded human nights replay exactly across engines (recorded
  in browsers, replayed in Bun). A replay is a pure function of the play (seed, legacy, inputs) and the sim, so the step
  loop and controls, which only shape what is recorded, can't change an old replay.
- **Replay:** `/?replay=<id>` plays a night whose `sim` equals `RUNNING_SIM`. A play with another `sim`, or none (before
  fingerprints), shows the "earlier version" panel with its recorded summary and a way back to the title, and no night
  runs. `bun scripts/plays.ts --verify` replays only the plays on the current fingerprint and counts the rest as
  "recorded on another sim version"; it also prints the plays per build and per sim version.

## Pixel scaling

The game scales its pixels **in the browser's compositor, not in Pixi**. `src/components/Game.tsx` builds the Pixi
application with `resolution: 1`, `autoDensity: false`, `antialias: false` and `roundPixels: true`, so Pixi draws the
960×600 stage into a 960×600 canvas. The canvas is sized by CSS (`.stage`: at most 960 CSS px wide; the phone views crop
the open sea, so the canvas can be shown wider than the stage) and `canvas { image-rendering: pixelated, then crisp-edges }`
in `src/app/globals.css` makes the browser magnify it by nearest neighbour on the GPU. The sprites are 128×128 PNGs
(1× art, `scaleMode: "nearest"`), and the scene's painted textures (`paint.ts`) are 1× RGBA buffers. The HUD is DOM over
the canvas, not Pixi text. So on a 2× display the stage is magnified exactly 2×; on a 1× display not at all; on a phone
by 1.5× to 2.1×, which is not a whole number, so some game pixels are one device pixel wider than others whichever way it is done.

Measured on 24 Oct 2026 on a production build, in headed Chromium (macOS, a 120 Hz display) and headed Playwright WebKit
(iPhone 14 profiles, 60 Hz; WebKit on macOS, not iOS Safari, so a proxy), by `scripts/measure-pixel-scaling.mjs`. It
switches the live renderer between three modes with `app.renderer.resize(960, 600, resolution)` and changes nothing in
the game:
- **A, today:** Pixi at 1×, the browser magnifies.
- **B:** Pixi at the device resolution (canvas pixels = device pixels, no CSS magnification).
- **C:** Pixi at the whole-number part of it (2× or 3×), the browser doing the remainder. It equals A where the device scale is under 2 and B where it is exactly 2.

Each cell is 3 × 20 s of a stick-driven night (a bot walks to the nearest dark lamp or monster and shoots; its health is
topped up so the night lasts). The machine was busy with other work (load average about 10), so read differences under
about 0.1 ms as noise.

| profile (canvas shown at, device px)                     | mode      | backing store      | frame mean / p95 / p99 (ms) at the display's refresh | frames over 20 ms per 1000 | `render()` CPU mean (ms) | render with the GPU finished, 1 px readback (ms) | uncapped frame mean / p95 / p99 (ms) |
| -------------------------------------------------------- | --------- | ------------------ | ---------------------------------------------------- | -------------------------- | ------------------------ | ------------------------------------------------ | ------------------------------------ |
| Chromium, 1440×900 at 2×: 960×600 CSS, 1920×1200         | A         | 960×600, 2.2 MiB   | 8.33 / 9.40 / 10.20                                  | 0.0                        | 0.23                     | 0.52                                             | **0.66** / 1.10 / 1.50 (1,511 fps)   |
|                                                          | B = C     | 1920×1200, 8.8 MiB | 8.33 / 9.20 / 10.10                                  | 0.0                        | 0.19                     | 0.70                                             | **0.94** / 1.60 / 1.90 (1,069 fps)   |
| Chromium, 1280×800 at 1.5×: 960×600 CSS, 1440×900        | A = C     | 960×600, 2.2 MiB   | 8.33 / 8.80 / 9.30                                   | 0.0                        | 0.22                     | 0.69                                             | **0.66** / 1.10 / 1.60 (1,517 fps)   |
|                                                          | B         | 1440×900, 4.9 MiB  | 8.34 / 8.90 / 9.30                                   | 0.0                        | 0.21                     | 0.63                                             | **0.77** / 1.30 / 1.60 (1,303 fps)   |
| WebKit, iPhone 14 landscape (3×): 659×412 CSS, 1978×1236 | A         | 960×600, 2.2 MiB   | 16.70 / 17.00 / 18.00                                | 0.8                        | 0.37                     | 0.64                                             | n/a                                  |
|                                                          | B (2.06×) | 1978×1236, 9.3 MiB | 16.66 / 17.00 / 18.00                                | 0.3                        | 0.35                     | 0.63                                             | n/a                                  |
|                                                          | C (2×)    | 1920×1200, 8.8 MiB | 16.66 / 17.00 / 18.00                                | 0.3                        | 0.33                     | 0.60                                             | n/a                                  |
| WebKit, iPhone 14 portrait (3×): 480×300 CSS, 1440×900   | A = C     | 960×600, 2.2 MiB   | 16.67 / 17.00 / 18.00                                | 0.8                        | 0.34                     | 0.50                                             | n/a                                  |
|                                                          | B (1.5×)  | 1440×900, 4.9 MiB  | 16.67 / 17.00 / 18.00                                | 0.8                        | 0.39                     | 0.78                                             | n/a                                  |

"Uncapped" is Chromium with `--disable-frame-rate-limit --disable-gpu-vsync`, so the frame time is what the work costs
rather than the display's refresh. Chromium's CPU while capped (browser / renderer / GPU process, % of a core): A 1 / 12 /
14 against B 1 / 10 / 11 at 2×, and 1 / 11 / 13 against 2 / 11 / 12 at 1.5×; uncapped the GPU process runs at 178% for A and
159% for B at 2×, but B finishes 30% fewer frames. Frame time at the display's refresh is pinned to the refresh in every
mode (no long frames beyond noise), so nothing here makes the game slower or faster on these machines; the only
difference is headroom, and A has more of it in the uncapped runs. That rests on one uncapped Chromium run per cell on a Mac GPU, and the phones are only proxied by WebKit on macOS, so treat it as "B and C show no gain", not as a measured phone result.

How it looks, from `diff-A-*.png` and `crops.png` written next to the numbers (every crop viewed):
- **The HUD is untouched.** With the canvas hidden the stage screenshots are identical in every mode (0 differing pixels in all four profiles). Over the canvas the text and bars only blend against a different background.
- **At the whole 2× (B = C), a sprite that stays on the same pixel is pixel-identical to A** (the lamps, the hero, the temple). What differs (2.5% of the screenshot's pixels) is (1) the vector layers, which rasterise on the finer grid: the ground's tile lines and the rings and strokes become thin, finely stepped lines that no longer share the sprites' pixel grid, and (2) props whose ground anchor is a fraction of a game pixel (the stall's `0.88 × 128 = 112.64`, the statue, the house, the boats), which `roundPixels` now rounds to half a game pixel instead of a whole one, so they shift by one device pixel. The temple and lamps, whose anchors are whole pixels (0.93 × 128 = 119.04, 0.82 × 128 = 104.96), do not move.
- **At a non-whole scale (1.5×, 2.06×), B is not crisper than A**: Pixi's nearest sampling steps unevenly exactly as the browser's does (7-9% of pixels differ: where the steps fall, plus the thinner lines). C is nearer to A at 2.06× (3.4% differ) but adds a browser resample of 1.03×.

**Recommendation: keep A.** It is already a cheap place (a 1× draw, then a compositor texture scale that takes no CPU work in the page), it keeps every layer on one pixel grid, and B/C draw 2-4× the pixels for no gain in
what a player sees at the display's refresh. Neither B nor C wins on speed and look, so the default is not changed. If a
sharper vector layer were ever wanted, `src/scene/layers.ts` would have to round or snap its strokes and the props'
anchors first. To repeat: `bun run build && bun run start -- -p 3720`, then `bun scripts/measure-pixel-scaling.mjs --url http://localhost:3720`
(see the script's header; it takes `/tmp/lw-screen.lock`, the lock agents hold around headed browsers, while it runs).

## Logo

The logo and everything derived from it (`public/logo/logo.png`, `logo@4x.png`, `logo-noglow.png`, `logo.svg`, and
`src/app/icon.png`, `favicon.ico`, `apple-icon.png`, `opengraph-image.png`, `twitter-image.png`) are generated by
`bun run logo` (`bun tools/logo/build.ts`). The oil-lamp emblem and the 16 px favicon lamp are character grids in
`tools/logo/pixel-art.ts`, coloured by `tools/logo/palette.ts`; the wordmark is `LAMPWARDEN` in Ithaca at 16 px and the
social card's tagline is Tiny5 at 8 px (`src/app/fonts/tiny5/`, OFL), both rasterised from the font files in headless
Chromium through Playwright; `tools/logo/compose.ts` adds outlines, the extruded shadow and the stepped glow and lays
everything out. `bun tools/logo/build.ts --check` writes nothing and reports whether each committed asset still
matches a fresh build.
