// The renderers by name. Model-written build code runs only through these: in an env-allowlisted subprocess (local) or
// in a sandbox (Shotcup, Vercel Sandbox, boat.dev). Each renderer module is loaded on first use, so a local run never
// loads the sandbox SDKs.
import {
  invalidRequestReason,
  type Renderer,
  type RendererName,
  type RenderRequest,
  type RenderResult,
} from "./render-types";

const RENDERERS: Record<RendererName, Renderer> = {
  local: async (request) => (await import("./render-local")).renderLocally(request),
  shotcup: async (request) => (await import("./render-shotcup")).renderOnShotcup(request),
  vercel: async (request) => (await import("./render-vercel-sandbox")).renderInVercelSandbox(request),
  boat: async (request) => (await import("./render-boat")).renderInBoatSandbox(request),
};

/**
 * How many renders the pipeline runs at once per renderer. Shotcup admits about three runs at a time and refuses more
 * as "runtime busy"; boat's trial plan allows two sandboxes at once; Vercel Sandbox has been measured to 25 at once
 * (docs/LIVE_GENERATION.md); local renders are bounded by the CPU.
 */
export const DEFAULT_CONCURRENCY: Record<RendererName, number> = { local: 4, shotcup: 1, vercel: 4, boat: 2 };

export async function renderBuild(rendererName: RendererName, request: RenderRequest): Promise<RenderResult> {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  try {
    return await RENDERERS[rendererName](request);
  } catch (error) {
    return {
      ok: false,
      error: `${rendererName}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400),
    };
  }
}
