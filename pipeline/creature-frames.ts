// A creature's animation frames: the build code of an accepted sprite rendered again in every pose of its animations (idle,
// walk, attack), in ONE sandbox batch, and packed into the atlas the game cuts its frames from
// (src/game/creature-frames.ts has the layout). The generator writes `pose: POSE || 'idle'` into the builder call, and the
// runner passes the pose in as POSE, so the same code draws every frame; a builder that ignores POSE draws the same figure in
// every frame, which is caught here and refused, not shipped as an animation that does not move.
import {
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAME_SIZE,
  type CreatureFrames,
  creatureAtlasLayout,
  creaturePoseName,
} from "../src/game/creature-frames";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { RENDER_ABORTED, type RenderRequest, type RenderResult } from "./render-types";

/**
 * Renders the requests in one sandbox batch, one result each, in order; it never throws. `signal` cancels the batch:
 * its sandbox is stopped and every item fails.
 */
export type BatchRenderer = (requests: readonly RenderRequest[], signal?: AbortSignal) => Promise<RenderResult[]>;

/** The same batch renderer tied to `signal`: once it has fired nothing more is rendered, and a batch in flight is cancelled. */
export function bindBatchRenderSignal(renderBatch: BatchRenderer, signal: AbortSignal): BatchRenderer {
  return async (requests, callSignal) =>
    signal.aborted
      ? requests.map(() => ({ ok: false, error: RENDER_ABORTED }))
      : renderBatch(requests, callSignal ? AbortSignal.any([signal, callSignal]) : signal);
}

export interface FrameSet {
  frames: CreatureFrames;
  /** The atlas as PNG bytes. */
  atlas: Uint8Array;
}

/**
 * Why a frame set was refused. `kind` is a fixed word, safe to log; `reason` is for a person and may quote the sandbox's
 * error, which can carry model text, so it is never stored or logged by the job.
 */
export type FrameSetFailure = {
  ok: false;
  kind: "incomplete" | "render" | "picture" | "blank" | "static";
  reason: string;
};

export type FrameSetResult = ({ ok: true } & FrameSet) | FrameSetFailure;

/** The renders a frame set takes, in the atlas's order: `idle1`..`idle4`, `walk1`..`walk6`, `attack1`..`attack5`. */
export function frameRequests(code: string): RenderRequest[] {
  return creatureAtlasLayout(CREATURE_FRAME_COUNTS).cells.map(({ animation, frame }) => {
    const pose = creaturePoseName(animation, frame);
    return { code, name: pose, pose };
  });
}

/** A frame that draws less than this is a pose that drew nothing (a figure is hundreds of pixels). */
const MIN_FIGURE_PIXELS = 100;

const opaquePixels = (rgba: Uint8Array) => {
  let count = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if ((rgba[offset] ?? 0) > 200) {
      count++;
    }
  }
  return count;
};

const sameBytes = (first: Uint8Array, second: Uint8Array) =>
  first.length === second.length && first.every((byte, index) => byte === second[index]);

/** Checks a batch's results and packs them into an atlas, or says why they are not a usable animation. */
export function assembleFrameSet(results: readonly RenderResult[]): FrameSetResult {
  const layout = creatureAtlasLayout(CREATURE_FRAME_COUNTS);
  if (results.length !== layout.cells.length) {
    return { ok: false, kind: "incomplete", reason: "the frame batch came back incomplete" };
  }
  const atlas = new PixelImage(layout.width, layout.height);
  const walking: Uint8Array[] = [];
  for (const [index, cell] of layout.cells.entries()) {
    const result = results[index];
    const pose = creaturePoseName(cell.animation, cell.frame);
    if (!result?.ok) {
      return { ok: false, kind: "render", reason: `${pose} did not render: ${result?.error ?? "no result"}` };
    }
    let picture: PixelImage;
    try {
      picture = decodePng(Buffer.from(result.png));
    } catch {
      return { ok: false, kind: "picture", reason: `${pose} is not a PNG` };
    }
    if (picture.width !== CREATURE_FRAME_SIZE || picture.height !== CREATURE_FRAME_SIZE) {
      return {
        ok: false,
        kind: "picture",
        reason: `${pose} is ${picture.width}x${picture.height}, not ${CREATURE_FRAME_SIZE} px square`,
      };
    }
    if (opaquePixels(picture.data) < MIN_FIGURE_PIXELS) {
      return { ok: false, kind: "blank", reason: `${pose} is empty: the pose draws no figure` };
    }
    for (let row = 0; row < CREATURE_FRAME_SIZE; row++) {
      const from = row * CREATURE_FRAME_SIZE * 4;
      atlas.data.set(
        picture.data.subarray(from, from + CREATURE_FRAME_SIZE * 4),
        ((cell.y + row) * atlas.width + cell.x) * 4,
      );
    }
    if (cell.animation === "walk") {
      walking.push(picture.data);
    }
  }
  const [firstStep, ...laterSteps] = walking;
  if (firstStep && laterSteps.every((step) => sameBytes(step, firstStep))) {
    return {
      ok: false,
      kind: "static",
      reason: "the walk frames are all the same picture: the builder ignores its pose",
    };
  }
  return { ok: true, frames: { ...CREATURE_FRAME_COUNTS }, atlas: encodePng(atlas) };
}

/** Renders a creature's frame set in one batch and packs it. */
export async function renderFrameSet(renderBatch: BatchRenderer, code: string): Promise<FrameSetResult> {
  return assembleFrameSet(await renderBatch(frameRequests(code)));
}
