# Shared React project details

## Layout

Keep root-only framework/tooling files at root (`convex/`, `public/`, manifests,
framework config, `plopfile.ts`). Put application source under `src/`:

```text
src/
  app/                 # routes only
  components/
    atoms/
    molecules/
    organisms/
  hooks/
  types/
  <domain>/
  providers.tsx
```

A component folder contains `Name.tsx`, `Name.test.tsx`, and only the companions
it needs (`Name.types.ts`, `Name.constants.ts`, or native `Name.styles.ts`).
Hooks and plain modules remain single files until companions justify a folder.

## Observability

Classify by operational complexity:

- Simple single-surface projects with obvious synchronous failures use Vercel
  Analytics and Speed Insights.
- Projects with background work, opaque external integrations, multi-tenancy,
  mobile plus web, or real-time state use Sentry and PostHog.

Use profile-specific Sentry/PostHog packages. Missing DSNs or keys must not break
local development.

## Generators

Use Plop only after the same file shape has been created manually more than
twice. Keep templates in one root folder, expose `bun run plop`, and add only
project-needed generator kinds.

## Hooks and checks

Lefthook runs Biome's fix command on staged JS/TS/JSON files and re-stages fixes.
Pin the live major version and do not bypass the hook without explicit user
direction.

`bun run check` is the stable aggregate entry point. It covers Biome, TypeScript,
tests, Knip, Fallow, and the profile build; parallelize independent checks where
useful.
