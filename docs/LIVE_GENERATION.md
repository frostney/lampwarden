# Live sprite generation

How the asset loop (brief → generator → render → verifier → fix → best-of) runs as a server route, with model-written `build(k)` code executed only in Vercel Sandbox. The route exists (see "The route"); the measurements below are what it was designed from. Vercel Sandbox (the team's Pro plan, `pipeline/render-vercel-sandbox.ts`) and Mubit were measured on 24 Oct 2026, timed from a client in the UK. Unless a section says otherwise, the render timings used the kit before its speed-ups (sha256 `cf66f505c9e9…`, 212,457 bytes); the kit on `main` now (sha256 `335b0f4040a7…`, 225,487 bytes) renders the same pixels several times faster. Mubit was measured with generator calls only; the full generate → render → verify → fix round trip was run later, through the route (see "What was run live").

## Why only the sandbox

**Vercel Sandbox is the only way to render, and the source of truth for every pixel.** Model-written code runs in a Firecracker microVM with no network (`networkPolicy: "deny-all"`, which also blocks DNS), no persistence and no secret in its environment; the boundary is set from outside the VM through the API, so it does not depend on the banned-identifier tripwire (`pipeline/build-code.ts`) or on what a JavaScript runtime chooses to expose. A render takes 1.4-2.4 s until the PNG is in hand (from the UK to `iad1`), and a batch of builds in one VM takes seconds (below), so the model calls, not the render, set the latency of a candidate. On Vercel the route authenticates with the deployment's OIDC token, so no sandbox key is added to it. Running the command-line tools through the sandbox costs a Vercel login and a snapshot (`docs/tooling.md`, "Rendering needs Vercel auth"); that is the price of having one renderer.

Every other way to run the code was built or measured and then dropped:

| Option                                         | What it measured                                                                                                                                                                                                                                                                                                                                                                             | Why it is not used                                                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bun subprocess on the host (`render-local.ts`) | Pixel-identical to the sandbox; 218 renders took 15.2 s one after another on a laptop (temple 0.34 s).                                                                                                                                                                                                                                                                                       | An environment allowlist keeps keys out, but the build still ran with the user's file and network access, in the same place as the route's secrets once deployed. A second source of truth for pixels.                                         |
| Shotcup (`render-shotcup.ts`)                  | A GocciaScript bytecode VM, interpreted. Pixel-identical to bun on 6 sprites (PNG bytes differ). Old kit: lamp-lit 10.1 s, temple 106.5 s; current kit: lamp-lit 1.76 s, temple 11.74 s (engine seconds). About 3 runs admitted at once, the rest fail "runtime busy"; a batch shares one module scope, so one build can overwrite another's PNG.                                            | Slower per render than the sandbox with either kit, parallelism capped at about 3, and the TypeScript client was never run against the live API. Removed.                                                                                      |
| boat.dev (`render-boat.ts`)                    | bun in a full Ubuntu VM: 1.4-2.1 s to the PNG from a fresh `small` sandbox, 0.40-0.96 s per candidate in a reused one; pixel-identical (95 renders); about $0.00001 a candidate. Trial limits: 2 sandboxes at once, 25 starts an hour.                                                                                                                                                       | No network setting in its API and a root-capable default account, so the lock-down (non-root account, all traffic rejected, no cron) was ours, inside the VM; needs a `boat_` key in the deployment; EU machines. Removed.                     |
| QuickJS in WebAssembly, in process (#33)       | Pixel-identical on all 58 committed sprites and hero frames; 0.25-0.7 s for small sprites and about 2 s for the temple, against 2.5-3.7 s for a Vercel Sandbox; passed 16 of 16 isolation probes where `node:vm` failed 8; 25-45x slower than the same kit under a JIT.                                                                                                                      | Closed as a record, [#33](https://github.com/frostney/lampwarden/pull/33). The owner's decision: the sandbox is the source of truth, and a second renderer is a second source of pixels.                                                       |
| QuickJS in the browser (#45)                   | The creature delivered as code, drawn by the player's browser in a Web Worker with QuickJS; the first creature cost 308 KB to download.                                                                                                                                                                                                                                                      | Closed as a record, [#45](https://github.com/frostney/lampwarden/pull/45). Every player's browser would run model code, and the server still rendered once so the verifier could judge pixels.                                                 |
| Plain JavaScript in the browser (#49)          | Draw time 8-13 times lower than QuickJS and the first creature 5 times smaller (56 KB); 18 of 18 sprites and 20 of 20 hero frames drawn exactly in Chromium and WebKit.                                                                                                                                                                                                                      | Closed as a record, [#49](https://github.com/frostney/lampwarden/pull/49). `import()` cannot be shadowed and a page `connect-src` does not apply to the worker, memory is unbounded, and a tampered gallery record would run for every player. |
| A worker thread on the server (#50)            | 75-177 ms from a fresh worker, 39-147 ms pooled; all 218 committed renders pixel-identical; the hero's 100-frame set in about 2.5 s. Its kit pose check: humanoid, `spartan`, `cyclops`, `minotaur`, `satyr`, `harpy`, `winged`, `hero` and `centaur` animate idle, walk, attack, hurt and death; `quadruped` animates idle, walk and attack; the lamia barely walks; `hydra` takes no pose. | Closed as a record, [#50](https://github.com/frostney/lampwarden/pull/50). Contained keys, crashes, hangs and memory bombs, but not file-system and network reach when `import()` is left open.                                                |

The Shotcup and boat.dev write-ups (comparison table, probes, limits, cost) are in this file as of commit `14b69af` (`git show 14b69af:docs/LIVE_GENERATION.md`); their code was removed with this change. #50's kit pose check is why the creature brief writer steers towards builders that animate (`pipeline/prompts/creature.md`).

### Batch mode

`renderBatchInSandbox` renders many builds in one VM (`pipeline/README.md`, "Rendering"): `render/batch.ts` starts one `bun runner.ts` process per item, one per vCPU at a time, each killed at its own deadline, and writes one results file. Measured on 24 Oct 2026 from the UK, with the snapshot (`iad1`), end to end including VM create and stop:

| Work                                                  | Sandbox batch                   | Before (bun on the host, one after another) |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| One temple, a batch of one (1 vCPU)                   | 3.4-4.7 s                       | 0.34 s                                      |
| 18 committed sprites, one VM (4 vCPUs)                | 3.4-4.2 s                       | not timed on its own                        |
| 100 hero frames of one sex, one VM, 1 / 4 / 8 vCPUs   | 20-26 s / 7.4-8.1 s / 4.8-5.1 s | not timed on its own                        |
| `bun run check:pixels`: 218 renders, 4 VMs of 4 vCPUs | 6.7-8.0 s (0 differing pixels)  | 15.2 s                                      |

A single render costs the VM's start and stop (about 3 s) that a host subprocess does not; many renders amortise it, and CPUs in the VM are cheap. Once, the first `check:pixels` after a fresh snapshot took 340 s for the same work (and a 30-frame batch likewise, with the VM-side batch taking 2.6 s); it did not repeat in later runs, and the cause is unknown.

## Parallelism and grouping

Measured on 24 Oct 2026 from the UK. The unit of work is one candidate: its build code rendered alone, then its PNG verified.

| Service                                           | What was measured                                                                                                                                                                                  | Result                                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Sandbox, a fresh VM per render, faster kit | N renders started together, wall time of the whole batch                                                                                                                                           | 1 concurrent: 2.9 s. 10: 3.5 s (median 3.2 s). 25: 4.2 s. 50: 13.4 s (all 50 completed; most in about 3 s, a few held to about 13 s while VM creation was paced). 86 renders in all, every one pixel-identical to the committed sprite, about $0.07 |
| Mubit, generator calls                            | 6 briefs (lamp on a post, satyr with a club, cyclops with a boulder, harpy, whitewashed house, market stall) at 1, 2, 3 and 6 concurrent, 24 calls in all, each output rendered on the host (then) | see "Mubit" below: all 24 returned 200 with no retries; the 6-brief batch took 16.5 s, 8.4 s, 8.1 s and 6.8 s                                                                                                                                       |

Grouping guidance:
- **One candidate per VM in the live job.** A batch shares one VM, so builds in one batch can see each other's files; the job renders each candidate alone and batches only one creature's own animation frames.
- **Send all generator calls at once.** Mubit's limits are far above any batch of sprites we would send, and a batch takes as long as its slowest call.
- **Render each candidate in its own sandbox as soon as its code arrives**, as a pipeline rather than batched stages, with up to about 25 Vercel Sandbox renders at once (4.2 s for 25 against 13.4 s for 50). Verifier and fix calls follow per sprite, and the engine's own flags still skip the verifier.
- Not yet measured: the whole loop at concurrency (generator, render, verifier and fix together). `pipeline/run.ts` runs 4 briefs at once by default (`--concurrency N`); that is a conservative default, not the measured ceiling.

## Mubit

Generator calls use exactly the request `pipeline/run.ts` sends: `generator.md` as the system prompt, `Brief: …` as the user message, `max_tokens` 1500, `metadata.user_id`, no `temperature`, model `claude-opus-5-5`. They were run at 1, 2, 3 and 6 concurrent, 24 calls in all; every output was rendered on the host with bun (the renderer of the time).
- All 24 returned 200 with no retries, and all 24 builds rendered. Two cyclops outputs were flagged `clipped_at_edge`, which is the normal verify-and-fix case.
- Batch wall time for the 6 briefs: 16.5 s at 1 concurrent, 8.4 s at 2, 8.1 s at 3, 6.8 s at 6.
- Per-call latency doesn't change with concurrency. The median is about 2.1 s (1.75-2.7 s) for 53-113 output tokens. The cyclops brief is the outlier at 5.2-8.0 s for 400-620 tokens. So a batch takes as long as its slowest call.
- Input is about 5.4k tokens per call (the `generator.md` system prompt).
- Mubit passes Anthropic's rate-limit headers through: 1,000 requests/min, 2,000,000 input tokens/min, 400,000 output tokens/min. The probe used at most 6 requests, 8k input and 1k output tokens of that. At about 5.4k input tokens per generator call the input limit allows about 370 generator calls per minute. Mubit is not the bottleneck; the sandbox renderer is.

### Prompt caching

Repeat calls resend the same 5.4k tokens, so `pipeline/mubit.ts` marks each system prompt as the end of a cacheable prefix (`cache_control: {"type": "ephemeral"}`, 5 minute TTL; `claude-opus-5-5` caches prefixes of at least 512 tokens and bills a read at 0.05x the input price, a write at 1.25x). The first measurement was made with the cache off (`cache_read_input_tokens` was 0 on all 24 calls). Checked live afterwards with two generator calls in a row, one system prompt: the first wrote 5,379 tokens to the cache (2,347 ms, 17 uncached input tokens, 60 output tokens), the second read all 5,379 back (2,090 ms, 17 uncached input tokens, 122 output tokens, `cache_creation_input_tokens` 0). So Mubit passes `cache_control` through. The two latencies can't be compared directly (the outputs differ in length). Calls that start together all miss, because an entry exists only once the first response has begun; later calls hit. `--no-prompt-caching` turns it off.

## The route

Built: each night the sea can send a new creature, made live through Mubit, drawn in a Vercel Sandbox and kept in a gallery every player draws from. The routes are `src/app/api/creatures/` (Node.js runtime, Zod at every boundary, short error strings only), their logic is `src/server/creatures/`, the loop is `pipeline/loop.ts`, and the contract with the game (the `Creature` record, archetype-derived stats, request and response shapes) is `src/game/creature.ts`.

| Route                               | What                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/creatures/next` `{seen}` | The newest gallery creature not in `seen` (`{kind:"ready", creature}`). If there is none: the running job when one is running (`{kind:"generating", jobId}`, so many players share one generation); else a new job when the limits allow; else `{kind:"none", reason:"rate-limited", retryAfterSeconds}`, or `reason:"unavailable"` when generation is not configured or storage fails. |
| `GET /api/creatures/jobs/:jobId`    | The job as `CreatureJob`: `step` (queued, writing, drawing, rendering, judging, fixing, done, failed), the `creature` when done, a short `error` when failed. A job whose status has not moved for longer than `maxDuration` reads as failed (`timed out`).                                                                                                                             |
| `GET /api/creatures/:id/atlas.png`  | The animation atlas of a creature whose record has `frames` (404 for one that has none), cached the same way. 768 x 384 px: a row for each animation (idle 4, walk 6, attack 5 frames), 128 px cells (`src/game/creature-frames.ts`).                                                                                                                                                   |
| `GET /api/creatures/:id/sprite.png` | The PNG from the private Blob store, `cache-control: public, max-age=31536000, immutable` (ids are unique and a sprite never changes).                                                                                                                                                                                                                                                  |

### The job

```
POST /api/creatures/next  ── no unseen creature, nothing running, limits allow ──►  claim the global slot, answer {generating, jobId}
  └─ after()                                                    (the same invocation keeps running after the response)
     1. writing    brief writer: one Mubit call, prompts/creature.md → {name, lore, sprite brief, archetype, 4 modifiers in {-1,0,1}}
                   validated with the contract's Zod schema; given the gallery's names (and the three built-in monsters) to avoid repeats;
                   a random thread of myth is offered as inspiration, because Mubit takes no temperature and the same prompt gets the same creature;
                   every brief aims at one body plan the kit draws well (satyr, cyclops, minotaur, harpy, winged or plain humanoid, centaur, hydra) with at most two named parts
     2. drawing    three candidates at once (CREATURE_CANDIDATES): one generator call each (prompts/generator.md) from the same brief,
                   each with a different nudge, because Mubit takes no temperature → build(k) source, text only
     3. rendering  per candidate, as soon as it is drawn: tripwire (build-code.ts), then a Vercel Sandbox of its own, booted from the pinned
                   snapshot, deny-all network
     4.            engine flags (clipped / too small / too big / too short) → score 0, no verifier call
     5. judging    verifier (Mubit, sees the 4x PNG) on each survivor, in parallel; borderline scores are taken twice
     6. fixing     only if the best candidate is not already accepted: one fix turn on that candidate alone, then 3-5 again; best-of
     7. accept     a verifier pass, or a score of at least 6 with no engine flags (the bar, calibrated below). Anything else: the job fails and stores nothing
                   anchorY from the render's bbox (lowest row + 1 - 4 px of shadow, over 128); stats are derived by creatureStats(), never taken from the model
     8. animating  the accepted code is rendered again with POSE = idle1..idle4, walk1..walk6, attack1..attack5 in ONE sandbox batch (4 vCPUs,
                   pipeline/creature-frames.ts) and packed into the atlas. Refused, and the next best accepted candidate tried: a frame that does not
                   render, and a builder whose walk frames are all one picture (it ignores POSE). None left: the job fails ("it could not be animated")
                   store creatures/sprites/<id>.png + .atlas.png + .ts, then creatures/records/<id>.json (with `frames`), then the job: done
```

The generator writes `pose: POSE || 'idle'` into every builder call that takes a pose (`pipeline/prompts/generator.md`), so one piece of code draws the judged still (`POSE` is empty, the builder's idle) and every frame. The brief writer steers towards the body plans that animate fully (`pipeline/prompts/creature.md`): humanoids and their presets and the centaur animate idle, walk and attack with the whole body; a four-legged animal animates idle, walk and attack with plain limbs; the hydra takes no pose and stays still, and a serpent tail barely moves (the kit's pose check in #50). In the game a creature walks while it travels, claws with the attack frames (a lamp being snuffed, a blow on the warden) and idles when held by a hit or waiting at the warden's side, at the warden's own paces (idle 6, walk 10, attack 14 frames a second), flipped left and right as the other monsters are. The sim does not read frames: they are drawing only, and a replay of a night with a creature looks for its atlas.

Model code only ever reaches the sandbox: the function holds `MUBIT_API_KEY`, so it never evals, transpiles or imports what the model wrote (`pipeline/build-code.ts` is a tripwire in front of the sandbox, not the boundary). Every Mubit call goes to `https://api.mubit.ai/anthropic/v1/messages` with `claude-opus-5-5`, never sends `temperature`, and marks the system prompt cacheable. The job reports to Blob at every step; a failure ends as one of a few fixed strings, and no model output, stack trace or error message is stored, returned or logged (the log has job ids, steps, Mubit request ids, status, timings, token counts and the verifier's scores).

### How it survives function limits (`after()`, not Vercel Workflow)

`POST /api/creatures/next` starts the job with `after()` from `next/server` and declares `export const maxDuration = 300`. Under Fluid Compute (the default) a function runs 300 s by default on every plan and up to 800 s on Pro (documented limits, read 24 Oct 2026; not exercised on a deployment), and `after()` runs for "the platform's default or configured max duration of your route" (Next's `after` docs). A job took 28-78 s locally (below), 59 s on a preview deployment, so 300 s covers it with room for one slow Mubit call; the job itself gives up after 270 s (`JOB_BUDGET_SECONDS`) so it can record `failed: timed out` before the platform kills the invocation, and a job whose status has not moved for longer than `maxDuration` is read as failed by everything that looks at it (the job route, and the slot check that lets the next job start).

Why not Vercel Workflow: Workflow's gain is durability, surviving a crash or deploy mid-job and running past the function limit, and this job needs neither. It is short against the limit, a lost job costs one failed nightly attempt and a retry (the slot frees itself after `maxDuration`), and every step already writes its status to Blob, so nothing is hidden state. Workflow would add a dependency, its own step and replay semantics and a second place the job's state lives, for a failure mode that is cheap here. If jobs ever need to outlive 300-800 s (several fix turns, more candidates), move the loop's stages into workflow steps; `runLoop`'s `onStage` and the store are the seams.

### Storage and the one-job-at-a-time slot

All in the existing private Blob store (`BLOB_READ_WRITE_TOKEN`), under `creatures/` (`CREATURE_BLOB_PREFIX`; live tests used `creatures-dev/`):

| Path                                                                                 | What                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `records/<id>.json`, `sprites/<id>.png`, `sprites/<id>.atlas.png`, `sprites/<id>.ts` | The accepted creature (with `frames`, the frame counts, when it has an atlas), its idle sprite, its animation atlas and the build code. Ids start with their creation time (base 36), so a sort is newest-first; the record is written last, so a creature is in the gallery only when complete. |
| `jobs/<jobId>.json`                                                                  | Job status, rewritten at every step. Read with `useCache: false`.                                                                                                                                                                                                                                |
| `state/running.json`                                                                 | The global slot: which job is running. Claimed with a conditional write (create-if-absent, or `ifMatch` the version just read), so of several simultaneous starters exactly one wins; the rest follow its job.                                                                                   |
| `starts/visitor/<hash>/<day>/<ms>-<jobId>`, `starts/day/<day>/<jobId>`               | One tiny blob per job start, counted by listing for the rate limits.                                                                                                                                                                                                                             |

### Rate limits

Only starting a job is limited; reading the gallery, and following a job that is already running, never is. Per visitor, 3 starts an hour (`CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR`); for the whole site, 40 a UTC day (`CREATURE_MAX_STARTS_PER_DAY`). A visitor is the HMAC-SHA256 of the first `x-forwarded-for` address under the secret `CREATURE_RATE_SALT` (at least 16 characters; without it generation is off); the address itself is never stored. Changing the salt resets everyone's count.

Races that remain, because the counts come from Blob listings and not from a transaction:
- The slot is atomic, and a job's marks are written before its job starts, so two jobs never overlap and a count is complete whenever a new job is considered. What can still slip through is a listing that lags a just-written mark (Blob listings are not documented as read-after-write consistent), letting one extra start through at the limit.
- A job that dies without finishing holds the slot until `maxDuration` has passed since its last step, so for up to 5 minutes nobody can start a new one (they follow the dead job and see it fail).
- Marks are never deleted, so a very old visitor key or day prefix is just a few tiny blobs; the daily and hourly windows ignore them.
- The same visitor behind many addresses (IPv6 privacy addresses, a mobile network) gets more starts; one address shared by many (an office) shares 3 an hour. The daily ceiling bounds the cost either way.

### The sandbox: a snapshot with Bun 1.4.4

The stock image (`vercel/sandbox/universal`, checked on 24 Oct 2026, Ubuntu 26.04.1, kernel 6.18.49) ships Bun 1.4.4 at `/usr/local/bin/bun`, which is also the latest release (`npm view bun version`). The render does not trust that to stay so: `bun run sandbox:snapshot` (`pipeline/sandbox-snapshot.ts`) boots a sandbox with a network allow-list of `github.com` and `*.githubusercontent.com` only, downloads Bun 1.4.4 from its GitHub release, checks the zip against the pinned SHA-256 (`bf8ccbfb…`, the release's `SHASUMS256.txt`), installs it at `/usr/local/bin/bun`, switches the policy to `deny-all`, checks `bun --version` is 1.4.4, copies in the kit and runner and a `SNAPSHOT.json` (kit sha256, bundle sha256, Bun version, the zip's digest), renders the committed `ex_lamp_lit.ts` and requires it to reproduce `public/sprites/lamp-lit.png` byte for byte, and snapshots with no expiry. It prints `VERCEL_SANDBOX_SNAPSHOT_ID=…`.

Render sandboxes boot from that snapshot with `networkPolicy: "deny-all"`, 1 vCPU (more for a batch), `persistent: false`, and run `/usr/local/bin/bun batch.ts` (the batch driver, `render/batch.ts`; a single render is a batch of one). Before the first render with a snapshot, a process reads its `SNAPSHOT.json` once and refuses the snapshot, failing the render with a fixed message, when its bundle digest differs from the one computed from the `pipeline/kit/kit.ts`, `pipeline/render/*.ts` that are deployed, or when its Bun is not the pinned one. So a change to the kit or the runner needs a new snapshot and a new `VERCEL_SANDBOX_SNAPSHOT_ID` before it deploys, and the failure is loud, not a silently different sprite. The function reads those files and the prompts at runtime (`outputFileTracingIncludes` in `next.config.ts`); the kit and runner that render sprites are in the snapshot, not read for rendering. Sandbox auth in a deployed function is the platform's OIDC token; nothing from the function's environment is passed into the VM (the render command gets only `KIT_OUT`).

### Environment

Set on the Vercel project (Production, and Preview if previews should generate); nothing here is needed for the game itself:

| Variable                                   | Required | What                                                                                                                                                                          |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUBIT_API_KEY`                            | yes      | Mubit, for the brief writer, generator and verifier. Server-only; model code never runs where it lives.                                                                       |
| `VERCEL_SANDBOX_SNAPSHOT_ID`               | yes      | The id printed by `pipeline/sandbox-snapshot.ts`.                                                                                                                             |
| `CREATURE_RATE_SALT`                       | yes      | At least 16 random characters (`openssl rand -hex 24`). Keys the per-visitor limit; changing it resets the counts.                                                            |
| `BLOB_READ_WRITE_TOKEN`                    | already  | The store `/api/plays` uses.                                                                                                                                                  |
| `CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR` | no       | Default 3.                                                                                                                                                                    |
| `CREATURE_MAX_STARTS_PER_DAY`              | no       | Default 40, site-wide, per UTC day.                                                                                                                                           |
| `CREATURE_CANDIDATES`                      | no       | Candidate sprites drawn side by side per job; default 3, at most 5. More candidates mean more Mubit calls (about 2 more per candidate) and more sandboxes at once.            |
| `CREATURE_DEBUG_DIR`                       | no       | Local development only, never on Vercel: a directory where each job leaves every candidate's PNG and a score summary, accepted or not. Writes model text (the brief) to disk. |
| `CREATURE_BLOB_PREFIX`                     | no       | Default `creatures`. Use another prefix (`creatures-dev`) to keep test runs out of the real gallery.                                                                          |

For local runs keep `CREATURE_RATE_SALT` fixed (in `.env.local`, say): a salt that changes with each server start gives every visitor a new key and resets the visitor limit, which is how a test once started a job it should have been refused.

With any of the three required variables missing, `POST /api/creatures/next` still serves the gallery and answers `{kind:"none", reason:"unavailable"}` once it has nothing unseen.

### The acceptance bar, calibrated against our own art

`bun run calibrate:verifier` (`pipeline/calibrate-verifier.ts`) scores every committed sprite and three hero frames exactly as a job does (same verifier prompt and message, the borderline double-take), twice each, 41 scores in all (24 Oct 2026). The strictness of this verifier shows in our own art: buildings and heroes score 7-9, our creatures 5-6.5.

| Score or better     | All 21 sprites | The 12 characters (heroes, Hephaestus, Zeus, lion, cyclops, satyr, harpy, hydra) | The 5 hand-made monsters |
| ------------------- | -------------- | -------------------------------------------------------------------------------- | ------------------------ |
| 5                   | 100%           | 100%                                                                             | 100%                     |
| 5.5                 | 83%            | 71%                                                                              | 40%                      |
| 6                   | **80%**        | 67%                                                                              | 40%                      |
| 6.5                 | 71%            | 50%                                                                              | 20%                      |
| 7 (a verifier pass) | 59%            | 38%                                                                              | 0%                       |

The bar stays where the job already had it: **a verifier pass, or a score of at least 6 with no engine flag**, which about 80% of our committed sprites reach (the engine-flag veto is untouched). A bar of 5.5 would add little; 5 would admit sprites our own README calls weak. The lowest accepted live sprites (score 6: the nymph, the talon-legged Empusa, the winged gorgon) were looked at on the contact sheet: all read as what the brief names, none is clipped or broken. Two verifications of one sprite differ by up to a point, which is why several candidates help.

### What lifted acceptance, measured

Before: **0 of 3 full live jobs accepted** (24 Oct, one candidate, the first brief writer; scores 3-4), and 0 of 3 in the diagnostic runs after it (4-5). Each change below was tried with brief → generator(s) → local render → verifier runs (no sandbox, no storage) before it went into live jobs; the numbers are small samples and a verification is noisy by half a point.

| Change                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brief writer given the kit's builders and a menu of body plans, told to name at most two parts and only colours that exist        | The first version (garments on skeletons, kelp, two colours on one-colour builders) still scored 5 on all 4 creatures. Plain briefs of the form "body plan, two parts, colours" accepted 6 of 6 hand-written ones at one candidate (scores 6-8) and 5 of 7 written by the model at one candidate.                                                                                                                                                                                            |
| Few-shot: `satyr.ts` and `harpy.ts` in the cached generator prompt                                                                | No gain: on six fixed briefs 6 of 6 accepted with and without (first scores 8,7,6,6,6,6 against 8,6,6,5,6,6), on model briefs at three candidates 7 of 8 both ways (winners averaging 7.5 both ways). Dropped.                                                                                                                                                                                                                                                                               |
| Three candidates at once (one generator call each, rendered in parallel, best kept, fix only if the best is not already accepted) | 7 of 8 accepted at three candidates against 5 of 7 at one on the same brief writer. Mubit takes no temperature, so three calls from one prompt came out near-identical (5,5,5): each candidate after the first now gets a different nudge (a facing, a pose, contrasting colours), and they differ.                                                                                                                                                                                          |
| Skipping the fix turn when the best candidate is already accepted                                                                 | A fix turn lowered the score more often than it raised it (5 to 4, 6 to 5, 6.5 to 4) and raised it in only a few of about 14, at the cost of a call, a render and a verification (about 25 s). It now runs only on a best candidate that would be rejected.                                                                                                                                                                                                                                  |
| The brief writer's reply cap raised from 700 to 1500 tokens                                                                       | 1 reply in 14 was cut off before its JSON ended (the model spends 500-700 tokens on a 120-token answer), which failed a job.                                                                                                                                                                                                                                                                                                                                                                 |
| Systematic complaints fed back into the brief writer and the candidate nudges                                                     | Garments on a skull-headed skeleton cannot show, a second colour on the hydra or a four-legged animal does not take (the heads and the body come out one colour), a fur cape the colour of the skin vanishes, and a long weapon in an attack pose clipped the frame (3 of 30 candidates flagged, scoring 0). The prompt now says so, and the nudges say "keep everything well inside the frame". Plain four-legged animals scored 5 every time (the committed lion too) and are discouraged. |

### What was run live (24 Oct 2026, from the UK)

Ten full jobs through the built app (`next start`: the real routes with `after()`), real Mubit, a real Vercel Sandbox VM per candidate from the pinned snapshot (Bun 1.4.4), the real Blob store under `creatures-dev/`, three candidates a job, each as a different visitor. **8 of 10 accepted.**

| Jobs                                                                  | Accepted |
| --------------------------------------------------------------------- | -------- |
| 1-3 (builder-aimed briefs, three candidates)                          | 2 of 3   |
| 4-8 (after one-colour and plain-animal guidance)                      | 4 of 5   |
| 9-10 (after the nudges were changed to keep weapons inside the frame) | 2 of 2   |

Accepted, with the winning score: Daughter of Charybdis 6, Empusa of the Shallows 6, Centaur of the Deep 8, Hydra of the Sponge Caves 6.5, Phorcys the Old 8, Graia the Grey Sister 7, Silverfoot Nereid 6.5, Gorgon of the Wreck 6. Rejected: Echidna's Whelp (a hydra in two colours: 5, 5, 5, fix 4) and Lion of Thetis (a plain lion: 5, 5, 5, fix 5).

Per job: **8.1 Mubit calls on average** (brief 1, generators 3, verifiers 1-5 including borderline double takes, a fix 0-1; no retries), and **about 40 s** from the first step to the last (28-59 s; the client saw 33-64 s). One step in the middle: the brief writer about 10 s, the three generators together 3-9 s, the three renders 2-5 s, the verifiers 12-25 s (several in parallel), a fix turn 12-16 s. That is a quarter of the 270 s the job allows itself. 3 of the 30 candidates were engine-flagged (clipped) and cost no verifier call.

For the first time an accepted job's last steps ran live: the sprite and record were stored in Blob, the job went `done`, and `GET /api/creatures/:id/sprite.png` served them. A job on the Vercel preview deployment was accepted too (a 6 in 59 s), which shows the platform's OIDC works inside `after()` and that the traced files are there.

## Vercel Sandbox

### Measurements

Setup: `@vercel/sandbox` 3.9.0, the default image `vercel/sandbox/universal` (digest `sha256:3190aee7b741…`: bun 1.4.4, Linux 6.18 x86_64, "Intel Xeon Processor @ 2.90GHz"), region `iad1`, 1 vCPU / 2 GB unless noted, `networkPolicy: "deny-all"`, `persistent: false`. The VM runs `render/runner.ts` (then called `run_local.ts`) and its shims; the kit and runner (4 files, 216 KB) were uploaded with `writeFiles` (the renderer now boots from a snapshot instead). Three repetitions each, timed from the UK, so every SDK call crosses the Atlantic (old kit).

**VM lifecycle (ms):**

| step                                              | rep 1 / 2 / 3      |
| ------------------------------------------------- | ------------------ |
| `Sandbox.create` (default image)                  | 322 / 241 / 256    |
| first command (`true`)                            | 155 / 219 / 173    |
| upload kit + runner                               | 207 / 282 / 321    |
| `stop()`                                          | 1255 / 1264 / 1208 |
| `snapshot()` of a VM with kit + runner (1 sample) | 1637               |
| `Sandbox.create` from that snapshot               | 1086 / 1967 / 994  |
| first command after it                            | 243 / 190 / 230    |
| `delete()` on a running VM                        | 211 / 265 / 175    |

**One fresh VM per render** (create, upload kit + runner + build, run, read the PNG, `stop()`), end to end in ms:

| sprite   | default image      | in-VM             | from a snapshot     |
| -------- | ------------------ | ----------------- | ------------------- |
| lamp-lit | 2731 / 3351 / 2619 | 235 / 434 / 237   | 3403 / 4387 / 3217  |
| house    | 2786 / 2751 / 2731 | 384 / 355 / 365   | 3617 / 4506 / 4627  |
| temple   | 3986 / 4082 / 3914 | 1351 / 577 / 1551 | 7065 / 5948 / 4142  |
| satyr    | 3101 / 3561 / 3518 | 624 / 904 / 679   | 11374 / 3450 / 4939 |
| olive    | 3310 / 3105 / 3041 | 805 / 411 / 555   | 3535 / 4374 / 7095  |

Cumulative time from the start of `create` (lamp-lit, `iad1`): VM created 217-364 ms, kit + runner uploaded 496-718 ms, PNG in hand 1442-1969 ms, after `stop()` 2663-3166 ms. In `lhr1` the same steps took about twice as long.

Five candidates at once (lamp-lit, house, temple, satyr and olive, each in its own fresh VM): 3863 / 4181 / 4264 ms wall; each sprite took 2.6-4.3 s, as when run one at a time. The larger series (10, 25 and 50 at once, faster kit) is under "Parallelism and grouping".

What the numbers say:
- The render is no longer the cost. To the PNG it is 1.4-2.4 s per candidate from a fresh VM, against 10-107 s on Shotcup with the old kit (removed). About 0.5-0.8 s of that is create + upload, and about 0.3-0.45 s per `runCommand` is bun starting and transpiling the kit plus the round trip.
- bun in the VM is 2-5x slower than this Mac for the same render (1 vCPU: lamp-lit 157-262 ms against 50 ms; temple 586-702 ms against 300 ms), and the first render in a fresh VM is slower again. A second vCPU roughly halved the in-VM time but saved only about 0.1-0.3 s of the round trip.
- Snapshots don't pay here: creating from one took 1.0-2.0 s, more than creating from the default image and uploading the 216 KB (0.5-0.8 s together). They would pay if the runner needed an install step.
- `lhr1` was slower from the UK than `iad1`: create and upload took about twice as long. Keep the sandbox region next to the route.
- `stop()` takes 1.2-1.3 s in `iad1`. A route can return the PNG before it stops the VM.

### Pixel identity

90 renders (the five sprites in warm VMs at 1 and 2 vCPUs, in fresh VMs from the image and from a snapshot, in `iad1` and `lhr1`, in parallel), then 86 more in the parallelism series with the faster kit, decode to exactly the pixels of the committed `public/sprites/*.png`, and the PNG files are byte-identical too, because the VM runs the same encoder (`render/shim_canvas.ts`, `node:zlib`). bun 1.4.4 on x86_64 in the VM and bun 1.4.3 on arm64 locally made no difference for these sprites. The TypeScript renderer was also run on its own: `lamp-lit`, `house`, `satyr` and the hero frame `male_walk3` come back byte-identical to the committed PNGs (the three sprites took 2.8-3.2 s wall each, including bun's start, from the UK), and a build that throws comes back as `vercel sandbox: exit 1: error: boom from build`. A change of the image (which brings its own bun) or of the kit should be re-checked the same way.

### Probes

Harmless probes, run as build code through the same runner and settings as `render-vercel-sandbox.ts` (1 vCPU, `deny-all`, only `KIT_OUT` passed to the command). The probe build reached `process` and `Bun` through `[].constructor.constructor('return this')()` with string-built names, which is what gets past the banned-identifier tripwire, so everything below is what model code could do.

| question                         | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment variables            | `PATH`, `HOME`, `LANG`, `SHELL`, `KIT_OUT` and the CA-bundle variables of the image (`AWS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and the like). PID 1's environment has the same keys. No Vercel token or other secret: the SDK credential stays with the caller and nothing is passed in.                                                                                                                                                                                                                                |
| Privileges                       | The build runs as `ubuntu` (uid 1000), a member of `sudo` with passwordless sudo, so it is root in its VM. It can write the kit and the runner, spawn processes, and reach the VM's init socket `/run/vercel/share/init.sock` (owned by `ubuntu`; not probed further). Run as a separate user made with `sandbox.createUser("builder")`, the same probe got "a password is required" from sudo, `Permission denied` on `/proc/1/environ`, `/root` and `/run/vercel/share`, and a read-only kit.                                                         |
| Files outside its directory      | It sees an ordinary Ubuntu filesystem: `/etc/passwd` (19 lines), the image's tooling under `/vercel`, an empty `/root`. Nothing of ours except the uploaded kit, runner and build.                                                                                                                                                                                                                                                                                                                                                                      |
| Network                          | With `deny-all`: `getent hosts example.com` got no answer, `curl https://example.com/` "Could not resolve host", `curl http://1.1.1.1/` timed out after 5 s, `curl http://169.254.169.254/` could not connect, and bun's `fetch('https://example.com/')` failed with `EAI_AGAIN`. The same probe in a control VM with the default `allow-all` resolved DNS and got 200 from example.com, 301 from 1.1.1.1 and 200 from `fetch`, so the probes do detect egress. The metadata address was unreachable in both. I did not try to lift the policy as root. |
| Infinite loop                    | `while (true) {}` with `runCommand({timeoutMs: 5000})`: SIGKILL (exit 137) at 5.2 s. The VM stayed usable. The renderer gives each render 30 s, and the session `timeout` (2 minutes in the renderer) caps the whole VM.                                                                                                                                                                                                                                                                                                                                |
| Memory                           | Growing `Float64Array`s: the memory cgroup's OOM killer ended bun (exit 137) after 1.0-1.5 s at 2.09 GB resident (1 vCPU = 2 GB). The VM stayed usable.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Leftovers for the next candidate | In a reused VM a build could change the kit or the runner or leave a background process behind. Hence one VM per candidate; if VMs are ever reused, run each build as its own non-sudo user (tested above) and start from a clean job directory.                                                                                                                                                                                                                                                                                                        |

### Cost

Documented Pro rates in `iad1` ([pricing](https://vercel.com/docs/vercel-sandbox/pricing), read 24 Oct 2026): active CPU $0.128/h, provisioned memory $0.0212/GB-h billed in 1-minute minimum increments, creations $0.60 per million, data transfer included in the Pro flat-rate CDN, snapshot storage $0.08/GB-month; Pro usage draws first on the plan's $20 monthly credit. Hobby includes 5 h of active CPU, 420 GB-h of memory and 5,000 creations a month. The team here is on Pro.

Usage of one fresh-VM render, from the SDK's own fields (lamp-lit and temple, 3 each): 1.8-3.7 s duration, 1.5-3.5 s active CPU, 2 GB, 17-24 KB out and 76 KB in. At list rates that is about $0.0007 of memory (the 1-minute minimum of 2 GB dominates), $0.00005-0.00013 of CPU and $0.0000006 for the creation: **about $0.0008 per candidate**, or about $1.60 for 1,000 sprites with one fix each. The 86 renders of the parallelism series cost about $0.07. A warm VM spread over many renders is cheaper per render (15 renders on 1 vCPU used 7.7 s of active CPU in 15.4 s), but it keeps 2 GB billed while it waits and needs the per-build user hygiene above. These are list prices times measured usage, not a bill.

## Pixel scaling

The runner used to write a second image per render, `<name>_x4.png`: the 128 px sprite magnified 4× onto the verifier's
backdrop. Nothing read it: the verifier's picture comes from `verifier-image.ts`, which magnifies the 128 px PNG on the
host, and every renderer reads only `<name>.png`. Its pixels matched the verifier's image exactly (262,144 of 262,144 for
lamp-lit, house, satyr, temple and a hero frame). So the copy is gone, along with the `KIT_X4` switch and the measurement
script that timed it.

What it cost before it went (10 renders per sprite through `renderLocally`, medians, Apple silicon):

| sprite     | with the ×4 (ms) | without (ms) | the copy cost (ms) | share of the render |
| ---------- | ---------------- | ------------ | ------------------ | ------------------- |
| lamp-lit   | 53.4             | 43.9         | 9.5                | 18%                 |
| house      | 73.5             | 59.5         | 14.0               | 19%                 |
| satyr      | 87.5             | 72.2         | 15.3               | 18%                 |
| temple     | 129.7            | 116.9        | 12.8               | 10%                 |
| hero idle1 | 97.8             | 84.5         | 13.3               | 14%                 |

Under load the saving was 13-38 ms a render. In a sandbox it cost VM time only (the file never left the VM), estimated at
25-65 ms a render.

The same investigation measured the game's side of this question (the browser scaling, not the renderer): see
`docs/ARCHITECTURE.md`, "Pixel scaling".

## Not verified

- The batch driver under load from several creatures at once in a deployed function: batches were run from a laptop only.
- Vercel duration limits are quoted from Vercel's documentation: the creature route ran locally (`next start`) and, once, on a preview deployment (a job accepted in 59 s, which shows the sandbox's OIDC authentication works inside `after()`). A job near the 270 s budget has not been seen anywhere. All Vercel Sandbox timings are from a client in the UK; a function in `iad1` next to the VMs should save part of each SDK round trip, by an amount not measured.
- Whether `delete()` (0.18-0.27 s) ends a running Vercel session and its billing as `stop()` does: a deleted sandbox disappears from listings and its session returns 404, so I could not read its final state. The renderer uses `stop()`.
- Root in the Vercel VM against the network policy and the init socket: the probes ran with sudo available and stayed offline, but I did not try to change the policy or talk to `/run/vercel/share/init.sock`.
- The Vercel bill for these runs: the costs above are list prices times measured usage.
- Kit speed-ups were checked on the 58 committed sprites and hero frames, not on model-written sprites: the changes are exact by construction, but a build whose shape returns NaN could order the shadow march differently (the nearest-part-first step), the one case the argument doesn't cover.
- Prompt caching for the verifier prompt and the fix turn, and the cache behaviour of parallel first calls: only two generator calls were sent.
