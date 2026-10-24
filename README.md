# Lampwarden

<img src="public/logo/logo.png" alt="Lampwarden" width="204">

A night-defence roguelite in Lychnos, a Greek harbour town. Each night the sea sends creatures to put out the town's lamps; you strike them down, relight the lamps and keep one burning until dawn. When a warden falls, an heir takes up the lamp. The sprites are code written by a model through Mubit, then rendered, judged and corrected.

```bash
bun install && bun run dev
```

Opens at http://localhost:3000. Live at https://lampwarden.vercel.app (it may lag behind `main`). Built at [Night Shift](https://luma.com/nightshift-london), Mubit's hackathon in London, 24–25 October 2026.

## Play

Next.js 16 (App Router), React 19 and Pixi 8 through `@pixi/react`, run with Bun. The numbers below are read from `src/game/`.
1. **The night.** Five lamps ring the plaza. Night 1 lasts 40 s and each later night 6 s more, up to 76 s from night 7. Satyrs and harpies come out of the sea, cyclops from night 2, and each night monsters move 5% faster. They go for the nearest lit lamp and claw it out; lit lamps slow them to 70% of their speed. A monster that gets within reach of the warden turns on him.
2. **Hits.** The warden has 100 health. A monster's blow wounds him, throws him back, flashes him white then red, pulses a red vignette and shakes the screen; he cannot be wounded again for 0.5 s. His own strike reaches the 120 degrees in front of him and stuns and throws back every monster it hits (a shot does less); a cyclops, being heavy, is thrown less far than a harpy. He faces one of eight directions, and the strike and any keyboard shot follow it.
3. **Relighting.** Stand beside a dark lamp for a second to relight it. A night is lost when every lamp is dark or the warden falls.
4. **Dawn.** Survive the timer and the sun burns the stragglers away. A kill leaves oil 30% of the time (one for a satyr or harpy, two for a cyclops), and dawn pays 2 oil plus 1 for each lamp still burning.
5. **The shop.** After every night it offers three upgrades drawn from nine: brighter wicks, a keener blade, a deeper quiver, a warden's heart, thick hide, heavy blows, an oil seeker, quick tinder and light sandals. Each has three levels, costing 12, 26 and 45 oil. Offers come from a seed saved with the legacy, so a reload does not reroll them. Everything but thick hide outlives the warden.
6. **Heirs and traits.** When the warden falls the line restarts from night 1, keeping oil and upgrades (not thick hide), and you pick one of three heirs, each with a trait: swift, stout, lamplighter, long-armed or keen-eyed. The son fights with a sword and bow, the daughter with a spear and sling; the rules are the same and you choose which on the title screen.
7. **The tide.** A director reads each night (kills per minute, lamps lost, health kept) and sets the next night's tide between 0.6 and 2: calm, restless, rising or raging. A clean dawn raises it, a lost night lowers it; it scales how often monsters spawn and how many are alive at once. Nothing is asked of the player.
8. **Creatures from the sea.** Before each night the title screen and the dawn and heir panels announce "Tonight the sea sends…" with the newest creature from a shared gallery that this player has not met, or say that one is still being made. The night never waits for it. From 8 s in, about a quarter of the spawns are that creature, at most two at once. Its stats come from an archetype (skulker, brute or flyer, playing like the satyr, cyclops or harpy) and four modifiers of -1, 0 or 1, never from numbers the model wrote.

Progress (generation, night, oil, upgrades, tide, the creatures met) is saved in `localStorage`.

### Controls

|        | Keyboard and mouse                                 | Gamepad                                                                   | Touch                                    |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| Move   | W A S D or the arrow keys                          | Left stick or d-pad, in eight directions                                  | The on-screen stick, in eight directions |
| Strike | J or Space; hold a direction to turn               | A                                                                         | The Strike button                        |
| Shoot  | K along the way he faces; click towards the cursor | B, X, right trigger or right bumper; the right stick aims                 | The Shoot button, at the nearest monster |
| Menus  | Click                                              | D-pad or left stick moves focus, A presses, Start presses the main button | Tap                                      |

A pad rumbles when the warden is wounded. Without the right stick held, a pad's shot goes to the nearest monster.

## How the sprites are made

```
brief → generator → build(k) code → render → verifier → one fix → best-of
```

