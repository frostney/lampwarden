---
name: react-stack
description: >-
  Applies the user's Bun-based React stack across Next.js web and Expo universal
  profiles, deferring backend and repository details to their domain skills.
  Use when scaffolding a React app, upgrading dependencies, choosing MVP tooling,
  or selecting a project profile.
license: Unlicense OR MIT
compatibility: >-
  Assumes a Bun-only TypeScript project using Next.js App Router or Expo Router,
  Convex, Clerk, Biome, and Lefthook.
---

# React stack

Apply only decisions material to the requested work. Preserve valid project
choices; do not turn a narrow change into a stack or layout migration.

## Select the profile

| Profile | Use when |
| --- | --- |
| Web | Next.js App Router; server-rendered/static web; SEO; Vercel |
| Universal | Expo Router; mobile-first iOS, Android, and web |

Record a new profile choice in project context. If neither fits, follow the
project's AGENTS.md instead of forcing this stack. Read the matching profile
reference when the work touches scaffolding, routing, styling, deployment, or a
framework upgrade:

- [references/web.md](references/web.md)
- [references/universal.md](references/universal.md)

## Shared decisions

- Bun is the only runtime/package manager; keep `bun.lock` and forbid other
  package-manager lockfiles.
- Use `typescript-stack/SKILL.md` for compiler configuration, type and API design,
  module boundaries, language-level code style, and TypeScript validation.
- Biome owns lint, format, and import ordering.
- `bun test` unit tests are co-located with source. End-to-end tests live in
  root `e2e/`.
- Source lives under `src/` by domain. `src/app/` contains framework routes only.
- Components use Atomic Design folders (`atoms`, `molecules`, `organisms`) with
  downward-only dependencies and co-located companions.
- Convex owns application data; Clerk owns identity. Use
  `convex-conventions/SKILL.md` for backend policy.
- Clerk Billing is the default; use Stripe only for a documented capability gap.
- Vercel AI Gateway is the default AI lane. Use a native provider only for a
  verified unsupported capability and isolate the exception.
- Use Zod outside Convex and Convex validators inside it.
- Knip checks dead code; Fallow reports complexity and churn hotspots.
- Use Portless for stable worktree-aware local URLs.
- Use `.env.local` for solo work and Doppler once a team shares secrets.

Read [references/shared-tooling.md](references/shared-tooling.md) when
scaffolding layout, observability, generators, hooks, or package scripts.
`project-structure/SKILL.md` owns language-neutral repository policy.

## Evidence and boundaries

- Verify dependency versions and release status live before adding or upgrading
  them; read migration notes for framework, Convex, and Clerk version jumps.
- Confirm Bun and framework/native-package compatibility on the deployment
  target.
- A single `bun run check` runs the project's format, lint, tests, typecheck,
  dead-code/health checks, and build as applicable.
- Adding a product or service in a category this skill does not prescribe is a
  user decision: recommend a current Vercel-friendly option with its version,
  fit, and tradeoffs, and add it once the user chooses.

## Completion

- The relevant project gate was observed passing.
- After dependency changes, a frozen install plus `bun run check` passed on the
  target runtime; a separate production build ran only when that check does not
  cover the same build and runtime.
