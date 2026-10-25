# Tooling

| Command                                | What it does                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                          | Installs dependencies from `bun.lock` and installs the Lefthook hooks (`prepare`).                                                                                                                                          |
| `bun run dev` / `build` / `start`      | Next.js dev server, production build, production server.                                                                                                                                                                    |
| `bun run check`                        | The gate: `lint`, `typecheck`, `bun test`, `knip`, `scan`, `check:generated`, `build`, in that order. CI runs it on every pull request and push to `main`.                                                                  |
| `bun run lint` / `format`              | Biome check, and Biome check with fixes (format, lint fixes, import order).                                                                                                                                                 |
| `bun run typecheck`                    | Generates `env.d.ts` from `.env.schema` (`varlock codegen`), then `tsc --noEmit` with the strict flags from `typescript-stack`.                                                                                             |
| `bun test`                             | Unit tests, co-located with their source (`*.test.ts` under `src/`, `pipeline/` and `tools/`).                                                                                                                              |
| `bun run knip`                         | Unused files, exports and dependencies (run under `varlock run`, because Knip loads `next.config.ts`).                                                                                                                      |
| `bun run scan`                         | `varlock scan`: fails when the value of a secret declared in `.env.schema` that this machine can resolve sits in plaintext in a tracked or unignored file (Environment).                                                    |
| `bun run check:generated`              | Fails when a generated file no longer matches its source: `pipeline/kit/kit.ts`, the logo assets and the decor table `src/scene/decor-extents.ts`, each by its builder's `--check` (fix: `bun run kit`, `logo`, `decor`).   |
| `bun run verify:visual -- --url <url>` | The end-to-end check, `e2e/verify-visual.mjs`: a headed visual verifier (desktop Chromium, iPhone profiles in WebKit, a mocked gamepad); writes `verify-out/`.                                                              |
| `bun run walkthrough -- <script.ts>`   | Records a pull request's narrated, subtitled walkthrough, `e2e/walkthrough.ts`, from a script of segments (example: `e2e/walkthroughs/title.ts`); writes `walkthrough-out/`. Needs `ffmpeg` and macOS `say` or `espeak-ng`. |
| `bun run balance`                      | Plays nights headlessly with an idle warden, a perfect bot and a human-paced bot (`[runs] [only]`; `-- --director`: under stub director decisions).                                                                         |
| `bun run plays`                        | Balance report from recorded plays in Blob storage.                                                                                                                                                                         |
| `bun run logo`                         | Regenerates the logo, icons and share image from `tools/logo`.                                                                                                                                                              |
| `bun run decor`                        | Measures the pixels of the sprites the decor placer uses (`PLACED_SPRITES` in `decor.ts`; not the monsters) into `src/scene/decor-extents.ts`; run it after adding a decoration or redrawing a placed sprite.               |
| `bun run assets -- "brief"`            | The Mubit sprite pipeline, `pipeline/run.ts` (see `pipeline/README.md`); renders in Vercel Sandbox.                                                                                                                         |
| `bun run kit`                          | Reassembles `pipeline/kit/kit.ts` from `pipeline/kit/src`.                                                                                                                                                                  |
| `bun run sandbox:snapshot`             | Builds the Vercel Sandbox snapshot every render boots from (Bun 1.4.4 + kit + runner) and prints `VERCEL_SANDBOX_SNAPSHOT_ID`.                                                                                              |
| `bun run check:pixels`                 | Renders every committed sprite and hero frame in Vercel Sandbox (4 batches of 4 vCPUs) and compares pixels with the committed PNGs; exits 1 on any difference.                                                              |
| `bun run assets:hero`                  | Regenerates the hero atlases from the model's committed build code (`public/sprites/hero/<sex>.ts`), rendered in Vercel Sandbox.                                                                                            |
| `bun run assets:hero:generate`         | Has Mubit write the warden's build code, verifies it on four frames and keeps it only if it beats the warden in use (`pipeline/README.md`); needs the Mubit key.                                                            |

## Lint and format

Biome owns formatting, linting and import order (`biome.json`). On top of its recommended rules: no non-null
assertions, no explicit `any`, no unsafe type assertions, and a GritQL plugin (`tools/lint/short-names.grit`) that
rejects one- and two-letter bindings (`x`, `y` and `id` are allowed). Excluded: `pipeline/kit` and `public/sprites`
(the model-facing kit and model-written sprite code), `pipeline/prompts` (the model's instructions; formatting would
change what it reads), and `public/logo` (generated by `tools/logo`, which `bun tools/logo/build.ts --check` guards).
`pipeline/render`, the runner, batch driver and PNG encoder a sandbox VM runs, follows the same rules and strict
TypeScript as the rest of the code. Its imports have no `.ts` extension (Bun resolves them in the sandbox as it does
here), and `runner.ts` loads the kit by path rather than importing it, because `tsc` follows an import into the excluded
`pipeline/kit/kit.ts` and checks it too; the runner declares the part of the kit it uses. Any change there needs a new
sandbox snapshot (see "Rendering needs Vercel auth").

Lefthook runs `biome check --write` on staged files before each commit and re-stages the fixes, and
`gitleaks git --redact .` before each push (install gitleaks first: `brew install gitleaks`).