The kit in `pipeline/kit/` is a small isometric renderer and a set of builders (humanoids, beasts, props, buildings). A model, Opus through [Mubit](https://mubit.ai), is given the kit's API and a brief and writes one function, `build(k)`. That code is run only by a renderer: a subprocess with an allowlisted environment, or a sandbox (Vercel Sandbox, Shotcup or boat.dev). Four engine checks (clipped at the edge, too small, too big, too short) score a sprite 0 without a model call. Otherwise a second model call sees the sprite magnified 4 times and returns a score, issues and a fix; 7 passes, and a score of 6 or 7 is judged twice and averaged. If it did not pass, one fix call sends the issues back, and the higher-scoring attempt is kept.

Hard rules: every Mubit call goes to `https://api.mubit.ai/anthropic/v1/messages` with model `claude-opus-5-5` and never sends `temperature`. Pixel art is made by code in this repository. The Mubit console's Good/Bad button rates one output and does not feed this loop; the verifier does.

```bash
export MUBIT_API_KEY=...   # from the environment only
bun run assets -- "Ionic marble column"
```

This writes the PNG, its builder code and a row in `public/sprites/manifest.json`. The sprites in `public/sprites/` come from earlier runs of the same loop, except the temple, house, lamp, wall and stall, which are hand-written calls to the building builders, and the hero's frames, which are deterministic builder code with no model call. Several Mubit sprites scored under the pass mark (lion 5, hydra 5, cyclops 5.5, zeus-statue 6, harpy 6, satyr 6.5); the scores are in the manifest. Details: [`pipeline/README.md`](pipeline/README.md).

### Live creatures

`POST /api/creatures/next` (`src/app/api/creatures/`) returns the newest gallery creature the player has not met. If there is none, it starts a job, or joins the one already running, and the game follows it at `GET /api/creatures/jobs/:jobId`; `GET /api/creatures/:id/sprite.png` serves a sprite. A job runs the loop above after the response has gone out:
- one Mubit call writes the creature (name, lore, sprite brief, archetype, modifiers), validated by the contract in `src/game/creature.ts`;
- three candidates are drawn from that brief (`CREATURE_CANDIDATES`, at most 5), each rendered in its own Vercel Sandbox booted from a pinned snapshot, with no network;
- the verifier judges each; a fix turn runs only if the best is not already accepted;
- a creature is accepted on a verifier pass, or on a score of at least 6 with no engine flag, and is then stored in a private Vercel Blob store, so every player draws from one gallery. Anything else fails and stores nothing.

Starting a job is rate limited, to 3 an hour per visitor (a salted hash of the address, never stored) and 40 a UTC day for the site; reading the gallery is not. Only one job runs at a time. Measured on 24 October 2026, 8 of 10 jobs were accepted, in about 40 s each. Design, limits and measurements: [`docs/LIVE_GENERATION.md`](docs/LIVE_GENERATION.md).

Not on `main`: rendering in-process with QuickJS in WebAssembly is an open proposal ([#33](https://github.com/frostney/lampwarden/pull/33)), and drawing creatures as code in the browser is still being built.

## Night Shift and Mubit

Night Shift's brief: build a product that routes its LLM calls through Mubit and turns corrections into model updates for a recurring task. Lampwarden's recurring task is making game art: every sprite is written as code by a model, rendered, judged and corrected, the same way each time.
- **Every model call goes through Mubit**: `https://api.mubit.ai/anthropic/v1/messages`, model `claude-opus-5-5`, no temperature (`pipeline/mubit.ts`). Each call carries an anonymous session in `metadata.user_id`.
- **Three recurring tasks.** Mubit groups calls into a task when they share their system prompt, so each prompt is a fixed file and everything that changes per call (the brief, the creatures already made, the variation for each candidate) sits in the user message:
  - the generator (`pipeline/prompts/generator.md`): a brief in, kit code out;
  - the verifier (`pipeline/prompts/verifier.md`): the render, brief, code and stats in, a score with issues and a fix out;
  - the creature brief writer (`pipeline/prompts/creature.md`): the creatures that exist in, the next one out.
- **Corrections.** A sprite the verifier fails goes back to the generator with the verifier's issues and requested fix, as a follow-up turn; the better of the first and the fixed version is kept. Live creatures draw three candidates and keep the best that passes. These corrected calls are the examples Mubit trains on.
- **Model updates.** Once a task has enough kept examples (25 by default), Mubit trains an adapter, a small model for that task, and tests each version against the provider model's answers. Tasks, adapters and their test results are in the Mubit console, where a passing version can be compared side by side with the provider model in Try models, and replies can be rated Good or Bad in Requests.

## Run it

| Command                                | What it does                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                          | Installs from `bun.lock` and the Lefthook hooks.                                                                                            |
| `bun run dev`                          | Dev server on port 3000.                                                                                                                    |
| `bun run build`, `bun run start`       | Production build and server.                                                                                                                |
| `bun run check`                        | The gate: Biome, TypeScript, `bun test`, Knip, `next build`.                                                                                |
| `bun run balance`                      | Plays nights headlessly with an idle warden and a bot (200 runs a night, seeded); `-- --director` plays them under stub director decisions. |
| `bun run verify:visual -- --url <url>` | Headed visual verifier against a production build; read `verify-out/sheet.png`.                                                             |
| `bun run walkthrough -- <script.ts>`   | Records a narrated, subtitled walkthrough (needs ffmpeg and macOS `say` or `espeak-ng`); example: `e2e/walkthroughs/title.ts`.              |
| `bun run check:pixels`                 | Re-renders every committed sprite and hero frame locally and compares pixels.                                                               |
| `bun run assets -- "brief"`            | The sprite pipeline above; needs `MUBIT_API_KEY`.                                                                                           |
| `bun run plays`                        | Balance report from recorded plays; needs `BLOB_READ_WRITE_TOKEN`.                                                                          |

All commands, including `kit`, `logo` and `sandbox:snapshot`, are in [`docs/tooling.md`](docs/tooling.md).

### Live director

After each night, `POST /api/director` (`src/app/api/director/`) sends that night's recorded play, as the server holds it, to Mubit and answers with bounded balance tweaks for the same player's next night: the tide within 0.15 of the rules', a weight from 0.5 to 2 on each kind of monster, the creature's share of the spawns (0.1 to 0.4) and a line the sea says on the dawn and heir panels. The next night's recording says which decision it was played under, and the model sees how its last decision played out, so each night corrects the next. It never blocks play: a timeout (8 s), an error, invalid JSON, a rate limit or an answer that comes after the next night began leaves the rules' decision. Each decision is logged to Blob with the model's reasoning and the Mubit request id. Design, bounds, limits, a live run and balance numbers with stub decisions: [`docs/DIRECTOR.md`](docs/DIRECTOR.md).

## Deploying

Playing needs no keys: the sprites are static files. Recorded plays and the creature gallery need a Blob token, and live creatures need the Mubit and sandbox settings below. Keys come from the environment only and are never committed; the pipeline commands run under `bun --no-env-file`.

| Variable                                                                                                                 | For                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN`                                                                                                  | Recorded plays and the creature gallery (a private Vercel Blob store).                                                                            |
| `MUBIT_API_KEY`                                                                                                          | Live creatures: the brief writer, generator and verifier.                                                                                         |
| `VERCEL_SANDBOX_SNAPSHOT_ID`                                                                                             | Live creatures: printed by `bun run sandbox:snapshot` after `vercel link`; rebuild it when `pipeline/kit/kit.ts` or `pipeline/render/` changes.   |
| `CREATURE_RATE_SALT`                                                                                                     | Live creatures: at least 16 random characters, for example `openssl rand -hex 24`. Changing it resets the per-visitor counts.                     |
| `CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR`, `CREATURE_MAX_STARTS_PER_DAY`, `CREATURE_CANDIDATES`, `CREATURE_BLOB_PREFIX` | Optional: defaults 3, 40, 3 (at most 5) and `creatures`.                                                                                          |
| `DIRECTOR_RATE_SALT` (else `CREATURE_RATE_SALT`)                                                                         | Live director: at least 16 characters; without a salt, or without `MUBIT_API_KEY`, every answer is the rules'.                                    |
| `DIRECTOR_MAX_CALLS_PER_VISITOR_PER_HOUR`, `DIRECTOR_MAX_CALLS_PER_DAY`, `DIRECTOR_BLOB_PREFIX`, `DIRECTOR_PLAYS_PREFIX` | Optional: defaults 40, 2000, `director` (where decisions are logged) and `plays` (where it reads recorded plays; a test run points it elsewhere). |

Without all three of `MUBIT_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID` and `CREATURE_RATE_SALT`, the gallery is still served and `POST /api/creatures/next` answers `{"kind":"none","reason":"unavailable"}` once a player has met every creature in it. The offline pipeline also reads `SHOTCUP_API_KEY` (`--render shotcup`) and `BOAT_API_KEY` (`--render boat`); do not set those on the deployment.

## Recorded plays and replays

Every night is recorded and sent to `/api/plays`: its seed, the legacy it started from, the creature it met, the warden's input changes at the fixed 60 Hz step, a per-second timeline, and a fingerprint of the sim it ran on. There is no personal data, only a random per-browser session id, and the title screen says so. The sim is deterministic, so a recording replays exactly on the sim it was recorded with.
- Watch one at `/?replay=<id>`, or `/?replay=last` for your own last night, at 1x, 2x or 4x. The end screen says whether the replay ended where the live night did. A night recorded on another version of the sim isn't replayed: the game shows its recorded summary instead.
- `bun run plays [--since 2026-10-24] [--build <sha>] [--verify]` reports outcomes, length and kills per minute from the store; `--verify` replays the finished nights recorded on this checkout's sim and counts the others separately.
- Nights opened with `?verify=1`, as the visual verifier does, are not uploaded.

## Contributing

`bun run check` is the gate; the rules for contributors and agents are in [`AGENTS.md`](AGENTS.md).

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (directory map, sprite flow), [`docs/LIVE_GENERATION.md`](docs/LIVE_GENERATION.md), [`docs/tooling.md`](docs/tooling.md) and [`pipeline/README.md`](pipeline/README.md).
