# The live director

After every night a player plays, that night's data goes to Mubit, and the model answers with bounded balance tweaks for
that player's next night. The next night's recording says which decision it was played under, and the model sees how its
last decision played out, so each night corrects the next. The loop is logged and visible.

It exists because the difficulty curve was tuned on a bot (24 to 31 kills a minute) and nine recorded nights from three
people (4 to 9 kills a minute) lost night 2 every time: monsters pile up, the lamps go dark with the warden a hundred
or two hundred pixels away, health collapses in crowds.

Nothing here is needed to play. With no key, no network, a rate limit or a slow model, the night is the rules' night.

## What the model may change

`legacy.director` (`src/game/director.ts`), one night at a time:

| field                     | bound                                        | what it does                                                                     |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `tide`                    | within 0.15 of the tide the rules would pick | spawn pace and the cap on monsters alive (`sim.ts`: `spawnInterval`, `maxAlive`) |
| `mix.satyr/cyclops/harpy` | each 0.5 to 2                                | multiplies the spawner's weight for that kind in `pickKind`                      |
| `creatureShare`           | 0.1 to 0.4 (the old fixed share was 0.25)    | the share of spawns that are the night's creature from the sea                   |
| `line`                    | at most 90 characters, plain text            | the sea's answer on the dawn and heir panels                                     |

Also stored: `source` (`"mubit"` or `"rules"`), `rulesTide` (what the rules picked; the bound is checked against it),
`decidedAfterNight`, and `playId` (the recording the decision answers). The model's `reasoning` (one short sentence) is
logged, never stored in the legacy and never shown.

