# Tooling

| Command                                | What it does                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                          | Installs dependencies from `bun.lock` and installs the Lefthook hooks (`prepare`).                                                                                                                                          |
| `bun run dev` / `build` / `start`      | Next.js dev server, production build, production server.                                                                                                                                                                    |
| `bun run check`                        | The gate: `lint`, `typecheck`, `bun test`, `knip`, `build`, in that order.                                                                                                                                                  |
| `bun run lint` / `format`              | Biome check, and Biome check with fixes (format, lint fixes, import order).                                                                                                                                                 |
| `bun run typecheck`                    | `tsc --noEmit` with the strict flags from `typescript-stack`.                                                                                                                                                               |
| `bun test`                             | Unit tests, co-located with source under `src/` (`*.test.ts`).                                                                                                                                                              |
| `bun run knip`                         | Unused files, exports and dependencies.                                                                                                                                                                                     |
| `bun run verify:visual -- --url <url>` | The end-to-end check, `e2e/verify-visual.mjs`: a headed visual verifier (desktop Chromium, iPhone profiles in WebKit, a mocked gamepad); writes `verify-out/`.                                                              |
| `bun run walkthrough -- <script.ts>`   | Records a pull request's narrated, subtitled walkthrough, `e2e/walkthrough.ts`, from a script of segments (example: `e2e/walkthroughs/title.ts`); writes `walkthrough-out/`.                                                |
| `bun run balance`                      | Plays nights headlessly with an idle and a bot warden.                                                                                                                                                                      |
| `bun run plays`                        | Balance report from recorded plays in Blob storage.                                                                                                                                                                         |
| `bun run logo`                         | Regenerates the logo, icons and share image from `tools/logo`.                                                                                                                                                              |
| `bun run assets -- "brief"`            | The Mubit sprite pipeline, `pipeline/run.ts` (see `pipeline/README.md`).                                                                                                                                                    |
| `bun run kit`                          | Reassembles `pipeline/kit/kit.ts` from `pipeline/kit/src`, and `pipeline/prepared-kit.ts` (the kit as plain JavaScript for QuickJS) from it.                                                                                |
| `bun run sandbox:snapshot`             | Builds the Vercel Sandbox snapshot the live creature generator renders in with `CREATURE_RENDERER=sandbox` (Bun 1.4.4 + kit + runner) and prints `VERCEL_SANDBOX_SNAPSHOT_ID`.                                              |
| `bun run check:creature-worker`        | `e2e/check-creature-worker.mjs`, against `bun run build && bun run start`: the browser worker's pixels equal every committed sprite's PNG, the isolation probes in Chromium and WebKit, and the worker's timings and bytes. |

## Lint and format

Biome owns formatting, linting and import order (`biome.json`). On top of its recommended rules: no non-null
assertions, no explicit `any`, no unsafe type assertions, and a GritQL plugin (`tools/lint/short-names.grit`) that
rejects one- and two-letter bindings (`x`, `y` and `id` are allowed). Excluded: `pipeline/kit` and `public/sprites`
(the model-facing kit and model-written sprite code), `pipeline/prompts` (the model's instructions; formatting would
change what it reads), `public/logo` (generated by `tools/logo`, which `bun tools/logo/build.ts --check` guards), and
`pipeline/render`, the local renderer's runner and canvas shim, which have not been swept to these rules yet, and
`pipeline/prepared-kit.ts`, the kit as plain JavaScript for QuickJS, generated by `bun run kit`.

Lefthook runs `biome check --write` on staged files before each commit and re-stages the fixes.

## Environment

`.env.local` (from `vercel env pull`) holds `BLOB_READ_WRITE_TOKEN` for recorded plays. The asset pipeline reads
`MUBIT_API_KEY`, `SHOTCUP_API_KEY` and `BOAT_API_KEY` from the shell environment only (the Vercel Sandbox renderer
uses Vercel's OIDC token), and runs under `bun --no-env-file` so bun does not load `.env` files into the process.

The deployed creature routes read `MUBIT_API_KEY`, `CREATURE_RATE_SALT` and the optional `CREATURE_RENDERER`, `VERCEL_SANDBOX_SNAPSHOT_ID` (with the sandbox renderer), `CREATURE_MAX_STARTS_PER_VISITOR_PER_HOUR`, `CREATURE_MAX_STARTS_PER_DAY` and `CREATURE_BLOB_PREFIX` from the project's environment (README, "Live creatures").
