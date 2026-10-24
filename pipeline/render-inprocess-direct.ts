// MEASUREMENT ONLY. Never give this renderer model output.
//
// The fastest possible baseline for "run the build without a sandbox": the kit and the build are evaluated with
// `new Function` inside the calling process, with the process's globals, modules, environment, file system and network
// all in reach. There is no isolation of any kind. To keep it from ever being a way to run untrusted code, it refuses
// every build that is not byte-for-byte one of the scripts committed in this repository (public/sprites/*.ts and the
// generated hero frame builds), and it is not listed in `renderers.ts`, so `pipeline/run.ts` cannot select it.
import { PREPARED_KIT } from "./prepared-kit";
import { errorSummary, kitScript, prepareBuild } from "./quickjs-core";
import { finishRender } from "./render-finish";
import { isCommittedSpriteScript, plainJavaScript } from "./render-inprocess-shared";
import { invalidRequestReason, type Renderer } from "./render-types";

interface KitExports {
  Kit: new () => { render(): unknown; fit: unknown; snapped: unknown; dropped: unknown };
  post(rendered: unknown): { rgba: Uint8Array; stats: Record<string, unknown> };
}

function isKitExports(value: unknown): value is KitExports {
  return typeof value === "object" && value !== null && "Kit" in value && "post" in value;
}

interface LoadedKit {
  names: string[];
  values: unknown[];
  exports: KitExports;
}

let loadedKit: LoadedKit | undefined;

function loadKit(): LoadedKit {
  if (loadedKit) return loadedKit;
  const loaded: unknown = new Function(`${kitScript(PREPARED_KIT)}\nreturn __kit;`)();
  if (!isKitExports(loaded)) throw new Error("kit did not load");
  const entries = Object.entries(loaded);
  loadedKit = { names: entries.map(([name]) => name), values: entries.map(([, value]) => value), exports: loaded };
  return loadedKit;
}

/** Renders a committed sprite script in this process. Refuses anything else. */
export const renderDirectly: Renderer = async (request) => {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason) return { ok: false, error: invalidReason };
  if (!isCommittedSpriteScript(request.code))
    return { ok: false, error: "direct renderer only runs scripts committed in this repository" };
  try {
    const kit = loadKit();
    const start = performance.now();
    const buildFactory: unknown = new Function(
      ...kit.names,
      "POSE",
      `${prepareBuild(plainJavaScript(request.code))}\nreturn build;`,
    );
    if (typeof buildFactory !== "function") throw new Error("no function build(k) found");
    const build: unknown = buildFactory(...kit.values, request.pose);
    if (typeof build !== "function") throw new Error("no function build(k) found");
    const sprite = new kit.exports.Kit();
    build(sprite);
    const rendered = kit.exports.post(sprite.render());
    const statsJson = JSON.stringify({
      fit: sprite.fit,
      snapped: sprite.snapped,
      dropped: sprite.dropped,
      ...rendered.stats,
    });
    return finishRender(request.name, performance.now() - start, statsJson, new Uint8Array(rendered.rgba));
  } catch (error) {
    return { ok: false, error: `direct: ${errorSummary(error)}` };
  }
};
