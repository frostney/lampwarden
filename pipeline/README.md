# Asset pipeline

Turns a one-line brief into a pixel-art sprite by looping a generator, a renderer and a verifier, all driven through Mubit.

```
brief ──► generator (Opus via Mubit) ──► build(k) code ──► render ──► verifier (Opus via Mubit, sees the image)
                                                                         │ score < 7 or engine flag
                                                                         ▼
                                              one fix call (same session, gets verifier issues + fix)
                                                                         │
                                              best-of(first, fixed) ──► public/sprites/<id>.png + .ts + manifest.json
```

## The loop (what `run.py` does)

1. **Generate.** The system prompt is `prompts/generator.md` (the kit API doc); the user message is `Brief: <your brief>`. The model returns one function `build(k)` that calls the kit builders (see "Building kit" in the top-level README).
2. **Render.** The code is run against the kit (`kit/kit.ts`) by a renderer (`--render local`, `--render vercel` or `--render shotcup`) and produces a 128×128 PNG plus stats. Deterministic engine checks (`clipped_at_edge`, `too_small`, `too_big`, `too_short`) score 0 and skip the verifier.
3. **Verify.** `prompts/verifier.md` is the system prompt; the model gets the brief, the code, the render stats and the sprite magnified 4× on a flat backdrop, and returns JSON `{pass, score, issues, fix, lesson}`. `pass` means score ≥ 7. A score between 6 and 7 is verified twice and averaged.
4. **Fix.** If not passed, one fix call goes back to the generator (same Mubit session) with the verifier's issues and fix text. The fixed code is rendered and verified the same way.
5. **Best-of.** The higher-scoring attempt is kept (ties go to the first attempt). Its PNG, builder code and manifest row (brief, score, issues, request ids) are written to `public/sprites/`.

Details: max tokens are 1500 for generation (one retry at 4000 on truncation), 3000 for the fix and 1800 for the verifier; one retry on 429/5xx/timeout; no `temperature` is sent. Model code that mentions `import`, `require`, `process`, `Bun`, `fetch`, `eval`, `Function`, `globalThis`, `XMLHttpRequest` or `Deno` is rejected before it runs. That regex is a tripwire, not a sandbox (string-built names get past it), so the generated code is rendered in a subprocess whose environment is an allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`, `KIT_OUT`; see `local_render.py`): no API key or other secret from your shell reaches it. It still runs with your user's file and network access; use the Vercel Sandbox or Shotcup renderer when that matters.

### Mubit

Calls go to `https://api.mubit.ai/anthropic/v1/messages` (Anthropic pass-through) with model `claude-opus-5-5`, `x-api-key` from the `MUBIT_API_KEY` environment variable, `anthropic-version: 2023-06-01`. Each call's request id (`x-middleware-request-id` response header), session (`metadata.user_id`), status, token counts and verdict are appended to `pipeline/runs/run.jsonl` (git-ignored; no key or headers are stored).

### The Good/Bad button is not the improvement loop

The Good/Bad button in the Mubit console rates a model output. It is feedback on a single response. The improvement loop in this pipeline is the **verifier**: it looks at the rendered image, scores it, and its issues are fed back into the fix call. Console ratings are not read by this code and do not change what it generates.

## Running it

```bash
cp .env.example .env            # optional; or just export the variable
export MUBIT_API_KEY=...         # read from the environment only; never printed or written to disk
python3 pipeline/run.py "Ionic marble column"            # writes public/sprites/ionic-marble-column.*
python3 pipeline/run.py --file briefs.json               # {"id": ["category", "brief"], ...}
python3 pipeline/run.py --render vercel "brief"          # render in a Vercel Sandbox microVM instead of local bun
python3 pipeline/run.py --render shotcup "brief"         # render on Shotcup instead of local bun
bun run assets -- "brief"                                # same as run.py, via bun
```

Options: `--out DIR` (default `public/sprites`), `--pose NAME` (hero-style poses such as `walk3`), `--file briefs.json`, `--render local|vercel|shotcup`.

