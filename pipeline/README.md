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
2. **Render.** The code is run against the kit (`kit/kit.ts`) by a renderer (`--render local` or `--render shotcup`) and produces a 128×128 PNG plus stats. Deterministic engine checks (`clipped_at_edge`, `too_small`, `too_big`, `too_short`) score 0 and skip the verifier.
3. **Verify.** `prompts/verifier.md` is the system prompt; the model gets the brief, the code, the render stats and the sprite magnified 4× on a flat backdrop, and returns JSON `{pass, score, issues, fix, lesson}`. `pass` means score ≥ 7. A score between 6 and 7 is verified twice and averaged.
4. **Fix.** If not passed, one fix call goes back to the generator (same Mubit session) with the verifier's issues and fix text. The fixed code is rendered and verified the same way.
5. **Best-of.** The higher-scoring attempt is kept (ties go to the first attempt). Its PNG, builder code and manifest row (brief, score, issues, request ids) are written to `public/sprites/`.

Details: max tokens are 1500 for generation (one retry at 4000 on truncation), 3000 for the fix and 1800 for the verifier; one retry on 429/5xx/timeout; no `temperature` is sent. Model code that mentions `import`, `require`, `process`, `Bun`, `fetch`, `eval`, `Function`, `globalThis`, `XMLHttpRequest` or `Deno` is rejected before it runs. That regex is a tripwire, not a sandbox (string-built names get past it), so the generated code is rendered in a subprocess whose environment is an allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`, `KIT_OUT`; see `local_render.py`): no API key or other secret from your shell reaches it. It still runs with your user's file and network access; use the Shotcup renderer when that matters.

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
python3 pipeline/run.py --render shotcup "brief"         # render on Shotcup instead of local bun
npm run assets -- "brief"                                # same as run.py, via npm
```

Options: `--out DIR` (default `public/sprites`), `--pose NAME` (hero-style poses such as `walk3`), `--file briefs.json`, `--render local|shotcup`.

Requirements for the local renderer: `python3` with Pillow, and [`bun`](https://bun.sh) on PATH. The manifest rows and PNGs are overwritten per id; commit the ones you want to keep.

Other scripts: `hero_frames.py` regenerates the 40 plain hero animation frames in `public/sprites/hero/` from deterministic builder code (no Mubit call; `--render local|shotcup`). Running it locally reproduces the committed frames byte-for-pixel (checked: 40/40 identical). `npm run kit` rebuilds `kit/kit.ts` from `kit/src/*.ts`.

## Layout

| Path | What |
|---|---|
| `run.py` | the loop above |
| `prompts/generator.md`, `prompts/verifier.md` | the two system prompts |
| `kit/src/*.ts`, `kit/assemble.sh`, `kit/kit.ts`, `kit/exports.json`, `kit/palette.json`, `kit/examples/` | the building kit (see top-level README) |
| `render/run_local.ts`, `render/shim_canvas.ts`, `render/shim_plugin.ts` | local bun renderer; the shim maps the kit's `shotcup:canvas` import to a small PNG canvas |
| `shotcup_main.py`, `shotcup_render.py` | Shotcup renderer (below) |
| `hero_frames.py` | hero animation frames |

## `--render shotcup`

[Shotcup](https://shotcup.dev) runs the same kit in a sandboxed engine with its own canvas module (`shotcup:canvas`), deterministically. The kit is put on a Shotcup **drive** called `lampwarden` and mounted read-only at `/kit`, so each run only carries a short generated `/main.ts` that imports `/kit/kit.ts` and calls your `build(k)`.

Run body: `{"code": <main.ts>, "engine": {"canvas": true}, "mounts": [{"drive": "lampwarden", "path": "/kit", "mode": "ro"}], "deterministic": true}`; PNGs come back as `/out/*.png` artifacts.

`shotcup_render.py` implements this over the REST API (`POST /api/v1/drives`, `PUT /api/v1/drives/lampwarden/files`, `POST /api/v1/runs`) and needs `SHOTCUP_API_KEY`. `python3 pipeline/shotcup_main.py build.ts > main.ts` and `--hero male walk` print the generated main for inspection.

### What was actually run, and what was not

- The same run body was executed 11 times through the Shotcup **MCP** server (not through `shotcup_render.py`): hero frames and key sprites. All 11 outputs were pixel-identical to the local bun renderer.
- **`shotcup_render.py` itself has not been executed against the API** (no API key on the box at the time). It compiles, and the no-key path returns a clean error to the loop (checked). Treat the first real run as a test.
- **Shotcup was slower than local, not faster, for this workload.** Local bun renders a sprite in about 0.4 s including process start. On Shotcup, per-run engine time was about 18 s per hero frame (unscaled 128 px frames) and about 41–61 s per auto-scaled sprite (roughly 0.1–0.9 G engine instructions each). Batching several sprites into one run did not amortise anything meaningful, because the cost is render compute, not setup.
- **Shrinking the kit would not help.** Loading `/kit/kit.ts` (164 KB, 53 exports) took about 0.23 s in the engine; the time is in the rasteriser.
- So the value of `--render shotcup` here is sandboxed, deterministic remote execution of model-written code (no local bun, nothing runs on your machine), not speed. Plan on the local renderer for iteration.
- A Mubit-driven run through `run.py --render shotcup` end to end has not been done.

The timings above are the ranges noted while the runs were done (hero walk/idle frames, olive, satyr, trireme, zeus-statue); no exact per-sprite table was kept, so don't quote them as benchmarks.
