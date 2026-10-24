# Asset pipeline

Turns a one-line brief into a pixel-art sprite by looping a generator, a renderer and a verifier, all driven through Mubit. Everything is TypeScript run with [bun](https://bun.sh); there is no Python.

```
brief ──► generator (Opus via Mubit) ──► build(k) code ──► render ──► verifier (Opus via Mubit, sees the image)
                                                                         │ score < 7 or engine flag
                                                                         ▼
                                              one fix call (same session, gets verifier issues + fix)
                                                                         │
                                              best-of(first, fixed) ──► public/sprites/<id>.png + .ts + manifest.json
```

## The loop (what `run.ts` does)

1. **Generate.** The system prompt is `prompts/generator.md` (the kit API doc); the user message is `Brief: <your brief>`. The model returns one function `build(k)` that calls the kit builders (see "Building kit" below).
2. **Render.** The code is run against the kit (`kit/kit.ts`) in a Vercel Sandbox VM and produces a 128×128 PNG plus stats. Deterministic engine checks (`clipped_at_edge`, `too_small`, `too_big`, `too_short`) score 0 and skip the verifier.
3. **Verify.** `prompts/verifier.md` is the system prompt; the model gets the brief, the code, the render stats and the sprite magnified 4× on a flat backdrop, and returns JSON `{pass, score, issues, fix, lesson}`. `pass` means score ≥ 7. A score between 6 and 7 is verified twice and averaged.
4. **Fix.** If not passed, one fix call goes back to the generator (same Mubit session) with the verifier's issues and fix text. The fixed code is rendered and verified the same way.
5. **Best-of.** The higher-scoring attempt is kept (ties go to the first attempt). Its PNG, builder code and manifest row (brief, score, issues, request ids) are written to `public/sprites/`.

Details: max tokens are 1500 for generation (one retry at 4000 on truncation), 3000 for the fix and 1800 for the verifier; one retry on 429/5xx/timeout; no `temperature` is sent. Model code that mentions `import`, `require`, `process`, `Bun`, `fetch`, `eval`, `Function`, `globalThis`, `XMLHttpRequest` or `Deno` is rejected before it runs (`build-code.ts`). That regex is a tripwire, not a sandbox (string-built names get past it), so the generated code only ever runs in a Vercel Sandbox VM (see "Rendering" below): no network, no persistence, and no API key or other secret from your shell reaches it.

### Mubit

Calls go to `https://api.mubit.ai/anthropic/v1/messages` (Anthropic pass-through) with model `claude-opus-5-5`, `x-api-key` from the `MUBIT_API_KEY` environment variable, `anthropic-version: 2023-06-01` (`mubit.ts`). Each call's request id (`x-middleware-request-id` response header), session (`metadata.user_id`), status, token counts and verdict are appended to `pipeline/runs/run.jsonl` (git-ignored; no key or headers are stored).

### Prompt caching

Both system prompts are sent as one text block marked `cache_control: {"type": "ephemeral"}` (5 minute TTL), so the generator's `prompts/generator.md` (about 5.4k tokens) and the verifier's prompt are written to the cache once and read back by the calls that follow within five minutes. `claude-opus-5-5` caches prefixes of at least 512 tokens and bills a read at 0.05x the input price (a write at 1.25x). The breakpoint sits on the system block only: the messages after it (the brief, the code, the image) differ per call, so a marker there would only add write cost. Each log row records `cache_creation_input_tokens` and `cache_read_input_tokens` next to `in_tokens` and `out_tokens`.

Checked live on 24 Oct 2026: two generator calls in a row with `generator.md` as the system prompt. The first wrote 5,379 tokens to the cache (`cache_read_input_tokens` 0), the second read all 5,379 back, so Mubit passes `cache_control` through. Calls that start together (the first briefs of a run with `--concurrency 4`) all miss, since an entry exists only once the first response has begun; later calls hit. `--no-prompt-caching` sends `system` as a plain string, which is what the Python pipeline did.

### The Good/Bad button is not the improvement loop

The Good/Bad button in the Mubit console rates a model output. It is feedback on a single response. The improvement loop in this pipeline is the **verifier**: it looks at the rendered image, scores it, and its issues are fed back into the fix call. Console ratings are not read by this code and do not change what it generates.

## Running it

```bash
export MUBIT_API_KEY=...         # or resolve it in .env.local (docs/tooling.md, "Environment"); never printed or written to disk
export VERCEL_SANDBOX_SNAPSHOT_ID=snap_...   # or in .env.local; from `bun run sandbox:snapshot`, which needs `vercel link` first
bun run assets -- "Ionic marble column"            # writes public/sprites/ionic-marble-column.*
bun run assets -- --file briefs.json               # {"id": ["category", "brief"], ...}
```

`bun run assets` is `varlock run --inject vars --filter=#pipeline -- bun --no-env-file pipeline/run.ts`: bun does not load `.env` files into the process, and Varlock gives it only the variables tagged `pipeline` in `.env.schema` (the Mubit key and the Vercel sandbox settings), so nothing else that sits in your shell or in `.env.local` reaches the pipeline. The model-written build code runs in a sandbox VM that never inherits any of them.

Options: `--out DIR` (default `public/sprites`), `--pose NAME` (hero-style poses such as `walk3`), `--file briefs.json`, `--no-prompt-caching`, `--concurrency N` (briefs in flight; default 4, each with its own sandbox per render), `--candidates N` (2 to 5: the live creature job's loop, N candidates drawn at once, a fix turn only when the best does not pass the verifier, best-of; the winner is written only when the live job's rule `isAccepted` takes it, a verifier pass or a score of at least 6 with no engine flag, and its manifest row then carries `source: "mubit"`, `flags`, `bbox`, the measured `anchor_y` and every candidate's generator request id; a `SUMMARY` line per brief is printed whether it was accepted or not, and a rejected brief makes the run exit 1). The manifest rows and PNGs are overwritten per id; commit the ones you want to keep.

Other scripts (all render in the sandbox and need the same Vercel auth):
- `bun run render -- build.ts name out_dir [pose]` renders one build script and prints the stats.
- `bun run assets:hero -- [--out DIR]` regenerates the hero's animation frames from deterministic builder code (no Mubit call), one sandbox batch of 100 frames a sex, and packs them into one atlas a sex, `public/sprites/hero/male.png` and `female.png` (per sex 20 frames, each from 5 directions: east, south-east, south, north-east and north, 128 px cells in 5 columns; the warden's other three directions are those mirrored in the scene; the layout is `heroAtlasCell` in `src/scene/assets.ts`, which the scene cuts into one texture per frame at load). The humanoid builder draws every facing, away from the camera included, so the kit's `facing` is the only thing that changes between directions (`kitFacing` in `hero-animation.ts`). It reproduces the committed frames byte for byte.
- `bun run reverify:sprites -- score [--only a,b] [--write]` scores committed sprites with the verifier exactly as the live job calls it (the manifest row's brief and build code, the committed PNG, the sandbox's engine stats, the borderline double-take) and applies the live acceptance rule, `isAccepted` in `src/server/creatures/job.ts`; `record` stores the result as each row's `verified` block. `regenerate <id> [--brief text] [--candidates 3]` runs the live job's candidate loop for one sprite and keeps every candidate under `pipeline/runs/reverify/`, with the fix turn run unless the verifier passed the best candidate outright; `install <id>` copies the winner into `public/sprites/` and writes its row. Keep a replacement only after looking at it in the scene, with the same ground anchor (`ANCHOR_Y` is a sim-fingerprint input).
- `bun run check:pixels` renders every committed sprite and hero frame in four sandbox batches (4 vCPUs each, side by side) and compares the pixels with the committed PNGs and atlas cells: 0 differing pixels over all 213 renders, the 200 hero frames compared with their atlas cells. It fails with a clear message when the snapshot does not hold this checkout's kit and runner.
- `bun run calibrate:verifier` renders the committed art in one batch and scores it with the verifier.
- `bun run kit` rebuilds `kit/kit.ts` from `kit/src/*.ts`; `bun run sandbox:snapshot` builds the snapshot every render boots from.

## Layout

| Path                                                                                                     | What                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`                                                                                                 | the command line: briefs in, the loop per brief, at most `--concurrency` at once                                                                                                                                       |
| `loop.ts`                                                                                                | the loop above for one brief; model, renderer and store (call log, attempts) are injected, and it touches no file, so a Vercel function runs it                                                                        |
| `sprite-loop.ts`, `file-store.ts`                                                                        | the command line's wrapper: the store as files (`pipeline/runs`, `public/sprites`), `processBrief`                                                                                                                     |
| `creature-frames.ts`                                                                                     | a live creature's frame set: its code rendered in every pose in one sandbox batch, checked and packed into an atlas                                                                                                    |
| `creature-brief.ts`, `prompts/creature.md`                                                               | the live-creature brief writer: one Mubit call, validated with the game's contract (`src/game/creature.ts`)                                                                                                            |
| `reverify.ts`                                                                                            | `bun run reverify:sprites`: `score` the committed sprites with today's verifier and acceptance rule, `regenerate` one through the candidate loop, `install` the winner; results go to the manifest's `verified` blocks |
| `calibrate-verifier.ts`                                                                                  | `bun run calibrate:verifier`: the verifier over every committed sprite, the score distribution the live acceptance bar is set from                                                                                     |
| `runner-bundle.ts`, `sandbox-snapshot.ts`                                                                | the kit + runner + pinned Bun a render sandbox holds, its digest, and `bun run sandbox:snapshot` that builds the snapshot                                                                                              |
| `mubit.ts`                                                                                               | the Mubit client: the only code that calls Mubit (and marks the system prompt cacheable)                                                                                                                               |
| `verifier-image.ts`                                                                                      | the 4× backdrop image the verifier sees                                                                                                                                                                                |
| `build-code.ts`                                                                                          | the banned-identifier tripwire and the `function build` check                                                                                                                                                          |
| `render-types.ts`                                                                                        | the contract: `RenderRequest` in, `RenderResult` (`RenderStats` + PNG bytes, or an error) out, and the validation of a batch's results                                                                                 |
| `render/batch.ts`, `render/runner.ts`, `render/shim_canvas.ts`, `render/shim_plugin.ts`                  | what a sandbox VM runs: the batch driver, the runner for one sprite, and the canvas module the kit imports (as `shotcup:canvas`, its first home)                                                                       |
| `render-vercel-sandbox.ts`, `render-checkout.ts`                                                         | the Vercel Sandbox renderer (below); the second reads the runner files from this checkout and the snapshot id from the environment                                                                                     |
| `render-file.ts`, `hero-animation.ts`, `hero-frames.ts`, `check-pixels.ts`                               | render one file; the hero frame builds; regenerate them; the pixel-identity gate                                                                                                                                       |
| `assemble-kit.ts`, `kit/src/*.ts`, `kit/kit.ts`, `kit/exports.json`, `kit/palette.json`, `kit/examples/` | the building kit (see "Building kit" below)                                                                                                                                                                            |
| `prompts/generator.md`, `prompts/verifier.md`, `prompts/creature.md`                                     | the three system prompts                                                                                                                                                                                               |

A `RenderResult` is `{ ok: true, stats, png }` or `{ ok: false, error }`, and the renderer the loop uses never throws. The stats line a runner prints and a batch's results file are validated with Zod once, in `render-types.ts`. Build names and poses may only contain letters, digits, `_` and `-`, because they end up in file paths and a command line.

Why only the sandbox renders, what the alternatives measured, timings, cost and isolation probes, and Mubit latency and caching, are in [`docs/LIVE_GENERATION.md`](../docs/LIVE_GENERATION.md).

## Rendering

`render-vercel-sandbox.ts` renders in [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) Firecracker microVMs and nowhere else. A render boots a VM from a snapshot (`persistent: false`, `networkPolicy: "deny-all"`, which also blocks DNS) that already holds the pinned Bun 1.4.4, the kit and the runner, writes the builds and a `batch.json` into it, runs `bun batch.ts`, reads one `results.json` back and stops the VM. Nothing is passed into the VM, and `batch.ts` passes a build nothing but `KIT_OUT`.

**Batch mode.** `renderBatchInSandbox(requests, { snapshotId, expectedBundleSha, vcpus, itemDeadlineMilliseconds })` renders many (code, name, pose) items in one VM and returns one result per item, in order. `render/batch.ts` starts one `bun runner.ts` process per item, one per vCPU at a time, and kills it at its own deadline (30 s by default), so a build that throws, hangs or crashes is that item's error and the rest still render; the processes do not share a kit, so one build cannot change what another draws. Items in a batch share a VM, so a batch holds builds of one trust domain (one creature's frames, or this repository's sprites). A single render (`renderSafely`, the loop's renderer) is a batch of one.

**Snapshot.** The manifest in the snapshot (`SNAPSHOT.json`) names the bundle digest (kit + runner files) and the Bun version; a render reads it first and throws `SnapshotMismatchError` when it differs from the caller's, with the command that rebuilds it. `bun run sandbox:snapshot` builds the snapshot and proves it renders `lamp-lit` byte for byte. The live creature route uses the same code from a deployed function: `docs/LIVE_GENERATION.md`, "The route".

**Authentication** is the SDK's; see `docs/tooling.md`, "Rendering needs Vercel auth".

## Building kit

The kit is the renderer plus every builder the model may call. It lives in `kit/`:

| File                   | Purpose                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/kit_core.ts`      | vector maths, `PALETTE`/`MATS` (29 materials, also in `palette.json`), light/view constants, signed-distance shapes `S`, `Frame`                                                                    |
| `src/kit_render.ts`    | `Kit` class (`k`), z-buffer renderer, outline/shadow, `post()` QA flags, image helpers (`text`, `blank`, `blit`, `onBg`, `montage`)                                                                 |
| `src/kit_build.ts`     | `pose()`, `POSE_NAMES`, `humanoidCore`, `winged`                                                                                                                                                    |
| `src/kit_anat.ts`      | `spartan`, `cyclops`, `minotaur`, `satyr`, `harpy`                                                                                                                                                  |
| `src/kit_beasts.ts`    | `quadruped`, `centaur`                                                                                                                                                                              |
| `src/kit_props.ts`     | `column`, `amphora`, `brazier`, `altar`, `statueBase`                                                                                                                                               |
| `src/kit_buildings.ts` | `temple`, `house`, `lampstand`, `wall`, `stall`, plus their internal helpers (local building frame, uniform scale-to-fit, ashlar masonry texture, tiled gable roof)                                 |
| `src/kit_figures.ts`   | `humanoid`, `tree`, `hydra`                                                                                                                                                                         |
| `src/kit_themes.ts`    | `THEMES`/`theme()`, `hero`, `ship`                                                                                                                                                                  |
| `../assemble-kit.ts`   | `bun run kit`: concatenates the 9 modules into `kit.ts` (rewrites `** 2` to `sq(...)`, asserts no `**`, `==`, `!=` remain). Re-running it reproduces the committed `kit.ts` exactly                 |
| `kit.ts`               | the assembled single file the renderers import                                                                                                                                                      |
| `exports.json`         | the names destructured into model code                                                                                                                                                              |
| `palette.json`         | material ramps (identical to the kit's `PALETTE`; checked)                                                                                                                                          |
| `examples/`            | `ex_column.ts`, `ex_hoplite.ts` (ported); `ex_temple.ts`, `ex_house.ts`, `ex_lamp_lit.ts`, `ex_lamp_unlit.ts`, `ex_wall.ts`, `ex_stall.ts` (hand-written calls to the building builders, see below) |

A build script is `export function build(k) { ... }`. Space is u/v ground, z up, origin `[0,0]` at the tile centre; sprites are 128×128 and auto-scaled to fit. The builders, their parameters and the low-level `k.*` calls are documented for the model in `prompts/generator.md`, which is the one place they are described; `kit/exports.json` lists the names destructured into model code. Only `greek` exists in `THEMES` (`kit_themes.ts`).

The two lamps (`lamp-lit`, `lamp-unlit`) come from `kit/examples/ex_lamp_lit.ts` and `ex_lamp_unlit.ts`, and the hand-written fallbacks `temple-handwritten`, `house-handwritten`, `wall-handwritten` and `stall-handwritten` from `ex_temple.ts`, `ex_house.ts`, `ex_wall.ts` and `ex_stall.ts`; they were hand-written for this repo, are not Mubit output and were never scored by the verifier (their manifest rows say so). The scene draws the Mubit `temple`, `house`, `wall` and `stall` (rows with `source: "mubit"`, drawn with `--candidates 3`) and falls back to the hand-written sprite of a building whose Mubit PNG does not load. The model chose the same builder calls the hand-written files make, so those four render pixel for pixel like their fallbacks. The decorations `house-ochre`, `olive-young`, `broken-column`, `votive-altar` and `amphora-stack` are Mubit output too; the lamps stay as they are because their lantern position drives the lighting (`src/scene/light.ts`).

## Tests

`bun test` covers the pipeline's behaviour without any network: `mubit.test.ts` pins the request Mubit receives (URL, headers, body keys, model, no temperature, prompt caching on and off, cache token logging, retries, no key in the log), `sprite-loop.test.ts` drives the command line's loop with a fake model and a fake renderer (max tokens per task, the borderline double verification, the fix turn's messages, best-of, banned code never reaching a renderer, the manifest's keys and order), `loop.test.ts` the same loop with an injected store (stages reported, no file touched) and the sandbox snapshot check, `render-batch.test.ts` the in-VM batch driver (a good build, a throw and a hang each get their own result, a build sees no environment), and `creature-brief.test.ts` the brief writer (validation and rejection, the request it sends, repeats refused). `src/server/creatures/*.test.ts` covers the job, the routes' service and the rate limits. `bun run check:pixels` is the renderer-side check.
