# Live sprite generation

How the asset loop (brief → generator → render → verifier → fix → best-of) could run as a server route, with model-written `build(k)` code executed only on [Shotcup](https://shotcup.dev). This is a design note: no route exists yet. The numbers are from runs on 24 Oct 2026 against shotcup.dev with this repo's `pipeline/shotcup_render.py`, a Scale-plan account and the kit at sha256 `cf66f505c9e9…` (212,457 bytes), timed from a client in the UK. No Mubit call was made for this note, so model latency is not measured here.

## Why Shotcup and not the server

Locally, `local_render.py` runs model code in bun with your user's file and network access; only the environment is allowlisted. A Vercel function would be worse: the generated code would run in the same process family as the route that holds `MUBIT_API_KEY` and `SHOTCUP_API_KEY`. On Shotcup the code runs in a fresh GocciaScript engine per run with a virtual filesystem, and the probes below found nothing for it to reach.

## The route

```
POST /api/sprites {brief}                       (Next.js route handler, Node.js runtime, auth + rate limit)
  └─ start a durable job, answer {jobId}         (generation takes minutes: see latencies)
job:
  1. generator   Mubit → Opus, system prompt pipeline/prompts/generator.md            → build(k) source (text only)
  2. tripwire    BANNED_IDENTIFIERS regex + "function build" check (cheap pre-filter, not a sandbox)
  3. render      POST https://shotcup.dev/api/v1/runs, one candidate per run:
                 {code: main.ts, engine:{canvas:true}, mounts:[{drive:"lampwarden", path:"/kit", mode:"ro"}],
                  deterministic:true, timeoutMs:<budget>}, no allowedHosts          → PNG (inlineBase64) + stats (last stdout line)
  4. engine flags  clipped/too_small/too_big/too_short → score 0, skip the verifier
  5. verifier    Mubit → Opus with the 4x PNG                                       → {pass, score, issues, fix}
  6. fix         one follow-up generator call with the verifier's issues → steps 2-5 again
  7. best-of     keep the higher score; store PNG + code + manifest row (Blob or similar, not the deployment's filesystem)
GET /api/sprites/:jobId → status / result
```

The route and the job only move text and PNG bytes between Mubit and Shotcup; they never `eval`, transpile or import model output. `shotcup_main.main_source` (wrap the code, destructure the kit exports, call `post()`, save `/out/<name>.png`) is the part to port to TypeScript; `run.py` already has the rest of the loop.

Because one sprite takes from tens of seconds to several minutes of render alone (below), the job should not live inside one request. On Vercel's documented limits (not tested here), a function runs 300 s by default on every plan and up to 800 s on Pro, so a temple-sized sprite with one fix (about 215 s of render plus the model calls) leaves little headroom. A durable runner (Vercel Workflow, or a queue consumer) with one step per model call or render keeps each step short and survives restarts; the client polls or streams progress.

Rules that follow from the measurements:

- **One candidate per Shotcup run.** In a batch, every candidate's code shares one module scope: a probe build overwrote another candidate's `/out/victim.png` and pushed a forged stats row, and the run still succeeded. Batching also bought nothing (below).
- **Don't fan out.** The runtime had 4 workers. Runs beyond that queued for 30 s and then failed (`failureKind: "daemon-error"`, "the runtime is busy; retry shortly"), and runs admitted together slowed each other down 1.6-3x. Best-of-N therefore costs about N times one render, wherever the requests start. `shotcup_render.py` now retries the busy failure (up to 2 retries) instead of scoring it as broken code.
- **Set a render budget.** `timeoutMs` above the plan ceiling (Scale: 300 s) is clamped with a `timeout-clamped` warning. A timeout ends the run cleanly (`failureKind: "timeout"`). Pick a budget per sprite: a temple needs about 107 s, so a 60 s budget would reject sprites the kit makes on purpose.
- **Never send `allowedHosts`** on render runs. Without it, `fetch` throws `PermissionDenied`.
- **Seed the drive at deploy time,** not per request. Writing the kit takes 0.43-0.65 s. An unchanged write makes no new version (`created: false`). Pinning the mount to that version id would stop a later kit write from changing a running job's renders. Not implemented or tested.
- **Keys.** `MUBIT_API_KEY` and `SHOTCUP_API_KEY` would become server-side environment variables of the deployment (today the README says the deployment has none and needs none: that changes with this route). Model output never runs where they live.
- **Artifact links are public capability URLs by default** (`artifactAccess: "public"`, kept for the plan's retention). The client reads `inlineBase64`, so the links aren't needed: send `retention: "none"` (tested, no speed effect) or `artifacts: "private"` (documented for MCP, not tried over REST).

## Measured latencies

Six existing sprite scripts from `public/sprites/`, three repetitions each. Shotcup "client wall" is the client's own time for `run_batch` (request to PNG on disk); "engine" is `run.metrics.engineMs`. Local is `pipeline/local_render.render_file` (bun subprocess, process start included).

| sprite | local bun, wall ms | Shotcup, client wall s | Shotcup, engine s | engine instructions | Shotcup / local |
|---|---|---|---|---|---|
| temple | 344 / 339 / 337 | 106.9 / 106.5 / 106.5 | 106.7 / 106.1 / 106.4 | 1.58 G | ~314x |
| house | 112 / 114 / 114 | 25.1 / 25.2 / 25.5 | 24.8 / 24.8 / 24.7 | 0.35 G | ~221x |
| lamp-lit | 87 / 84 / 86 | 10.1 / 10.1 / 10.3 | 10.0 / 10.0 / 10.1 | 0.14 G | ~118x |
| olive | 242 / 273 / 190 | 52.2 / 52.1 / 52.4 | 52.0 / 51.9 / 52.2 | 0.73 G | ~216x |
| satyr | 141 / 143 / 143 | 21.5 / 21.4 / 21.5 | 21.3 / 21.2 / 21.4 | 0.31 G | ~150x |
| hero-male-still | 140 / 141 / 139 | 19.9 / 19.9 / 19.7 | 19.7 / 19.7 / 19.5 | 0.29 G | ~142x |
| **all six** | 1.06 s (sum of medians) | 235.3 s (sum of medians) | | 3.39 G | |

- **Batch of six in one run:** 234.8 / 234.9 / 231.4 s client wall (engine 234.6 / 234.8 / 231.0 s), the same as six single runs. Close to the 300 s ceiling: seven temples would not fit.
- **Six single runs started at once:** in every repetition 3 ran and 3 failed busy after about 30 s. The three that ran took 1.6-3x their single time (temple 184-188 s, olive 85-133 s, lamp-lit 31 s). Wall clock for the three: 188 / 184 / 85 s.
- **Fixed costs:** a `console.log(1)` run took 0.35 s client wall (0.22 s server; 1 sample). Importing the kit from the drive: 0.26 s engine (3 reps: 263 / 262 / 257 ms), 0.41-0.99 s client wall. Seeding the drive (create + write 212 KB): 645 / 425 / 437 ms, once per process.
- **Where the time goes** (lamp-lit, `deterministic: false` so `performance.now()` works, 1 sample): import 0.27 s, `build()` 2 ms, `k.render()` 9.18 s, `post()` 0.63 s, PNG 1 ms. The rasteriser is the cost. The engine runs bytecode at about 14 M instructions/s (`metrics.mode: "bytecode"`), against bun's JIT. Locally every sprite does at least two full rasterisation passes (an auto-scale probe pass and the final pass); the temple does four because of edge-fit retries.
- **Cold vs warm:** each run gets a fresh engine, and the timings were flat from the first run of the session to the last (lamp-lit 10.1-10.4 s throughout, `workerRuns` rising from 10). The cold costs I could see are the per-process drive seed above and Shotcup's documented 0.7-2.3 s wake after the sandboxes go idle. I did not reproduce that wake (see below).

### Speed-ups tried (lamp-lit, 3 reps each, engine s)

| variant | engine s | effect |
|---|---|---|
| baseline (drive mount, `kit.ts`) | 10.20 / 9.98 / 10.02 | |
| `deterministic: false` | 10.03 / 10.15 / 9.99 | none |
| `memory: "large"` (1 GiB heap) | 10.08 / 10.07 / 10.01 | none (and it bills 4x compute) |
| `retention: "none"` | 10.07 / 10.16 / 10.06 | none |
| kit sent inline in `files` instead of a drive mount | 10.11 / 10.19 / 10.05 | none |
| kit pre-transpiled to JS by `bun build` (191 KB) | 10.44 / 10.56 / 10.42 | 3-4% slower |
| kit minified (116 KB) | 10.24 / 10.31 / 10.33 | ~2% slower; import 0.25 s vs 0.26 s |
| saved sandbox with the drive mounted, `POST /sandboxes/:id/run` | 10.14 / 10.00 / 10.04 | none |
| run endpoint `run.shotcup.dev` | mounts refused (`501 direct-unsupported`); kit inline: 10.18 / 10.13 / 10.18 | none |
| six sprites batched into one run | 234.6 s vs 235.3 s as singles | none |
| six single runs in parallel | see above | worse: busy failures and slowdown |

Nothing Shotcup exposes changes the render time, because the time is interpreted render work, and every variant ran about the same instruction count (139.05-139.50 M). The levers left are in the kit (fewer or cheaper rasterisation passes: skip the separate auto-scale probe when it doesn't change the scale, cap the edge-fit retries, cheaper SDF evaluation), and none of them has been tried. Any kit change has to be re-checked for pixel identity against the committed sprites.

## Pixel identity

Every Shotcup PNG from these runs (47 renders: 18 single, 18 batched, 9 from the parallel runs that succeeded, 1 first run, 1 after a busy retry) decodes to exactly the same RGBA pixels as the local bun render (Pillow, all 128×128 pixels compared, 0 differing). The PNG bytes differ, because the encoders compress differently. Shotcup's own bytes were identical across repetitions, and the local renders match the committed `public/sprites/*.png` byte for byte.

## Sandbox probes

All harmless, run with the same body the client sends (canvas engine, kit drive mounted read-only, deterministic):

| question | result |
|---|---|
| Environment variables | `process`, `Deno`, `Bun` and `require` are undefined. The globals are standard JS plus `fetch`, `Goccia` (version info and `gc`), `PermissionDenied`, `performance`, `URL`, text codecs and streams. There is nothing to read an env from. |
| Dynamic code | `new Function(...)` and `[].constructor.constructor('return this')()` throw "Dynamic code generation is disabled"; `eval` is not defined. A string-built bypass of the BANNED_IDENTIFIERS regex inside real build code (`[].constructor.constructor('return this')()['pro'+'cess']`) failed at the Function constructor, with `failureKind: "script-error"`. |
| Files outside /kit | The filesystem is virtual: `/` holds only `kit` and `main.ts`. `/etc/passwd`, `/proc/self/environ`, `/home` and `/tmp` don't exist (ENOENT), and `/kit/../..` resolves to the same root. Writing under `/kit` fails with `EROFS`. |
| Network | `fetch('https://example.com/')` throws `PermissionDenied: net: example.com` when the run has no `allowedHosts`. |
| Infinite loop | `while (true) {}` with `timeoutMs: 5000` ended at 5.0 s as `status: failed`, `failureKind: "timeout"`. The full time counts against compute-hours. |
| Memory | Growing arrays ended at about 423 MiB resident with `failureKind: "resource-limit"` (the plan's `maxResidentBytes`). |
| Determinism | `Date.now()` and `performance.now()` return 0. `Math.random()` is seeded: two runs both returned 0.8833108082136426. |
| Other candidates in a batch | Not isolated: a build can call the wrapper's `createCanvas` to overwrite another candidate's PNG and can push rows into `res`. Hence one candidate per run. |

Build code can't `import fs` (the tripwire rejects `import`, and `main.ts` doesn't import it). Even with it, the filesystem holds only the kit and `main.ts`.

## Not verified

- A full live round trip (Mubit generator → Shotcup → Mubit verifier → fix) from a server route, or `run.py --render shotcup` end to end: no Mubit call was made. Model latency per call is unknown here.
- Shotcup's wake after idle (0.7-2.3 s on its performance page) was not reproduced: the account had other runs that day, so I couldn't tell when the sandboxes were idle.
- Whether the 4-worker limit is per account, per region or global, and whether a Platform plan or tenant keys raise it. The account's `/me` says `maxConcurrent: 50`, but the runtime refused a fifth concurrent run.
- `artifacts: "private"` over REST, and pinning a drive version in `mounts`.
- Vercel duration limits are quoted from Vercel's documentation, not tested; no route was deployed.
- Running the render in a Vercel Sandbox microVM with bun (JIT, near the local 0.1-0.3 s per render, plus VM start) is an alternative to compare. It was not measured.
- Kit-side speed-ups (fewer rasterisation passes): not tried.
