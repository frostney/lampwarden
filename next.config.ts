import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";
import type { NextConfig } from "next";
import { simFingerprint } from "./tools/sim-fingerprint/sim-fingerprint";

// Varlock loads .env.schema (instead of @next/env, see the override in package.json): it validates the environment before
// the build or the dev server starts, redacts sensitive values from logs, and fails a build that would put one into a
// client bundle or a response.
const withVarlock = varlockNextConfigPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: false, // the Pixi application is created once; strict-mode double mount just churns the GL context
  // The fingerprint of the sources that decide how a night plays out, hashed at build time and inlined into the client
  // and server bundles (src/game/plays.ts, RUNNING_SIM). Every recorded play carries it; a replay only plays a night
  // recorded on the same one.
  env: { NEXT_PUBLIC_SIM_FINGERPRINT: simFingerprint(process.cwd()) },
  // The creature and building jobs read these at runtime (src/server/creatures/deps.ts): the model prompts, and the kit and runner
  // to compute the digest the sandbox snapshot must match. Nothing here is run in the function; the kit and runner
  // that render sprites live in the sandbox snapshot.
  outputFileTracingIncludes: {
    "/api/creatures/next": ["./pipeline/prompts/*.md", "./pipeline/kit/kit.ts", "./pipeline/render/*.ts"],
    // the building job reads the same: its own prompt, and the runner's digest
    "/api/buildings/next": ["./pipeline/prompts/*.md", "./pipeline/kit/kit.ts", "./pipeline/render/*.ts"],
    // the live director reads its system prompt (src/server/director/deps.ts)
    "/api/director": ["./pipeline/prompts/director.md"],
  },
};

export default withVarlock(nextConfig);