The bounds are enforced in code, not asked of the model: `clampProposal` (server, on the model's reply), `checkedDecision`
(the game, on what the route sent, against the rules' tide the game computed itself), `directorFrom` (loading a save or a
recording: anything that does not validate is the rules'), and `directorSchema`. The line is cut to whitelisted
characters (letters of any script, digits, spaces, `.,;:!?'’-–—…()`), so there is no markup, no link and no quote.

`newNight` reads the tide from `legacy.tide` as before (applying a decision sets it, and loading checks it equals the
decision's), the mix and share from `legacy.director`. The legacy is recorded with the play, so a replay builds the same
night. A play from before the director has none, and replays as it always did (the rules' director is an even mix and
the share 0.25, which draw exactly the same random numbers).

## The loop

1. The night ends. `endNight` (Game.tsx) records and uploads the play, sets the rules' decision as the coming night's
   (`setRulesDirector`), and, once the upload is done, calls `POST /api/director {playId}`.
2. The dawn or heir panel is up. If the answer arrives while it is, `applyDirector` replaces the rules' decision and the
   panel shows the sea's line in place of the tide note. Starting the next night aborts the request: a late answer is
   ignored (and `applyDirector` refuses it anyway: it must answer the play the rules' decision waits on).
3. The next night is played under it, and its recording carries it.
4. That night's call tells the model its previous decision (from the recording, validated again), what it wrote about
   it (from the log of the play that decision answered).

## The route

`src/app/api/director/route.ts` (Node, `maxDuration` 30), `src/server/director/service.ts` (everything injected).
- The body is `{playId}` only. The server reads the play from the plays store (a few looks, 700 ms apart, in case the
  blob is a moment late) and builds the summary from it (`summary.ts`): night, tide, trait and upgrade levels, creature,
  outcome and length, kills and kills a minute, when each lamp went dark (from the timeline), health lost and lowest,
  the crowd (peak, and at 15 s), a sample every 5 s, the previous decision, and what the rules would decide. Positions are
  not in a recording, so "how far the warden was from the lamp" cannot be told.
- One Mubit call to `https://api.mubit.ai/anthropic/v1/messages`, `claude-opus-5-5`, no temperature, the key from the
  environment, the system prompt `pipeline/prompts/director.md` (identical every call, with `cache_control`), the play's
  random session id as `metadata.user_id`, 8 s and no retry (`createMubitClient({requestTimeoutMilliseconds, retry:
  false})`).
- The reply is JSON; it is validated (`parseProposal`) and clamped. On a timeout, an error, a rate limit from Mubit,
  invalid JSON, or a reply with no line, the route answers `{decision (the rules'), fallback}` with `source: "rules"`.
  Only a play it cannot find is an HTTP error (404), which the game treats the same.
- Asking again about a play the model decided returns the logged decision and calls nothing (a play whose call fell back
  is asked again, and costs a limit mark each time). Two calls at once for one play both reach the model, but the first
  decision logged stands. The model is shown its earlier reasoning only from a log of the same session.
- The whole decision has a 20 s deadline after the play is read; past it the rules answer.
- Limits: 40 calls per visitor per hour and 2000 per UTC day, by the same salted IP hash the creature routes use
  (`DIRECTOR_RATE_SALT`, else `CREATURE_RATE_SALT`, at least 16 characters; without a salt the model is off).
  `DIRECTOR_MAX_CALLS_PER_VISITOR_PER_HOUR`, `DIRECTOR_MAX_CALLS_PER_DAY`.
- Logging: each decision is one blob, `<DIRECTOR_BLOB_PREFIX, default director>/decisions/<playId>.json`: the summary the
  model was told, the decision, the reasoning, the source and fallback reason, the Mubit request id
  (`x-middleware-request-id`), tokens and cache numbers, a hash of the prompt, and the time spent per stage. The same
  fields go to the function's log as a `director-decision` line. Nothing personal: the play's random session id, numbers,
  and the model's own words. `DIRECTOR_PLAYS_PREFIX` (default `plays`) moves the plays it reads, for a test run.

## Live run

(Run under the first reply shape, V1; the default is now V2, see "Latency by reply shape".)

On 24 Oct 2026 the route ran locally (`next start`) against real Mubit and the real private Blob store (under
the prefix `director-dev`, which still holds the test plays and decisions), with the nine recorded plays, and a chain: a play's decision put
into the legacy of the next fixture play, and that play asked about in turn. Each chain step is a real timeline with
the earlier decision (and its tide) substituted, since no human played under a decision yet.

| call            | night, outcome | tide played | kills / lamps lit / health left | decision (tide vs rules', mix satyr/cyclops/harpy, share) | the sea says                                                                       | model | cache read |
| --------------- | -------------- | ----------- | ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----- | ---------- |
| play 1          | 1, dark        | 1           | 2 / 0 / 84                      | 0.72 (0.85), 1 / 0.6 / 0.7, 0.25                          | The sea lets out a long breath and drifts back from the harbour stones of Lychnos. | 6.2 s | 0          |
| play 2          | 1, dawn        | 0.85        | 11 / 4 / 100                    | 1.02 (0.94), 1 / 1 / 1.1, 0.25                            | Beneath the harbour of Lychnos the water stirs and will not settle.                | 4.7 s | 3026       |
| play 3          | 1, dawn        | 1           | 15 / 5 / 64                     | 1.05 (1), 1 / 0.9 / 1, 0.25                               | Beyond the breakwater of Lychnos, the swell begins to stir and gather.             | 5.5 s | 3026       |
| play 4          | 1, dawn        | 1           | 14 / 5 / 70                     | 1.18 (1.1), 1 / 1 / 1.1, 0.25                             | The swell gathers its breath beyond the harbour wall of Lychnos.                   | 5.4 s | 3026       |
| play 5          | 2, dark        | 1.1         | 2 / 0 / 38                      | 0.79 (0.94), 1 / 0.6 / 0.7, 0.25                          | The sea draws back its hand, and the lamps of Lychnos may yet hold.                | 6.1 s | 3026       |
| play 6          | 1, abandoned   | 0.94        | 1 / 5 / 92                      | 0.8 (0.8), 1 / 1 / 1, 0.25                                | The sea waits at the harbour mouth, unhurried, watching the lamps of Lychnos.      | 4.5 s | 3026       |
| play 7          | 2, abandoned   | 1           | 0 / 5 / 100                     | 0.85 (0.85), 1 / 1 / 1, 0.25                              | The sea waits at the harbour mouth, unsure of the one who keeps the lamps.         | 3.8 s | 3026       |
| play 8          | 2, abandoned   | 1           | 11 / 5 / 40                     | 0.85 (0.85), 1 / 0.75 / 1, 0.25                           | The swell hesitates off Lychnos, as if weighing how hard to strike.                | 6.5 s | 3026       |
| play 9          | 2, dark        | 1           | 4 / 0 / 20                      | 0.75 (0.85), 1 / 0.6 / 0.8, 0.25                          | The sea pulls its long breath back, and the lamps of Lychnos steady.               | 6.4 s | 3026       |
| chain A, step 2 | 2, dark        | 1.18        | 2 / 0 / 38                      | 0.85 (1), 1 / 0.6 / 0.6, 0.25                             | The sea lets go of the harbour stones, and Lychnos hears only the gulls.           | 6.5 s | 3026       |
| chain A, step 3 | 1, dawn        | 0.85        | 15 / 5 / 64                     | 0.93 (0.85), 1 / 0.8 / 0.9, 0.25                          | The swell stirs again beneath the harbour wall, and Lychnos feels it breathe.      | 5.9 s | 3026       |
| chain B, step 2 | 2, dark        | 1.05        | 4 / 0 / 20                      | 0.76 (0.89), 1 / 0.6 / 0.8, 0.25                          | The sea lets out its breath, and the harbour of Lychnos rests awhile.              | 6.2 s | 3026       |

Chain A: play 4 (a clean dawn on night 1) was pushed to 1.18; play 5 (night 2) lost anyway ("My push failed: ... all five
lamps went dark by 18 s with none relit and six monsters alive at 15 s"), so the next decision eased to 0.85 with
cyclops and harpies at 0.6; play 3 under that came out a clean dawn ("My easing worked: ... Night two broke this line
before, so I push only gently") and the decision went back up to 0.93 with the mix nearly even. Chain B was the same
correction after a push.

Latency: 3.8 to 6.5 s in the model, 5.4 to 8.0 s through the route (about 0.1 s to read the play, 0.5 to 1.0 s for the
limits' listing and the marks, the rest the model). The first call wrote the prompt into the cache (3026 tokens), every
later one read it. One earlier call of a first run took 39 s through the route with the model at 4.5 s: a stall in Blob,
which is why the whole decision now has a deadline.

## Balance with stub decisions

`bun scripts/balance.ts 100 --director` replaces the model with fixed decisions on the same seeded nights: "eased"
(tide 0.15 under the rules', cyclops and harpies 0.5, share 0.1), "pushed" (0.15 over, cyclops and harpies 2, share 0.4)
and each half alone. "Novice" is the bot with a 450 ms reaction and no bow (it kills 15 to 20 a minute, which is still
more than people do); "bot" is the usual one. Dawn rate, rules against eased against pushed:

| warden | night (rules' tide) | rules | eased | pushed | eased, tide only | pushed, tide only | eased, mix only | pushed, mix only |
| ------ | ------------------- | ----- | ----- | ------ | ---------------- | ----------------- | --------------- | ---------------- |
| novice | 1 (1)               | 35%   | 34%   | 32%    | 41%              | 39%               | 34%             | 42%              |
| novice | 2 (1)               | 17%   | 32%   | 16%    | 26%              | 24%               | 21%             | 25%              |
| novice | 3 (1.1)             | 3%    | 6%    | 0%     | 8%               | 1%                | 4%              | 1%               |
| bot    | 3 (1.1)             | 100%  | 100%  | 97%    | 100%             | 99%               | 100%            | 100%             |
| bot    | 5 (1.2)             | 31%   | 82%   | 4%     | 68%              | 11%               | 62%             | 28%              |

The bounds are wide enough to matter where a warden is near the edge (bot, night 5: 4% to 82%; novice, night 2: pushing
makes him fall in 27% of nights against 6%) and do little far from it. A mix that cuts cyclops and harpies mostly moves
losses from "fallen" to "dark" for the novice: fewer heavy claws, but the satyrs left still snuff lamps.

## Latency by reply shape

Measured on 24 Oct 2026 for the owner's choice between a longer timeout and a shorter reply. Three system prompt
variants, the real service and Mubit client (`claude-opus-5-5`, prompt cached), an in-memory store, a 30 s timeout so slow
calls are measured, not cut off. Each ran the nine recorded plays and the two chains (A: play 4, then play 5 and play 3
each under the decision before it; B: play 3, then play 9), twice: 24 calls a variant, 72 in all. The chains use each
variant's own earlier decisions. (A first attempt hit Mubit's gateway answering 503 `engine_unavailable`; it was retried
until the gateway answered, and no call of the 72 failed.)
- **V1**, the first reply shape: reasoning (two sentences), expected effect, decision, line.
- **V2**, now the default: one sentence of reasoning (at most 20 words), decision, line. No expected effect.
- **V3**: decision and line only.

| variant | model median | p90   | max   | mean  | output tokens (median) | cache hits | over 8 s |
| ------- | ------------ | ----- | ----- | ----- | ---------------------- | ---------- | -------- |
| V1      | 5.7 s        | 6.5 s | 6.7 s | 5.5 s | 469                    | 23 of 24   | 0 of 24  |
| V2      | 4.2 s        | 5.4 s | 5.6 s | 4.3 s | 333                    | 23 of 24   | 0 of 24  |
| V3      | 3.8 s        | 4.4 s | 7.4 s | 4.0 s | 300                    | 23 of 24   | 0 of 24  |

The route adds about 0.5 to 1.0 s (the limits' listing, the marks, reading the play) measured in the earlier live run;
with the in-memory store that is not in these numbers. V3's reply is about 160 characters of JSON, some 50 tokens, yet
it reports about 300 output tokens: most of the output is not in the reply (the model's own reasoning, probably), so
shortening the reply stops paying below V2. V3's one 7.4 s call shows the floor is not a ceiling.

**Agreement with V1** (nine plays, twice, compared on the same run; V1's own run 1 against run 2 is the noise floor):

| compared          | tide within 0.05 | tide direction | mix direction | mean tide difference |
| ----------------- | ---------------- | -------------- | ------------- | -------------------- |
| V1 run 1 vs run 2 | 16 of 18         | 18 of 18       | 18 of 18      | 0.008                |
| V2 vs V1          | 17 of 18         | 17 of 18       | 18 of 18      | 0.009                |
| V3 vs V1          | 17 of 18         | 18 of 18       | 18 of 18      | 0.006                |

The one case outside 0.05 is play 4, a clean dawn the rules pushed to 1.1: V1 said 1.15 once and 1.20 once, V2 and V3 said
1.15. That is V1's own spread. The lines are in voice, at most 90 characters, and agree with the direction (easing:
"draws back", "lets the harbour rest"; pushing: "the swell stirs, curious about the one who keeps the lamps"), but all
three variants reuse that last phrase across the pushed plays.

**The correction loop**, judged by the numbers alone (tide against the rules' tide): in both runs of each variant,
chain A and B step 2 eased after the failed push (-0.13 to -0.15, mix load -0.5 to -0.7) and chain A step 3 pushed after
the successful ease (+0.04 to +0.08, with the mix still trimmed). V3 does it as well as V1. V2's one sentence still reads as
a correction every time: "Last push failed: lamps fell by 14 seconds with health spare, no relights; ease fully, fewer
fast snuffers." / "My push failed: every lamp went dark by 18 seconds with health left, so ease the pace and the snuffers." /
"Easing worked: clean dawn, all lamps lit, health 64, fast kills; push gently into a riskier night two." V3 has the
numbers but no words to show for them, which is what the demo needs.

**Decision (owner, 24 Oct 2026): V2 is the default, and the model's timeout stays 8 s.** None of the 72 calls took longer
than 7.4 s, and V2's slowest was 5.6 s. V2 saves 1.5 s at the median and 29% of the output against V1, agrees with V1
within V1's own noise, and keeps a stored sentence that the correction loop and the demo can show ("my push failed").
V3 was only 0.4 s faster at the median, no faster at the maximum, and loses the visible correction. V2 drops
`expectedEffect`: the system prompt (`pipeline/prompts/director.md`, "How to answer") no longer asks for it, the reply
schema ignores it if a reply still has it, the log does not write it (a log written under V1 still loads, and its
`expectedEffect` is simply not shown to the model), and the next night's call has no `whatYouExpected`; it carries
`yourReasoning`, the one sentence, for the same session only. The prompt is one fixed text, so every call is one Mubit task.

**Live check of the new default** (four calls through the real route, the real Blob store under `director-dev/run3`):
play 4 (a clean night-1 dawn) pushed to 1.15 ("Clean dawn, all lamps lit, 70 health, brisk kills; rules set it, so push
slightly into night two."); play 5 played under that decision, lost, and the next decision eased to 0.84 with the mix
cut ("My push failed: all five lamps went dark by eighteen seconds with health left, so ease hard and thin snuffers.");
play 3 played under that came out a clean dawn and the next pushed to 0.89 ("Easing worked: clean dawn, five lamps lit,
health 64, fast kills; push gently, wary of the last night two."); and play 5 alone eased to 0.80. The reasoning was
18 to 20 words every time, no log carries an `expectedEffect`, and each chain step's summary carried the model's own
earlier sentence as `yourReasoning`. Model time 4.1 to 6.6 s (cache read 2927 tokens from the second call), 5.6 to 8.0 s
through the route. (The chain's third step is play 3 with its session set to the chain's, since the model reads its
earlier reasoning only from the same session.)

## Not done, or to watch

- A play's positions are not recorded, so the model cannot be told how far the warden was from a lamp when it went dark.
  Replaying the play would give it, but a recording only replays on the build that made it.
- The play is uploaded by the client, so its `legacy.director` (the previous decision) is client-supplied. It is validated
  and clamped before it reaches the model and only ever shown to the model as data (the prompt says so), and the model's
  output reaches players only as the clamped, plain, 90-character line.
- Two calls at the same moment can both pass the limit check (the marks are counted, not locked), as the creature
  routes' do.
- The model call has 8 s; the slowest of the live run took 6.5 s, and none of 72 calls in the latency measurement above
  took longer than 7.4 s. If production latency is higher, calls fall back to the rules and the loop goes quiet. The two
  levers are a shorter reply (see "Latency by reply shape") and `MODEL_TIMEOUT_MILLISECONDS` in
  `src/server/director/config.ts`.
