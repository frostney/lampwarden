# Live sprite generation

How the asset loop (brief → generator → render → verifier → fix → best-of) could run as a server route, with model-written `build(k)` code executed only in a sandbox. This is a design note: no route exists yet. Two sandboxes were measured on 24 Oct 2026, both with the kit at sha256 `cf66f505c9e9…` (212,457 bytes) and timed from a client in the UK: [Shotcup](https://shotcup.dev) (a Scale-plan account, `pipeline/shotcup_render.py`) and [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) (the team's Pro plan, `pipeline/vercel_sandbox_render.ts`). [boat.dev](https://boat.dev) was researched from its documentation, not measured. No Mubit call was made for this note, so model latency is not measured here.

## Comparison and recommendation

| | Shotcup (measured) | Vercel Sandbox (measured) | boat.dev (documentation only) |
|---|---|---|---|
| What runs the build | GocciaScript bytecode VM, interpreted (about 14 M instructions/s) | bun 1.4.4 (JIT) in a Firecracker microVM, `vercel/sandbox/universal` image | Any Linux tool in a full Ubuntu 24.04 VM; bun is preinstalled, so JIT |
| One render, lamp-lit / temple | 10.1-10.3 s / 106.5-106.9 s | fresh VM, PNG in hand: 1.4-2.0 s / 2.1-2.4 s; with `stop()`: 2.6-3.4 s / 3.3-4.1 s; warm VM: 0.7-1.1 s / 1.1-1.4 s | not measured |
| All five measured sprites (lamp-lit, house, temple, satyr, olive) | about 215 s in series | 3.9-4.3 s wall, five fresh VMs in parallel | not measured |
| Start | none per run (0.35 s for an empty run); 0.43-0.65 s drive seed per process | create 0.22-0.36 s, first command 0.16-0.22 s, kit + runner upload 0.21-0.52 s; from a snapshot 1.0-2.0 s (slower) | "usually less than one second" from a pool of ready machines |
| Parallel candidates | 4 workers; a fifth run failed busy, admitted runs slowed 1.6-3x | 5 at once ran no slower than one at a time; documented Pro limit 10,000 concurrent, 150 vCPUs/min allocation to start | $20 plan: 100 at once, but 12 starts/min, 60/h, 200/day |
| Pixel identity with the committed sprites | pixels identical, PNG bytes differ | pixels and PNG bytes identical (90 renders) | n/a |
| Isolation of the build code | engine sandbox: no `process`, no `Function`/`eval`, virtual FS, `fetch` denied | separate VM per candidate; network `deny-all` set through the API (no DNS, IP or metadata access, even with `sudo`); no secrets in the env; but the code is root in its VM (passwordless `sudo`) | separate VM per sandbox; outbound internet open by default, no API network policy: block it with `iptables` for a non-sudo user inside the VM; the VM holds an `ASCII_TOKEN` and, unless "safe for third parties", an in-sandbox API key |
| Endless loop / memory | `timeoutMs` ends it; resource-limit at about 423 MiB | `runCommand({timeoutMs})` SIGKILLs at the limit (5.2 s for 5 s); memory-cgroup OOM kill at about 2 GB (1 vCPU); VM stays usable | command timeout 30 s default, 600 s max; VM memory 4-32 GB by size |
| Cost of one candidate | not part of this note | about $0.0008 at Pro list rates: 2 GB for the 1-minute memory minimum ($0.0007) plus 1.5-3.5 s active CPU ($0.00005-0.00013) plus a creation ($0.0000006) | small (2 vCPU / 4 GB) $0.018/h per second, for example $0.00003 for 6 s; $20/month minimum, card required for the trial |
| Credentials the route needs | `SHOTCUP_API_KEY` | none on Vercel (the function's OIDC token); locally `vercel link` + CLI login or `vercel env pull` | a `boat_` API key |
| Operations | drive seeding, busy retries, a 300 s ceiling per run | one SDK; the same `run_local.ts` runner as local; stop every VM | API, SSH or CLI; you build your own network lock-down; EU regions only |

**Recommendation: render live candidates in Vercel Sandbox, one fresh microVM per candidate.** It is the only option here that is both fast and measured: the render goes from 10-107 s on Shotcup to about 1.4-2.4 s until the PNG is in hand (from the UK to `iad1`; a route running in `iad1` saves part of the round trips), so the model calls, not the render, set the latency of a candidate. Best-of-N can run in parallel. The isolation boundary is a VM per candidate with egress denied by a policy set from outside the VM through the API; it does not depend on the BANNED tripwire or on what a JavaScript runtime chooses to expose. On Vercel the route authenticates with its own OIDC token (documented; not tried from a deployment), so no sandbox key is added to the deployment. Keep Shotcup as the fallback renderer; boat.dev would need an account, a card and an in-VM firewall that we would have to build and test, and offers nothing this workload lacks on Vercel.

How to run it: `networkPolicy: "deny-all"`, `persistent: false`, 1 vCPU, a session `timeout` of 2 minutes and a `runCommand` `timeoutMs` per render (the renderer uses 30 s), one VM per candidate so that a build cannot leave anything for the next one, and `stop()` after the PNG is read (it took 1.2-1.3 s; a route can return the PNG first). Snapshots made creation slower than uploading the 216 KB of kit and runner, so the renderer uploads them each time.

## Why a sandbox and not the server

Locally, `local_render.py` runs model code in bun with your user's file and network access; only the environment is allowlisted. A Vercel function would be worse: the generated code would run in the same process family as the route that holds `MUBIT_API_KEY` (and `SHOTCUP_API_KEY` when Shotcup renders). On Shotcup the code runs in a fresh GocciaScript engine per run with a virtual filesystem; in Vercel Sandbox it runs in its own microVM with no network. The probes below found nothing of ours for it to reach in either.

## The route

```
POST /api/sprites {brief}                       (Next.js route handler, Node.js runtime, auth + rate limit)
  └─ start a durable job, answer {jobId}         (model calls plus renders: seconds on Vercel Sandbox, minutes on Shotcup)
job:
  1. generator   Mubit → Opus, system prompt pipeline/prompts/generator.md            → build(k) source (text only)
  2. tripwire    BANNED_IDENTIFIERS regex + "function build" check (cheap pre-filter, not a sandbox)
  3. render      Vercel Sandbox (recommended): Sandbox.create({networkPolicy:"deny-all", persistent:false, resources:{vcpus:1}}),
                 writeFiles(kit + runner + build), runCommand bun run_local.ts {timeoutMs}, readFileToBuffer(PNG), stop()  → PNG + stats
                 (pipeline/vercel_sandbox_render.ts: renderWithFreshSandbox). Or Shotcup:
                 POST https://shotcup.dev/api/v1/runs, one candidate per run:
                 {code: main.ts, engine:{canvas:true}, mounts:[{drive:"lampwarden", path:"/kit", mode:"ro"}],
                  deterministic:true, timeoutMs:<budget>}, no allowedHosts          → PNG (inlineBase64) + stats (last stdout line)
  4. engine flags  clipped/too_small/too_big/too_short → score 0, skip the verifier
  5. verifier    Mubit → Opus with the 4x PNG                                       → {pass, score, issues, fix}
  6. fix         one follow-up generator call with the verifier's issues → steps 2-5 again
  7. best-of     keep the higher score; store PNG + code + manifest row (Blob or similar, not the deployment's filesystem)
GET /api/sprites/:jobId → status / result
```

The route and the job only move text and PNG bytes between Mubit and the sandbox; they never `eval`, transpile or import model output. For Vercel Sandbox the render step already exists in TypeScript (`renderWithFreshSandbox` in `pipeline/vercel_sandbox_render.ts`); for Shotcup, `shotcup_main.main_source` (wrap the code, destructure the kit exports, call `post()`, save `/out/<name>.png`) is the part to port. `run.py` has the rest of the loop.

On Shotcup one sprite takes from tens of seconds to several minutes of render alone (below), so the job should not live inside one request. On Vercel Sandbox a render takes 1.4-2.4 s to the PNG and 2.6-4.1 s including `stop()`, so the model calls decide; their latency is not measured here, and a durable job is still the safer default. On Vercel's documented limits (not tested here), a function runs 300 s by default on every plan and up to 800 s on Pro, so a temple-sized sprite with one fix (about 215 s of render plus the model calls) leaves little headroom. A durable runner (Vercel Workflow, or a queue consumer) with one step per model call or render keeps each step short and survives restarts; the client polls or streams progress.

Rules for Shotcup that follow from its measurements (the Vercel Sandbox settings are under the recommendation above):

- **One candidate per Shotcup run.** In a batch, every candidate's code shares one module scope: a probe build overwrote another candidate's `/out/victim.png` and pushed a forged stats row, and the run still succeeded. Batching also bought nothing (below).
- **Don't fan out.** The runtime had 4 workers. Runs beyond that queued for 30 s and then failed (`failureKind: "daemon-error"`, "the runtime is busy; retry shortly"), and runs admitted together slowed each other down 1.6-3x. Best-of-N therefore costs about N times one render, wherever the requests start. `shotcup_render.py` now retries the busy failure (up to 2 retries) instead of scoring it as broken code.
- **Set a render budget.** `timeoutMs` above the plan ceiling (Scale: 300 s) is clamped with a `timeout-clamped` warning. A timeout ends the run cleanly (`failureKind: "timeout"`). Pick a budget per sprite: a temple needs about 107 s, so a 60 s budget would reject sprites the kit makes on purpose.
- **Never send `allowedHosts`** on render runs. Without it, `fetch` throws `PermissionDenied`.
- **Seed the drive at deploy time,** not per request. Writing the kit takes 0.43-0.65 s. An unchanged write makes no new version (`created: false`). Pinning the mount to that version id would stop a later kit write from changing a running job's renders. Not implemented or tested.
- **Keys.** `MUBIT_API_KEY` and `SHOTCUP_API_KEY` would become server-side environment variables of the deployment (today the README says the deployment has none and needs none: that changes with this route). Model output never runs where they live.
- **Artifact links are public capability URLs by default** (`artifactAccess: "public"`, kept for the plan's retention). The client reads `inlineBase64`, so the links aren't needed: send `retention: "none"` (tested, no speed effect) or `artifacts: "private"` (documented for MCP, not tried over REST).

## Shotcup: measured latencies

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

## Shotcup: pixel identity

Every Shotcup PNG from these runs (47 renders: 18 single, 18 batched, 9 from the parallel runs that succeeded, 1 first run, 1 after a busy retry) decodes to exactly the same RGBA pixels as the local bun render (Pillow, all 128×128 pixels compared, 0 differing). The PNG bytes differ, because the encoders compress differently. Shotcup's own bytes were identical across repetitions, and the local renders match the committed `public/sprites/*.png` byte for byte.

## Shotcup: sandbox probes

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

## Vercel Sandbox: measurements

Setup: `@vercel/sandbox` 3.9.0, the default image `vercel/sandbox/universal` (digest `sha256:3190aee7b741…`: bun 1.4.4, Linux 6.18 x86_64, "Intel Xeon Processor @ 2.90GHz"), region `iad1`, 1 vCPU / 2 GB unless noted, `networkPolicy: "deny-all"`, `persistent: false`. The VM runs the same `render/run_local.ts` and shims as the local renderer; the kit and runner (4 files, 216 KB) are uploaded with `writeFiles`. Three repetitions each, timed from the UK, so every SDK call crosses the Atlantic. "Local" is `local_render.render_file` on this Mac (bun 1.4.3, arm64): wall clock with process start, in-process `ms` in brackets.

**VM lifecycle (ms):**

| step | rep 1 / 2 / 3 |
|---|---|
| `Sandbox.create` (default image) | 322 / 241 / 256 |
| first command (`true`) | 155 / 219 / 173 |
| upload kit + runner | 207 / 282 / 321 |
| `stop()` | 1255 / 1264 / 1208 |
| `snapshot()` of a VM with kit + runner (1 sample) | 1637 |
| `Sandbox.create` from that snapshot | 1086 / 1967 / 994 |
| first command after it | 243 / 190 / 230 |
| `delete()` on a running VM | 211 / 265 / 175 |

**Renders in a warm VM** (one VM, the five sprites three times each; "in-VM" is the runner's own `ms`, "round trip" is write build + `runCommand` + read both PNGs):

| sprite | local, ms | 1 vCPU: in-VM | 1 vCPU: `runCommand` | 1 vCPU: round trip | 2 vCPU: in-VM | 2 vCPU: round trip |
|---|---|---|---|---|---|---|
| lamp-lit | 84 / 84 / 84 (49 / 50 / 50) | 262 / 217 / 157 | 683 / 525 / 373 | 1085 / 878 / 696 | 121 / 106 / 77 | 687 / 847 / 671 |
| house | 112 / 111 / 110 (73 / 74 / 73) | 200 / 211 / 213 | 431 / 441 / 467 | 874 / 1425 / 774 | 122 / 111 / 138 | 613 / 606 / 724 |
| temple | 341 / 342 / 381 (301 / 300 / 308) | 702 / 626 / 586 | 1054 / 880 / 796 | 1372 / 1185 / 1096 | 459 / 480 / 448 | 1055 / 1045 / 1046 |
| satyr | 145 / 142 / 143 (108 / 105 / 109) | 316 / 270 / 284 | 635 / 445 / 508 | 961 / 759 / 817 | 149 / 141 / 144 | 792 / 600 / 699 |
| olive | 193 / 193 / 243 (151 / 151 / 202) | 251 / 265 / 285 | 496 / 480 / 515 | 801 / 905 / 1111 | 208 / 235 / 196 | 671 / 743 / 699 |

**One fresh VM per render** (`renderWithFreshSandbox`: create, upload kit + runner + build, run, read PNGs, `stop()`), ms:

| sprite | default image: end to end | in-VM | from a snapshot: end to end |
|---|---|---|---|
| lamp-lit | 2731 / 3351 / 2619 | 235 / 434 / 237 | 3403 / 4387 / 3217 |
| house | 2786 / 2751 / 2731 | 384 / 355 / 365 | 3617 / 4506 / 4627 |
| temple | 3986 / 4082 / 3914 | 1351 / 577 / 1551 | 7065 / 5948 / 4142 |
| satyr | 3101 / 3561 / 3518 | 624 / 904 / 679 | 11374 / 3450 / 4939 |
| olive | 3310 / 3105 / 3041 | 805 / 411 / 555 | 3535 / 4374 / 7095 |

**Where the end-to-end time goes** (fresh VM, cumulative ms from the start of `create`):

| | lamp-lit, `iad1` | temple, `iad1` | lamp-lit, `lhr1` | temple, `lhr1` |
|---|---|---|---|---|
| VM created | 364 / 217 / 242 | 224 / 255 / 225 | 684 / 632 / 658 | 819 / 658 / 802 |
| kit + runner uploaded | 718 / 501 / 496 | 458 / 779 / 527 | 1446 / 1314 / 1421 | 1504 / 1362 / 1559 |
| PNG in hand | 1969 / 1802 / 1442 | 2064 / 2155 / 2399 | 3155 / 3019 / 3101 | 3789 / 3420 / 3633 |
| after `stop()` | 3166 / 2990 / 2663 | 3348 / 3400 / 3671 | 5481 / 5413 / 4550 | 5231 / 4693 / 4920 |

**Five candidates at once** (lamp-lit, house, temple, satyr and olive, each in its own fresh VM, started together): 3863 / 4181 / 4264 ms wall; each sprite took 2.6-4.3 s, as when run one at a time.

What the numbers say:

- The render is no longer the cost. To the PNG it is 1.4-2.4 s per candidate from a fresh VM, against 10-107 s on Shotcup. About 0.5-0.8 s of that is create + upload, and about 0.3-0.45 s per `runCommand` is bun starting and transpiling the kit plus the round trip.
- bun in the VM is 2-5x slower than this Mac for the same render (1 vCPU: lamp-lit 157-262 ms against 50 ms; temple 586-702 ms against 300 ms), and the first render in a fresh VM is slower again (temple up to 1.55 s). A second vCPU roughly halved the in-VM time but saved only about 0.1-0.3 s of the round trip.
- Snapshots don't pay here: creating from one took 1.0-2.0 s, more than creating from the default image and uploading the 216 KB (0.5-0.8 s together), and the end-to-end times from a snapshot were slower and more variable (3.2-11.4 s). They would pay if the runner needed an install step.
- `lhr1` was slower from the UK than `iad1`: create and upload took about twice as long. A list call's `x-vercel-id` header showed the API answering through `iad1`. Keep the sandbox region next to the route.
- `stop()` takes 1.2-1.3 s in `iad1`. A route can return the PNG before it stops the VM.

### Vercel Sandbox: pixel identity

90 renders (the five sprites in warm VMs at 1 and 2 vCPUs, in fresh VMs from the image and from a snapshot, in `iad1` and `lhr1`, in parallel, from the CLI and through `run.py`'s render step) decode to exactly the pixels of the committed `public/sprites/*.png`, and the PNG files are byte-identical too, because the VM runs the same encoder (`shim_canvas.ts`, `node:zlib`). bun 1.4.4 on x86_64 in the VM and bun 1.4.3 on arm64 locally made no difference for these sprites. A change of the image (which brings its own bun) or of the kit should be re-checked the same way.

### Vercel Sandbox: probes

Harmless probes, run as build code through the same runner and settings as `vercel_sandbox_render.ts` (1 vCPU, `deny-all`, only `KIT_OUT` passed to the command). The probe build reached `process` and `Bun` through `[].constructor.constructor('return this')()` with string-built names, which is what gets past the BANNED tripwire, so everything below is what model code could do.

| question | result |
|---|---|
| Environment variables | `PATH`, `HOME`, `LANG`, `SHELL`, `KIT_OUT` and the CA-bundle variables of the image (`AWS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and the like). PID 1's environment has the same keys. No Vercel token or other secret: the SDK credential stays with the caller and nothing is passed in. |
| Privileges | The build runs as `ubuntu` (uid 1000), a member of `sudo` with passwordless sudo, so it is root in its VM. It can write the kit and the runner, spawn processes, and reach the VM's init socket `/run/vercel/share/init.sock` (owned by `ubuntu`; not probed further). Run as a separate user made with `sandbox.createUser("builder")`, the same probe got "a password is required" from sudo, `Permission denied` on `/proc/1/environ`, `/root` and `/run/vercel/share`, and a read-only kit. |
| Files outside its directory | It sees an ordinary Ubuntu filesystem: `/etc/passwd` (19 lines), the image's tooling under `/vercel` (`.bun`, `.cache`, `.codex`, `.config`), an empty `/root`. Nothing of ours except the uploaded kit, runner and build. |
| Network | With `deny-all`: `getent hosts example.com` got no answer, `curl https://example.com/` "Could not resolve host", `curl http://1.1.1.1/` timed out after 5 s, `curl http://169.254.169.254/` could not connect, and bun's `fetch('https://example.com/')` failed with `EAI_AGAIN`. The same probe in a control VM with the default `allow-all` resolved DNS and got 200 from example.com, 301 from 1.1.1.1 and 200 from `fetch`, so the probes do detect egress. The metadata address was unreachable in both. I did not try to lift the policy as root. |
| Infinite loop | `while (true) {}` with `runCommand({timeoutMs: 5000})`: SIGKILL (exit 137) at 5.2 s. The VM stayed usable. The renderer gives each render 30 s, and the session `timeout` (2 minutes in the renderer) caps the whole VM. |
| Memory | Growing `Float64Array`s: the memory cgroup's OOM killer ended bun (exit 137) after 1.0-1.5 s at 2.09 GB resident (1 vCPU = 2 GB). The VM stayed usable. |
| Leftovers for the next candidate | In a reused VM a build could change the kit or the runner or leave a background process behind. Hence one VM per candidate; if VMs are ever reused, run each build as its own non-sudo user (tested above) and start from a clean job directory. |

### Vercel Sandbox: cost

Documented Pro rates in `iad1` ([pricing](https://vercel.com/docs/vercel-sandbox/pricing), read 24 Oct 2026): active CPU $0.128/h, provisioned memory $0.0212/GB-h billed in 1-minute minimum increments, creations $0.60 per million, data transfer included in the Pro flat-rate CDN, snapshot storage $0.08/GB-month; Pro usage draws first on the plan's $20 monthly credit. Hobby includes 5 h of active CPU, 420 GB-h of memory and 5,000 creations a month. The team here is on Pro.

Usage of one fresh-VM render, from the SDK's own fields (lamp-lit and temple, 3 each): 1.8-3.7 s duration, 1.5-3.5 s active CPU, 2 GB, 17-24 KB out and 76 KB in. At list rates that is about $0.0007 of memory (the 1-minute minimum of 2 GB dominates), $0.00005-0.00013 of CPU and $0.0000006 for the creation: **about $0.0008 per candidate**, or about $1.60 for 1,000 sprites with one fix each. A warm VM spread over many renders is cheaper per render (15 renders on 1 vCPU used 7.7 s of active CPU in 15.4 s), but it keeps 2 GB billed while it waits and needs the per-build user hygiene above. These are list prices times measured usage, not a bill.

## boat.dev (documentation only)

[boat.dev](https://boat.dev) ("boat", formerly "Box"; status page at status.ascii.dev) sells cloud sandboxes that are persistent full Ubuntu 24.04 VMs (Linux 6.8, one image for everyone) with SSH, Docker, a public IP and a desktop, driven by a CLI, a REST API (`https://boat.dev/api/v1`), and Python and TypeScript SDKs. From its site and docs, read 24 Oct 2026:

- **Runtime:** Node.js and Bun are preinstalled, so the kit would run JIT-compiled, as in Vercel Sandbox. ([boat.dev](https://boat.dev))
- **Hardware and start:** sandboxes normally run on dedicated AMD Ryzen 9 9950X hosts; when those are full, boat falls back to older cloud VMs that were about 3x slower on its own build benchmark, at the same price. Create, fork and resume put the sandbox on an already running machine and "usually get a machine in less than one second". The hypervisor is not named. ([Virtualization](https://docs.boat.dev/machines/virtualization.md), [Fail fast](https://docs.boat.dev/machines/fail-fast.md), [Readiness](https://docs.boat.dev/readiness.md))
- **Isolation:** each sandbox is its own VM with its own kernel; the `user` account has passwordless sudo. Outbound internet is open by default and "boat has no API setting for network rules": to block it, run the untrusted code as a separate non-sudo user and add `iptables` owner rules inside the VM, again after every resume and fork. A sandbox holds an `ASCII_TOKEN` (publishes its own ports) and, unless its environment is "safe for third parties", an in-sandbox API key. ([Security](https://docs.boat.dev/security.md), [Firewall](https://docs.boat.dev/hosting/firewall.md))
- **Limits:** commands over the API time out after 30 s by default, 600 s at most. The $20 plan allows 100 sandboxes at once but 12 starts a minute, 60 an hour and 200 a day. Regions are in the EU only (Germany, Finland, France). ([llms.txt](https://docs.boat.dev/llms.txt), [Limits](https://docs.boat.dev/limits.md), [boat.dev](https://boat.dev))
- **Pricing:** per second while a sandbox runs: small (2 vCPU / 4 GB) $0.018/h, default (4 vCPU / 8 GB) $0.036/h, large $0.072/h. Plans start at $20/month (returned as compute time); the 7-day trial needs a card. Its comparison page lists Vercel Sandbox's 4 vCPU / 8 GB at $0.682/h at full use and 2.1x slower on its Node build benchmark. ([Pricing](https://docs.boat.dev/pricing.md), [Compare](https://boat.dev/compare))

Not measured: the API needs a `boat_` key, which needs an account, and the trial needs a card, so I did not sign up. For this workload its per-second price is the lowest, but one VM per candidate would hit the 200-starts-a-day limit of the $20 plan, reusing VMs means building the per-job users and the egress firewall ourselves, the deployment would need another vendor key, and the regions are in the EU while the Vercel functions default to `iad1`. At a few seconds per candidate the price difference to Vercel Sandbox is a fraction of a cent.

## Not verified

- A full live round trip (Mubit generator → sandbox → Mubit verifier → fix) from a server route, or `run.py --render shotcup` / `--render vercel` end to end: no Mubit call was made. Model latency per call is unknown here.
- Shotcup's wake after idle (0.7-2.3 s on its performance page) was not reproduced: the account had other runs that day, so I couldn't tell when the sandboxes were idle.
- Whether the 4-worker limit is per account, per region or global, and whether a Platform plan or tenant keys raise it. The account's `/me` says `maxConcurrent: 50`, but the runtime refused a fifth concurrent run.
- `artifacts: "private"` over REST, and pinning a drive version in `mounts`.
- Vercel duration limits are quoted from Vercel's documentation, not tested; no route was deployed.
- Vercel Sandbox from a deployed route: nothing was deployed. All Vercel Sandbox timings are from a client in the UK; a function in `iad1` next to the VMs should save part of each SDK round trip, by an amount not measured.
- `run.py --render vercel` with Mubit: the render step was run through `run.render()` (two sprites, a banned identifier, a syntax error, an endless loop), not inside the full loop.
- Whether `delete()` (0.18-0.27 s) ends a running session and its billing as `stop()` does: a deleted sandbox disappears from listings and its session returns 404, so I could not read its final state. The renderer uses `stop()`.
- Root in the VM against the network policy and the init socket: the probes ran with sudo available and stayed offline, but I did not try to change the policy or talk to `/run/vercel/share/init.sock`.
- The Vercel bill for these runs: the costs above are list prices times the SDK's usage fields.
- boat.dev: nothing was run; everything in its section is from its own site and docs.
- Kit-side speed-ups (fewer rasterisation passes): not tried.
