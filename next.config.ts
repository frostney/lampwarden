import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // the Pixi application is created once; strict-mode double mount just churns the GL context
  // The creature job reads these at runtime (src/server/creatures/deps.ts): the model prompts, and the kit and runner
  // to compute the digest the sandbox snapshot must match. Nothing here is run in the function; the kit and runner
  // that render sprites live in the sandbox snapshot.
  outputFileTracingIncludes: {
    "/api/creatures/next": ["./pipeline/prompts/*.md", "./pipeline/kit/kit.ts", "./pipeline/render/*.ts"],
  },
};

export default nextConfig;
