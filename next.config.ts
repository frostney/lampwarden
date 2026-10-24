import type { NextConfig } from "next";

// EXPERIMENT (docs/LIVE_GENERATION.md, "Direct execution in the browser (option E)"): the Content-Security-Policies of the
// direct draw path, which are the only thing that limits the network a direct worker has (the shadowing in
// creature-direct-worker.ts cannot stop `import()`). CREATURE_DIRECT_CSP picks which are sent, to measure them one at a
// time: "page" (the page, only with ?draw=direct), "worker" (the worker script's own response), "both" (the default) or "none".
//   page    what the game needs: its own origin for scripts (Next's inline bootstrap and Pixi's shader compiler need
//           'unsafe-inline' and 'unsafe-eval'), styles, images, fonts and fetches; blob: for Pixi's own workers and textures.
//   worker  nothing but the language: no network of any kind (fetch, XHR, WebSocket), no scripts to import, no nested workers.
const DIRECT_CSP = process.env.CREATURE_DIRECT_CSP ?? "both";
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const WORKER_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-eval'",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "img-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    const policy = (value: string) => ({ key: "Content-Security-Policy", value });
    return [
      ...(DIRECT_CSP === "page" || DIRECT_CSP === "both"
        ? [
            {
              source: "/",
              has: [{ type: "query" as const, key: "draw", value: "direct" }],
              headers: [policy(PAGE_POLICY)],
            },
          ]
        : []),
      {
        source: "/creature-direct-worker.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600" },
          ...(DIRECT_CSP === "worker" || DIRECT_CSP === "both" ? [policy(WORKER_POLICY)] : []),
        ],
      },
    ];
  },
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
