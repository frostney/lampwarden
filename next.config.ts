import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // the Pixi application is created once; strict-mode double mount just churns the GL context
  // What the creature job reads at runtime (src/server/creatures/deps.ts): the model prompts, and with the sandbox renderer
  // the kit and runner, to compute the digest the sandbox snapshot must match. Nothing here is run in the function; the kit
  // and runner that render sprites in the sandbox live in its snapshot.
  //
  // The QuickJS renderer needs no file read by path: its worker thread and the prepared kit (pipeline/prepared-kit.ts, a
  // string in the bundle) are bundled, and the bundler emits the WebAssembly file as an asset and traces it. It is listed
  // here as well so the function carries it whichever way the bundler resolves it.
  outputFileTracingIncludes: {
    "/api/creatures/next": [
      "./pipeline/prompts/*.md",
      "./pipeline/kit/kit.ts",
      "./pipeline/render/*.ts",
      "./node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
    ],
  },
};

export default nextConfig;
