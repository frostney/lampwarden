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

1. **Generate.** The system prompt is `prompts/generator.md` (the kit API doc); the user message is `Brief: <your brief>`. The model returns one function `build(k)` that calls the kit builders (see "Building kit" in the top-level README).
2. **Render.** The code is run against the kit (`kit/kit.ts`) by a renderer (`--render local|shotcup|vercel|boat`) and produces a 128×128 PNG plus stats. Deterministic engine checks (`clipped_at_edge`, `too_small`, `too_big`, `too_short`) score 0 and skip the verifier.
3. **Verify.** `prompts/verifier.md` is the system prompt; the model gets the brief, the code, the render stats and the sprite magnified 4× on a flat backdrop, and returns JSON `{pass, score, issues, fix, lesson}`. `pass` means score ≥ 7. A score between 6 and 7 is verified twice and averaged.
4. **Fix.** If not passed, one fix call goes back to the generator (same Mubit session) with the verifier's issues and fix text. The fixed code is rendered and verified the same way.
5. **Best-of.** The higher-scoring attempt is kept (ties go to the first attempt). Its PNG, builder code and manifest row (brief, score, issues, request ids) are written to `public/sprites/`.

Details: max tokens are 1500 for generation (one retry at 4000 on truncation), 3000 for the fix and 1800 for the verifier; one retry on 429/5xx/timeout; no `temperature` is sent. Model code that mentions `import`, `require`, `process`, `Bun`, `fetch`, `eval`, `Function`, `globalThis`, `XMLHttpRequest` or `Deno` is rejected before it runs (`build-code.ts`). That regex is a tripwire, not a sandbox (string-built names get past it), so the generated code only ever runs through a renderer: in a subprocess whose environment is an allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`, `KIT_OUT`; see `render-local.ts`), where no API key or other secret from your shell reaches it, or in a sandbox. The local renderer still runs with your user's file and network access; use a sandboxed renderer when that matters.

### Mubit

Calls go to `https://api.mubit.ai/anthropic/v1/messages` (Anthropic pass-through) with model `claude-opus-5-5`, `x-api-key` from the `MUBIT_API_KEY` environment variable, `anthropic-version: 2023-06-01` (`mubit.ts`). Each call's request id (`x-middleware-request-id` response header), session (`metadata.user_id`), status, token counts and verdict are appended to `pipeline/runs/run.jsonl` (git-ignored; no key or headers are stored).

### Prompt caching

Both system prompts are sent as one text block marked `cache_control: {"type": "ephemeral"}` (5 minute TTL), so the generator's `prompts/generator.md` (about 5.4k tokens) and the verifier's prompt are written to the cache once and read back by the calls that follow within five minutes. `claude-opus-5-5` caches prefixes of at least 512 tokens and bills a read at 0.05x the input price (a write at 1.25x). The breakpoint sits on the system block only: the messages after it (the brief, the code, the image) differ per call, so a marker there would only add write cost. Each log row records `cache_creation_input_tokens` and `cache_read_input_tokens` next to `in_tokens` and `out_tokens`.

Checked live on 24 Oct 2026: two generator calls in a row with `generator.md` as the system prompt. The first wrote 5,379 tokens to the cache (`cache_read_input_tokens` 0), the second read all 5,379 back, so Mubit passes `cache_control` through. Calls that start together (the first briefs of a run with `--concurrency 4`) all miss, since an entry exists only once the first response has begun; later calls hit. `--no-prompt-caching` sends `system` as a plain string, which is what the Python pipeline did.

### The Good/Bad button is not the improvement loop

The Good/Bad button in the Mubit console rates a model output. It is feedback on a single response. The improvement loop in this pipeline is the **verifier**: it looks at the rendered image, scores it, and its issues are fed back into the fix call. Console ratings are not read by this code and do not change what it generates.

## Running it

```bash
cp .env.example .env            # optional; or just export the variable
export MUBIT_API_KEY=...         # read from the environment only; never printed or written to disk
bun run assets -- "Ionic marble column"            # writes public/sprites/ionic-marble-column.*
bun run assets -- --file briefs.json               # {"id": ["category", "brief"], ...}
bun run assets -- --render vercel "brief"          # render in a Vercel Sandbox microVM instead of local bun
bun run assets -- --render boat "brief"            # render in a boat.dev sandbox
bun run assets -- --render shotcup "brief"         # render on Shotcup
```

`bun run assets` is `bun --no-env-file pipeline/run.ts`: bun does not load `.env` files into the process, so a token that happens to sit in one never reaches the pipeline; export what a renderer needs.

