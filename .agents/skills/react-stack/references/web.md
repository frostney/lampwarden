# Web profile

- Use the latest stable Next.js App Router and deploy to Vercel.
- Routes live under `src/app/` and retain framework names such as `page.tsx`,
  `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, and `route.ts`.
- Route-local pieces may live in private `_components` or `_hooks` folders;
  promote them when shared.
- Root layout renders `src/providers.tsx` with Clerk and Convex providers.
- Keep the current Clerk request boundary in `src/proxy.ts` when supported by the
  installed Next.js version; verify framework migration guidance.
- Tailwind via `@tailwindcss/postcss` owns styling.
- Choose rendering per route: SSG for stable content, SSR for request-specific
  data, and ISR for periodically refreshed static output. Avoid accidental SSR.
- Use Playwright for root `e2e/`.
- Sentry package: `@sentry/nextjs`; PostHog packages: `posthog-js` and
  `posthog-node` when server capture is needed.
