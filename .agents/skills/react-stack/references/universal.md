# Universal profile

- Use the latest stable Expo with Expo Router.
- Routes live under `src/app/` and retain names such as `_layout.tsx`,
  `index.tsx`, `[id].tsx`, route groups, and `+not-found.tsx`.
- `src/app/_layout.tsx` renders `src/providers.tsx`; all non-route source stays
  outside `src/app/`.
- Keep `app.json` or `app.config.ts`, `eas.json`, `metro.config.js`,
  `tsconfig.json`, and `public/` at root.
- Style native UI with `StyleSheet.create` and co-located `Name.styles.ts`.
  NativeWind is not a default.
- Verify the installed Expo SDK compatibility matrix before adding React Native
  packages. Common stack packages include AsyncStorage, NetInfo, Reanimated,
  Gesture Handler, Expo Updates, and Expo Google Fonts.
- Use `sonner-native` for toasts.
- Build and submit iOS/Android with EAS; deploy the web target to Vercel.
- Sentry package: `@sentry/react-native`; PostHog package:
  `posthog-react-native`.