Options: `--out DIR` (default `public/sprites`), `--pose NAME` (hero-style poses such as `walk3`), `--file briefs.json`, `--render local|shotcup|vercel|boat` (or `LAMPWARDEN_RENDERER`), `--no-prompt-caching`, `--concurrency N` (briefs in flight; default 4 local, 1 Shotcup, 4 Vercel Sandbox, 2 boat.dev). The manifest rows and PNGs are overwritten per id; commit the ones you want to keep.

Other scripts:
- `bun run render -- [--render NAME] build.ts name out_dir [pose]` renders one build script with any renderer and prints the stats.
- `bun run assets:hero -- [--render NAME] [--out DIR]` regenerates the 200 plain hero animation frames in `public/sprites/hero/` (per sex 20 frames, each from 5 directions: east, south-east, south, north-east and north; the warden's other three directions are those mirrored in the scene) from deterministic builder code (no Mubit call). The humanoid builder draws every facing, away from the camera included, so the kit's `facing` is the only thing that changes between directions (`kitFacing` in `hero-animation.ts`). With the local renderer it reproduces the committed frames byte for byte (`bun run check:pixels`: 0 differing pixels over all 218 sprites).
- `bun run check:pixels` renders every committed sprite and hero frame with the local renderer and compares the pixels with the committed PNGs.
- `bun run kit` rebuilds `kit/kit.ts` from `kit/src/*.ts`.
- `bun pipeline/shotcup-main-source.ts build.ts > main.ts` (or `--hero male walk`) prints the `/main.ts` a Shotcup run would carry.

## Layout

| Path                                                                                                     | What                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`                                                                                                 | the command line: briefs in, the loop per brief, at most `--concurrency` at once                                                                |
| `sprite-loop.ts`                                                                                         | the loop above for one brief; model, renderer and directories are injected so tests can fake them                                               |
| `mubit.ts`                                                                                               | the Mubit client: the only code that calls Mubit (and marks the system prompt cacheable)                                                        |
| `verifier-image.ts`                                                                                      | the 4× backdrop image the verifier sees                                                                                                         |
| `build-code.ts`                                                                                          | the banned-identifier tripwire and the `function build` check                                                                                   |
| `render-types.ts`                                                                                        | the contract: `RenderRequest` in, `RenderResult` (`RenderStats` + PNG bytes, or an error) out, for every renderer                               |
| `renderers.ts`                                                                                           | the renderers by name, loaded on first use, and their default concurrency                                                                       |
| `render-local.ts`, `render/run_local.ts`, `render/shim_canvas.ts`, `render/shim_plugin.ts`               | local bun renderer; the shim maps the kit's `shotcup:canvas` import to a small PNG canvas; the runner and shims are also what the sandboxes run |
| `render-shotcup.ts`, `shotcup-main-source.ts`                                                            | Shotcup renderer (below)                                                                                                                        |
| `render-vercel-sandbox.ts`                                                                               | Vercel Sandbox renderer (below)                                                                                                                 |
| `render-boat.ts`                                                                                         | boat.dev renderer (below)                                                                                                                       |
| `render-file.ts`, `hero-animation.ts`, `hero-frames.ts`, `check-pixels.ts`                               | render one file; the hero frame builds; regenerate them; the pixel-identity gate                                                                |
| `assemble-kit.ts`, `kit/src/*.ts`, `kit/kit.ts`, `kit/exports.json`, `kit/palette.json`, `kit/examples/` | the building kit (see top-level README)                                                                                                         |
| `prompts/generator.md`, `prompts/verifier.md`                                                            | the two system prompts                                                                                                                          |

Every renderer returns the same thing, so the loop does not care which one ran: a `RenderResult` is `{ ok: true, stats, png }` or `{ ok: false, error }`, and a renderer never throws. The stats line a runner prints is validated with Zod once, in `render-types.ts`. Build names and poses may only contain letters, digits, `_` and `-`, because they end up in file paths, generated Shotcup source and a boat shell command.

Timings, parallelism limits, cost and isolation probes for the three sandboxes, and Mubit latency and caching, are in [`docs/LIVE_GENERATION.md`](../docs/LIVE_GENERATION.md).

## `--render vercel`

`render-vercel-sandbox.ts` runs each build in its own [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) Firecracker microVM: it creates the VM (default image, which ships bun; 1 vCPU; `networkPolicy: "deny-all"`; `persistent: false`), uploads `kit/kit.ts`, `render/run_local.ts` and the shims plus the build, runs the same `bun run_local.ts` as the local renderer with a 30 s limit, reads the PNG back and stops the VM. Nothing is passed into the VM except `KIT_OUT`. The whole render has a 180 s deadline; set `VERCEL_SANDBOX_SNAPSHOT_ID` to boot from a snapshot that already holds the kit (`createRunnerSnapshot`).

Authentication: run `vercel link` once (the SDK then refreshes an OIDC token from your Vercel CLI login), or export `VERCEL_OIDC_TOKEN` from `vercel env pull`, or `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.

## `--render boat`

`render-boat.ts` renders a build in a [boat.dev](https://boat.dev) sandbox, a full Ubuntu VM with bun preinstalled. Per candidate it creates a `small` sandbox with `noEnv` (none of the account's secrets and no in-sandbox API key), no snapshots and a 10-minute auto-stop, uploads the kit, the runner, the shims and the build, runs one command and deletes the sandbox. boat has no network setting in its API, and its `user` account has passwordless sudo, so the command does the lock-down inside the VM: it creates a fresh account without sudo, rejects all of that account's outbound traffic with `iptables` and `ip6tables` owner rules (loopback included, so no DNS and none of the VM's local services), denies it cron and `at`, gives it a job directory only it can read, and runs `bun run_local.ts` as that account with only `PATH`, `HOME`, `LANG` and `KIT_OUT` in its environment and a 30 s `timeout -s KILL`. Afterwards it expires the account, kills its processes, removes its stray temporary files and reads the PNG back. `createRenderSandbox`, `renderInSandbox` and `deleteRenderSandbox` are exported for reusing one sandbox across candidates; every candidate still gets its own account.

Authentication: `BOAT_API_KEY`, a key with the `ci` preset (`boat api-key create lampwarden-render --preset ci --ttl 30d`; it can create, use and delete its own sandboxes). The SDK (`@boatdev/sdk`) does not read the boat CLI's login. The key never enters the sandbox.

## `--render shotcup`

[Shotcup](https://shotcup.dev) runs the same kit in a sandboxed engine with its own canvas module (`shotcup:canvas`), deterministically. The kit is put on a Shotcup **drive** called `lampwarden` and mounted read-only at `/kit`, so each run only carries a short generated `/main.ts` that imports `/kit/kit.ts` and calls your `build(k)`.

Run body: `{"code": <main.ts>, "engine": {"canvas": true}, "mounts": [{"drive": "lampwarden", "path": "/kit", "mode": "ro"}], "timeoutMs": 300000, "deterministic": true}`; PNGs come back as `/out/*.png` artifacts.

`render-shotcup.ts` implements this over the REST API (`POST /api/v1/drives`, `PUT /api/v1/drives/lampwarden/files`, `POST /api/v1/runs`, `Authorization: Bearer`) and needs `SHOTCUP_API_KEY`. It writes the drive once per process, keeps `timeoutMs` at the plan's 300 s ceiling (a larger value is clamped with a warning) and retries a "runtime is busy" refusal twice, which is not the build code's fault. `renderBatchOnShotcup` renders several builds in one run (used for the hero frames; live generation sends one candidate per run, since inside a batch one build can overwrite another's PNG).

### What was measured, and what was not

On 24 Oct 2026, on a Scale-plan account, the earlier Python client was run against the live API with kit sha256 `cf66f505c9e9…`:
- **Pixel-identical to local.** 47 Shotcup renders of 6 sprites (temple, house, lamp-lit, olive, satyr, hero-male-still) decode to exactly the local bun pixels. The PNG bytes differ because the encoders compress differently.
- **Much slower than local** on that older, slower kit. Client wall clock per single-sprite run: temple 106.5-106.9 s (337-344 ms locally), house 25.1-25.5 s, lamp-lit 10.1-10.3 s, olive 52.1-52.4 s, satyr 21.4-21.5 s, hero-male-still 19.7-19.9 s. The time is the rasteriser; kit import is 0.26 s. No run option changed it.
- **Batching doesn't help**, and the runtime admits about three runs at once (four workers): the rest fail as "runtime busy". Starting six single runs at once was worse than running them one after another.
- **Sandbox:** model code saw no environment (`process` undefined), no `Function`/`eval`, a virtual filesystem holding only `/kit` (read-only) and `/main.ts`, and no network. An endless loop ended at its `timeoutMs`.

The TypeScript client in this repository is a port of that Python client: the `/main.ts` it generates is byte-identical to what `shotcup_main.py` printed (checked for a hero animation and for two sprites with a pose), and the request and response handling follows the Python code line by line. It has **not** been run against the live API (no key was available); treat the first real run as a test. A Mubit-driven run through `--render shotcup` end to end has not been done.

## Tests

`bun test` covers the pipeline's behaviour without any network: `mubit.test.ts` pins the request Mubit receives (URL, headers, body keys, model, no temperature, prompt caching on and off, cache token logging, retries, no key in the log) and `sprite-loop.test.ts` drives the loop with a fake model and a fake renderer (max tokens per task, the borderline double verification, the fix turn's messages, best-of, banned code never reaching a renderer, the manifest's keys and order). `bun run check:pixels` is the renderer-side check.