Requirements for the local renderer: `python3` with Pillow, and [`bun`](https://bun.sh) on PATH. The manifest rows and PNGs are overwritten per id; commit the ones you want to keep.

Other scripts: `hero_frames.py` regenerates the 40 plain hero animation frames in `public/sprites/hero/` from deterministic builder code (no Mubit call; `--render local|shotcup`). Running it locally reproduces the committed frames byte-for-pixel (checked: 40/40 identical). `bun run kit` rebuilds `kit/kit.ts` from `kit/src/*.ts`.

## Layout

| Path                                                                                                     | What                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `run.py`                                                                                                 | the loop above                                                                            |
| `prompts/generator.md`, `prompts/verifier.md`                                                            | the two system prompts                                                                    |
| `kit/src/*.ts`, `kit/assemble.sh`, `kit/kit.ts`, `kit/exports.json`, `kit/palette.json`, `kit/examples/` | the building kit (see top-level README)                                                   |
| `render/run_local.ts`, `render/shim_canvas.ts`, `render/shim_plugin.ts`                                  | local bun renderer; the shim maps the kit's `shotcup:canvas` import to a small PNG canvas |
| `vercel_sandbox_render.ts`                                                                               | Vercel Sandbox renderer (below)                                                           |
| `shotcup_main.py`, `shotcup_render.py`                                                                   | Shotcup renderer (below)                                                                  |
| `hero_frames.py`                                                                                         | hero animation frames                                                                     |

## `--render vercel`

`vercel_sandbox_render.ts` runs each build in its own [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) Firecracker microVM: it creates the VM (default image, which ships bun; 1 vCPU; `networkPolicy: "deny-all"`; `persistent: false`), uploads `kit/kit.ts`, `render/run_local.ts` and the shims plus the build, runs the same `bun run_local.ts` as the local renderer with a 30 s limit, reads the PNGs back and stops the VM. `run.py` calls it as `bun --no-env-file pipeline/vercel_sandbox_render.ts <build.ts> <name> <out_dir> [pose]` with only `PATH`, `HOME`, `TMPDIR`, `LANG` and `VERCEL_*` in its environment; nothing is passed into the VM except `KIT_OUT`.

Authentication: run `vercel link` once (the SDK then refreshes an OIDC token from your Vercel CLI login), or export `VERCEL_OIDC_TOKEN` from `vercel env pull`, or `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`. Needs `bun install` (for `@vercel/sandbox`).

Measured on 24 Oct 2026 (Pro plan, `iad1`, from the UK): 1.4-2.4 s per candidate until the PNG is in hand and 2.6-4.1 s including `stop()`, against 10-107 s on Shotcup; five candidates in parallel took 3.9-4.3 s; 90 renders were pixel- and byte-identical to the committed sprites; the build code had no network (DNS, IP and metadata blocked) and no secrets, but is root inside its own VM, which is why every candidate gets a fresh one. About $0.0008 per candidate at list prices. Details: [`docs/LIVE_GENERATION.md`](../docs/LIVE_GENERATION.md).

## `--render shotcup`

[Shotcup](https://shotcup.dev) runs the same kit in a sandboxed engine with its own canvas module (`shotcup:canvas`), deterministically. The kit is put on a Shotcup **drive** called `lampwarden` and mounted read-only at `/kit`, so each run only carries a short generated `/main.ts` that imports `/kit/kit.ts` and calls your `build(k)`.

Run body: `{"code": <main.ts>, "engine": {"canvas": true}, "mounts": [{"drive": "lampwarden", "path": "/kit", "mode": "ro"}], "deterministic": true}`; PNGs come back as `/out/*.png` artifacts.

`shotcup_render.py` implements this over the REST API (`POST /api/v1/drives`, `PUT /api/v1/drives/lampwarden/files`, `POST /api/v1/runs`, `Authorization: Bearer`) and needs `SHOTCUP_API_KEY`. `python3 pipeline/shotcup_main.py build.ts > main.ts` and `--hero male walk` print the generated main for inspection.

### What was measured (24 Oct 2026, Scale plan, kit sha256 `cf66f505c9e9…`)

- **The REST client works against the live API.** The drive endpoints, the auth header and the run response shape were as the client expected. Two fixes came out of the first runs: `timeoutMs` 600000 was above the plan's 300 s ceiling and got clamped with a warning (now 300000), and when all workers were taken the run failed as `daemon-error` "the runtime is busy; retry shortly" after about 30 s, which `run.py` would have scored as broken code. That failure is now retried (checked: a busy first attempt, then success on the retry).
- **Pixel-identical to local.** 47 Shotcup renders of 6 sprites (temple, house, lamp-lit, olive, satyr, hero-male-still) decode to exactly the local bun pixels. The PNG bytes differ because the encoders compress differently.
- **Much slower than local.** Three repetitions each, client wall clock per single-sprite run (local bun subprocess in brackets): temple 106.5-106.9 s (337-344 ms), house 25.1-25.5 s (112-114 ms), lamp-lit 10.1-10.3 s (84-87 ms), olive 52.1-52.4 s (190-273 ms), satyr 21.4-21.5 s (141-143 ms), hero-male-still 19.7-19.9 s (139-141 ms). That is 118-314x local. Engine time (`metrics.engineMs`) is within 0.8 s of wall clock, and repetitions vary by under 2%.
- **Batching doesn't help.** All six in one run took 231.4-234.9 s, the same as the six single runs together (235.3 s). Starting six single runs at once was worse: the runtime had 4 workers, only 3 runs were admitted each time, the others failed busy, and the admitted runs slowed down 1.6-3x.
- **The time is the rasteriser.** Kit import is 0.26 s; for lamp-lit, `k.render()` is 9.2 s of 10.1 s. No run option changed the time (deterministic off, large memory, no retention, kit inline instead of a drive, pre-transpiled or minified kit, a saved sandbox, the `run.shotcup.dev` endpoint): all within 10.0-10.6 s for lamp-lit.
- **Sandbox:** model code saw no environment (`process` undefined), no `Function`/`eval`, a virtual filesystem holding only `/kit` (read-only) and `/main.ts`, and no network (`fetch` throws `PermissionDenied`). An endless loop ended at its `timeoutMs`. Inside a batch, one build can overwrite another's PNG, so live generation should render one candidate per run.

Details, the full tables and a design for live generation behind a server route: [`docs/LIVE_GENERATION.md`](../docs/LIVE_GENERATION.md). Plan on the local renderer for iteration. Use Vercel Sandbox (or Shotcup) when model code must not run on your machine or server.

Not done: a Mubit-driven `run.py --render shotcup` end to end, and Shotcup's wake time after idle.