## CI

`.github/workflows/check.yml` runs `bun run check` (with Bun from `packageManager` in `package.json` and Chromium for
the logo check) and a gitleaks scan of the history on every pull request and every push to `main`.

## Environment

[Varlock](https://varlock.dev) owns the environment. `.env.schema` lists every variable the code reads, with its type,
what it is for, where it is required and whether it is secret; it holds no secret values and is committed. Nothing
reads a variable that is not declared there (AGENTS.md). `bunx varlock load` prints what the schema resolves to on
this machine (secrets redacted), and `APP_ENV=production bunx varlock load` what a production build would demand.

**Where values come from**, highest first: the process environment (Vercel's project settings, or your shell), then
`.env.local` (git-ignored), then the defaults written in `.env.schema`. `APP_ENV` is the environment flag: Vercel's
`VERCEL_ENV` (`preview` or `production`) there, `development` anywhere else. The Mubit key, the sandbox snapshot, the
creature rate salt and the Blob token are required in `preview` and `production` and optional in `development`: the
code turns live generation off without them and still serves the gallery, so a local run needs none of them, and a
deployment that lacks one fails its build instead of quietly generating nothing. The director's variables are all
optional (without a key or salt every answer is the rules').

**Next.js** loads the schema through `@varlock/nextjs-integration`, which `package.json` `overrides` in place of
`@next/env`, plus `varlockNextConfigPlugin` in `next.config.ts`. `next dev` and `next build` print
`✨ loaded by varlock ✨` when it is active; without that banner the override did not apply (delete `node_modules` and
`bun.lock`, then `bun install`). It validates the environment before the build starts, redacts sensitive values from
`console` output, fails a build whose prerendered output holds a sensitive value, and stops a route from returning one
in a response. Server code reads `ENV` from `varlock/env`, typed by `env.d.ts`, which `varlock codegen` writes from the
schema; it is git-ignored, and `typecheck`, `next dev` and `next build` regenerate it (run `bunx varlock codegen` once after cloning, for the editor). Two reads stay on `process.env`
on purpose: `NEXT_PUBLIC_SIM_FINGERPRINT` in `src/game/plays.ts`, which `next.config.ts` computes and inlines and which
`bun test` also reads, and the scripts below, which receive plain variables.

**Scripts and the pipeline** run as `varlock run --inject vars --filter=<what it needs> -- bun --no-env-file <script>`
(`package.json`). `--no-env-file` keeps bun from loading any `.env` file into the process, as before. `--filter` gives
the script only the variables it needs, removes every other schema variable from its environment (even one exported in
your shell) and does not resolve the rest at all, so `bun run plays` never asks for the Mubit key. `--inject vars`
leaves out the `__VARLOCK_ENV` blob, which holds every resolved value.

| Command                                         | Receives                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bun run assets`                                | The variables tagged `pipeline` in `.env.schema`: `MUBIT_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID` and `VERCEL_OIDC_TOKEN`. |
| `bun run calibrate:verifier`                    | `MUBIT_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID` and `VERCEL_OIDC_TOKEN` (it renders the committed art in the sandbox).     |
| `bun run assets:hero:generate`                  | `MUBIT_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID` and `VERCEL_OIDC_TOKEN` (the `pipeline` variables, like `assets`).         |
| `bun run check:pixels`, `assets:hero`, `render` | `VERCEL_SANDBOX_SNAPSHOT_ID` and `VERCEL_OIDC_TOKEN`.                                                                    |
| `bun run sandbox:snapshot`                      | `VERCEL_OIDC_TOKEN` (or the Vercel CLI login of a `vercel link`ed project).                                              |
| `bun run plays`                                 | `BLOB_READ_WRITE_TOKEN`.                                                                                                 |

`kit`, `logo` and `balance` need no variable and get none.

`bun run reverify:sprites` (`pipeline/reverify.ts`) gets the variables tagged `pipeline`, like `assets`: `-- score` scores the committed sprites with the current verifier and the live acceptance rule, `regenerate <id>` runs the candidate loop for one sprite and `install <id>` keeps the winner (pipeline/README.md).

## Rendering needs Vercel auth

Vercel Sandbox is the only way to render and the source of truth for every pixel, so `assets`, `check:pixels`,
`assets:hero`, `render` and `calibrate:verifier` all need three things:
1. **A Vercel login and a linked project.** `bunx vercel login`, then `bunx vercel link` in the checkout (pick the
   `lampwarden` project; non-interactively: `vercel link --yes --project lampwarden --scope <team>`). That writes the
   git-ignored `.vercel/project.json`, and the sandbox SDK then refreshes an OIDC token from the CLI login by itself.
   Alternatively `vercel env pull .env.local` writes `VERCEL_OIDC_TOKEN` (it expires after 12 hours). The SDK reads no
   `VERCEL_TOKEN`. The token never enters the VM and is never printed.
2. **A snapshot.** `bun run sandbox:snapshot` boots a VM, installs the pinned Bun 1.4.4 (checked against a SHA-256), cuts
   the network, copies in the kit and runner with a `SNAPSHOT.json` manifest, renders `lamp-lit` and requires it to match
   the committed PNG byte for byte, and prints `VERCEL_SANDBOX_SNAPSHOT_ID=snap_...`. Put that in `.env.local` (or
   export it in your shell).
3. **A snapshot that matches the checkout.** A change to `pipeline/kit/kit.ts` or anything in `pipeline/render/` needs a
   new snapshot. Every render reads the manifest first; `check:pixels` exits 3 with "the sandbox snapshot holds a
   different kit or runner than this checkout ... run `bun run sandbox:snapshot`" when it does not match, and a render
   from `run.ts` fails with the same message.

Renders go out as batches (`pipeline/render-vercel-sandbox.ts`): one VM renders many builds, one process each with its
own deadline, so one build that throws or hangs fails only itself. Items in a batch share a VM, so a batch holds builds
from one trust domain (one creature's frames, or this repository's own sprites). Deployed, the function authenticates
with the deployment's OIDC token and needs only `VERCEL_SANDBOX_SNAPSHOT_ID` (README, "Deploying"). Snapshots are
created without an expiry; delete old ones with `vercel sandbox snapshots` when they pile up.

Model-written build code never sees any of the environment: the sandbox runs it with `KIT_OUT` only. The Vercel Sandbox
SDK authenticates with the platform's OIDC token on Vercel (it arrives with the request) and locally with
`VERCEL_OIDC_TOKEN` or the CLI login of a linked project.

**Keys on your machine** go in `.env.local` (git-ignored), resolved from a store instead of written as plaintext.
A key kept in a file, such as `~/.config/mubit/api_key`:

```
# .env.local
MUBIT_API_KEY=exec(`cat ~/.config/mubit/api_key`)
```

`exec()` runs the command in a shell each time the schema loads and trims the newline; `bunx varlock load` shows
whether it worked. On macOS the Keychain works too, behind Touch ID:

```
# .env.local
MUBIT_API_KEY=keychain("lampwarden-mubit")
```

(`bunx varlock keychain set MUBIT_API_KEY --profile dev --write-to .env.local` stores a key at a masked prompt and
writes the matching reference.) `keychain()` resolves whenever Varlock loads the schema (`next dev`, `next build`,
the commit hook below), so each of those can prompt, unless the command filters the variable out, as the scripts do.
Never write a key into `.env.local` as plaintext, and never into `.env.schema`. `vercel env pull .env.local` writes
plaintext values (the Blob token, the OIDC token); that file is git-ignored too.

**Leaks are checked at three points.** At build, Varlock fails `next build` when a sensitive value is in prerendered
output (a client component that renders `ENV.MUBIT_API_KEY` fails the build with `DETECTED LEAKED SENSITIVE CONFIG`),
and at run time it replaces a sensitive value in `console` output with `▒▒▒▒▒` and refuses a `Response.json` that
holds one. At commit, Lefthook runs `varlock scan --staged` next to Biome, and `bun run scan` (part of `check`) scans
the tree: both look for the actual values of the secrets this machine can resolve, so with no key in `.env.local`
they have nothing to look for and say so. gitleaks looks for key-shaped strings whatever their value, so it stays:
run `gitleaks git --redact .` before every push (AGENTS.md).

**Vercel.** Varlock reads the project's environment variables during the build and writes the resolved values into the
server output, which is how the functions get them. That output is encrypted (AES-256-GCM) with `_VARLOCK_ENV_KEY`, a
sensitive variable set for `preview` and `production`; `# @encryptInjectedEnv=forEnv(preview, production)` in the
header of `.env.schema` makes a build without the key fail instead of shipping the values as plaintext JSON. To set up
a new project, or replace a key:

```
bunx varlock generate-key --plain | vercel env add _VARLOCK_ENV_KEY preview --sensitive
bunx varlock generate-key --plain | vercel env add _VARLOCK_ENV_KEY production --sensitive
```

## Visual verifier

`bun run verify:visual -- --url <url>` (`e2e/verify-visual.mjs`) drives the real game in a headed Chromium, plus iPhone
profiles in WebKit and a mocked gamepad, into fixed scenarios with the sim paused and the clock frozen, and screenshots
each. It checks pixels and the DOM (lit lanterns glow, dark lamps have no light pool, monsters are drawn where they stand,
the scene brightens towards dawn, each upgrade has its icon, no console errors) and diffs every pass against the last
approved one. Run it against `bun run build && bun run start`, then look at `verify-out/sheet.png` (git-ignored) after
every change that can show on screen. `--update` approves the pass as the new baseline; `--headless` exists, but the
report then says the pass was not visual. The creature, recording and director APIs are stubbed, so it never reaches Mubit. The game opened with
`?verify=1` does not upload its nights.

The props stand differently every night (`src/scene/decor.ts`), so no check assumes where one is. It reads the prop sprites
off the stage and checks, from the committed pictures, that every painted pixel of each land prop's base is on the plaza with
its margin and each boat's is on the sea, for the night it plays and for six seeds it replays (`08c-plaza-1` to `-6` on the
contact sheet are the six plazas side by side); a replay must show the plaza the night was played on.
