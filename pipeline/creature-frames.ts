// A creature's animation frames: the build code of an accepted sprite rendered again in every pose of its animations (idle,
// walk, attack) and from every drawn direction, in ONE sandbox batch (75 frames), and packed into the atlas the game cuts its
// frames from (src/game/creature-frames.ts has the layout). The generator writes `pose: POSE || 'idle'` into the builder call
// and the runner passes the pose in as POSE, so the same code draws every pose; the runner also gives the kit a turn for each
// direction (`facing` on the request, the kit's TURN), which every builder that takes `facing` adds to the one the code wrote,
// so the same code draws every side without the prompt saying anything about it. A builder that ignores its pose or its turn
// draws the same figure in every frame, which is caught here and refused, not shipped as an animation that does not move.
//
// Every frame is drawn on the canvas the still was: the scale and shift the kit fitted the still with, so the figure keeps
// its size from frame to frame. A frame that reaches the edge of that canvas (a spear thrust to the side, a club raised
// overhead, a figure that faces away and so stands higher up the picture) is slid along it by the kit, as the kit always
// does, and the slide is the frame's `shift`: the atlas records it, and the game draws the frame that far the other way, so
// the figure stays where it stands and only its weapon reaches past the cell. A figure too big for the canvas in any frame,
// slid or not, is drawn smaller in all of them, by one factor, until none touches an edge.

import {
  CREATURE_DIRECTIONS,
  CREATURE_FRAME_COUNTS,
  CREATURE_FRAME_SIZE,
  type CreatureDirection,
  type CreatureFrames,
  creatureAtlasLayout,
  creaturePoseName,
  STILL_DIRECTION,
} from "../src/game/creature-frames";
import { BYTES_PER_PIXEL, differingPixels, solidPixels } from "../src/lib/pixels";
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";
import { kitFacing } from "./hero-animation";
import {
  type FrameView,
  RENDER_ABORTED,
  type RenderRequest,
  type RenderResult,
  type RenderStats,
} from "./render-types";

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

/** How a figure sits on the canvas: how big it is drawn and where the ground origin is. A set's frames all share one. */
export interface CanvasFit {
  scale: number;
  dx: number;
  dy: number;
}

/** The slides a render's `fit` string records (`0:6,0:6` is two slides, 12 px down), summed. */
export function slidesOf(fit: string): { dx: number; dy: number } {
  let across = 0;
  let down = 0;
  for (const slide of fit.split(",")) {
    const [slideX, slideY] = slide.split(":").map(Number);
    if (Number.isFinite(slideX) && Number.isFinite(slideY)) {
      across += slideX ?? 0;
      down += slideY ?? 0;
    }
  }
  return { dx: across, dy: down };
}

/** The canvas a still was drawn on: the scale the kit gave it and the slides that kept it off the edge. */
export function canvasOfStill(stats: Pick<RenderStats, "fit" | "scale">): CanvasFit {
  return { scale: stats.scale ?? 1, ...slidesOf(stats.fit) };
}

/** How many times the kit may slide a frame six pixels to keep it off the canvas edge: enough for any frame that fits. */
const FRAME_SLIDES = 14;

/**
 * Why a frame set was refused. `kind` is a fixed word, safe to log; `reason` is for a person and may quote the sandbox's
 * error, which can carry model text, so it is never stored or logged by the job.
 */
export interface FrameSetFailure {
  ok: false;
  kind: "incomplete" | "render" | "picture" | "blank" | "static" | "directions" | "fit";
  reason: string;
}

interface FrameSet {
  frames: CreatureFrames;
  /** The atlas as PNG bytes. */
  atlas: Uint8Array;
  /** The canvas every frame was drawn on. */
  canvas: CanvasFit;
  /** How many sandbox batches it took (more than one when the figure had to be drawn smaller to fit). */
  batches: number;
}

type FrameSetResult = ({ ok: true } & FrameSet) | FrameSetFailure;

/** What `renderFrameSet` says of a try: the set, or why not, and how many batches it took either way. */
export type FrameSetOutcome = FrameSetResult & {
  batches: number;
  /** Why the sets that were tried before this one were refused, in order (the all-directions set before the one-direction fallback). */
  earlier: FrameSetFailure["kind"][];
};

/** The frame counts of a set drawn from `directions`; one direction (south-east) is the layout without `directions`. */
function framesFor(directions: readonly CreatureDirection[]): CreatureFrames {
  const onlyStill = directions.length === 1 && directions[0] === STILL_DIRECTION;
  return onlyStill ? { ...CREATURE_FRAME_COUNTS } : { ...CREATURE_FRAME_COUNTS, directions: [...directions] };
}

/**
 * The renders a frame set takes, in the atlas's order: for each direction, `idle1`..`idle4`, `walk1`..`walk6`,
 * `attack1`..`attack5`. Each is named by its direction and pose (`ne_walk3`), turned by the kit's facing for the direction
 * and drawn on `canvas`, which the kit may slide it along to keep it off the edge.
 */
export function frameRequests(
  code: string,
  canvas: CanvasFit,
  directions: readonly CreatureDirection[] = CREATURE_DIRECTIONS,
): RenderRequest[] {
  const view: FrameView = { ...canvas, slides: FRAME_SLIDES };
  return creatureAtlasLayout(framesFor(directions)).cells.map(({ animation, frame, direction }) => {
    const pose = creaturePoseName(animation, frame);
    return { code, name: `${direction}_${pose}`, pose, facing: kitFacing(direction), view };
  });
}

/** A frame that draws less than this is a pose that drew nothing (a figure is hundreds of pixels). */
const MIN_FIGURE_PIXELS = 100;

const sameBytes = (first: Uint8Array, second: Uint8Array) =>
  first.length === second.length && first.every((byte, index) => byte === second[index]);

/** Two sides that differ in fewer pixels than this are one figure drawn twice: a real turn changes thousands. */
const MIN_SIDE_DIFFERENCE = 200;

/** One rendered frame as a picture of the frame's size with a figure in it, with its render's stats; or why it is not one. */
function framePicture(
  result: RenderResult | undefined,
  pose: string,
): { picture: PixelImage; stats: RenderStats } | FrameSetFailure {
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
  if (solidPixels(picture.data) < MIN_FIGURE_PIXELS) {
    return { ok: false, kind: "blank", reason: `${pose} is empty: the pose draws no figure` };
  }
  return { picture, stats: result.stats };
}

// copies a frame into its cell of the atlas
function copyCell(atlas: PixelImage, picture: PixelImage, cell: { x: number; y: number }) {
  for (let row = 0; row < CREATURE_FRAME_SIZE; row++) {
    const from = row * CREATURE_FRAME_SIZE * BYTES_PER_PIXEL;
    atlas.data.set(
      picture.data.subarray(from, from + CREATURE_FRAME_SIZE * BYTES_PER_PIXEL),
      ((cell.y + row) * atlas.width + cell.x) * BYTES_PER_PIXEL,
    );
  }
}

/**
 * Why the frames do not animate, or null when they do: the walk must move, seen from every side it is drawn from, and
 * the sides must differ (a builder that ignores the turn draws one figure five times, or turns only its head).
 */
function motionRefusal(
  walking: ReadonlyMap<CreatureDirection, Uint8Array[]>,
  standing: ReadonlyMap<CreatureDirection, Uint8Array>,
): FrameSetFailure | null {
  for (const steps of walking.values()) {
    const [firstStep, ...laterSteps] = steps;
    if (firstStep && laterSteps.every((step) => sameBytes(step, firstStep))) {
      return {
        ok: false,
        kind: "static",
        reason: "the walk frames are all the same picture: the builder ignores its pose",
      };
    }
  }
  const sides = [...standing.entries()];
  for (const [position, [direction, picture]] of sides.entries()) {
    for (const [otherDirection, other] of sides.slice(position + 1)) {
      if (differingPixels(picture, other) < MIN_SIDE_DIFFERENCE) {
        return {
          ok: false,
          kind: "directions",
          reason: `${direction} and ${otherDirection} are the same picture: the builder ignores its facing`,
        };
      }
    }
  }
  return null;
}

/** Checks a batch's results and packs them into an atlas, or says why they are not a usable animation. */
export function assembleFrameSet(
  results: readonly RenderResult[],
  directions: readonly CreatureDirection[] = CREATURE_DIRECTIONS,
): FrameSetFailure | { ok: true; frames: CreatureFrames; atlas: Uint8Array } {
  const frames = framesFor(directions);
  const layout = creatureAtlasLayout(frames);
  if (results.length !== layout.cells.length) {
    return { ok: false, kind: "incomplete", reason: "the frame batch came back incomplete" };
  }
  const atlas = new PixelImage(layout.width, layout.height);
  const walking = new Map<CreatureDirection, Uint8Array[]>();
  const standing = new Map<CreatureDirection, Uint8Array>();
  const shifts: [number, number][] = [];
  for (const [index, cell] of layout.cells.entries()) {
    const framed = framePicture(results[index], `${cell.direction} ${creaturePoseName(cell.animation, cell.frame)}`);
    if ("reason" in framed) {
      return framed;
    }
    const { picture, stats } = framed;
    copyCell(atlas, picture, cell);
    const slid = slidesOf(stats.fit);
    shifts.push([slid.dx, slid.dy]);
    if (cell.animation === "walk") {
      walking.set(cell.direction, [...(walking.get(cell.direction) ?? []), picture.data]);
    }
    if (cell.animation === "idle" && cell.frame === 0) {
      standing.set(cell.direction, picture.data);
    }
  }
  const refusal = motionRefusal(walking, standing);
  if (refusal) {
    return refusal;
  }
  return {
    ok: true,
    frames: shifts.some(([across, down]) => across !== 0 || down !== 0) ? { ...frames, shifts } : frames,
    atlas: encodePng(atlas),
  };
}

/** The room a frame must fit in to be slid clear of the edge: the canvas less the margin the slide keeps and a step of it. */
const FIT_EXTENT = 116;
/** The set is drawn this much smaller than the measured fit, which is only as exact as a pixel of the probe. */
const FIT_SLACK = 0.98;
/** The probe that measures how big the frames are is drawn at this fraction of the canvas, so that none touches an edge. */
const PROBE_SCALE = 0.5;
/** Every try after the measured fit draws the set this much smaller than the last when a frame still touches an edge. */
const SHRINK_STEP = 0.95;
/** A figure that needs to be drawn smaller than this fraction of its still to fit does not turn well. */
const MIN_SHRINK = 0.5;
/** Tries at the measured fit and just under it before the set is given up. */
const MAX_FINAL_TRIES = 3;

const boxOf = (bbox: string) => bbox.split(",").map(Number);

/**
 * How big the frames are, as pixels at the size of the canvas they are drawn for: the widest and the tallest figure of the
 * set. `drawnAt` is the fraction of the canvas they were drawn at (a probe is drawn smaller, so that nothing touches the
 * edge). `touching` says a frame is cut off at the edge, so its size is only a lower bound.
 */
export function extentOf(
  results: readonly RenderResult[],
  drawnAt = 1,
): { width: number; height: number; touching: boolean } {
  let width = 0;
  let height = 0;
  let touching = false;
  for (const result of results) {
    if (!result.ok) {
      continue;
    }
    if (result.stats.flags.split("|").includes("clipped_at_edge")) {
      touching = true;
    }
    const [left = 0, top = 0, right = 0, bottom = 0] = boxOf(result.stats.bbox);
    width = Math.max(width, (right - left + 1) / drawnAt);
    height = Math.max(height, (bottom - top + 1) / drawnAt);
  }
  return { width, height, touching };
}

/** The factor a set whose frames are `extent` px across is drawn at, so that each fits and can be slid clear of the edge. */
export const fitFactor = (extent: { width: number; height: number }) =>
  Math.min(1, FIT_EXTENT / Math.max(1, extent.width), FIT_EXTENT / Math.max(1, extent.height));

interface Fitted {
  /** The frames, or null when the figure would have to be drawn too small, or does not settle. */
  results: RenderResult[] | null;
  canvas: CanvasFit;
  batches: number;
}

/**
 * Draws the frames on the still's canvas, as the still was. When none touches the edge (after the kit has slid it clear),
 * that is the set. When one does, a probe at half size measures how big the frames really are, and the set is drawn again, all
 * frames alike, at the size at which the biggest of them fits. A frame that does not render is that frame's failure, left for
 * `assembleFrameSet` to name. No results means the figure would have to be drawn too small, or does not settle.
 */
async function renderFitted(
  renderBatch: BatchRenderer,
  code: string,
  still: CanvasFit,
  directions: readonly CreatureDirection[],
): Promise<Fitted> {
  const first = await renderBatch(frameRequests(code, still, directions));
  // a failure of the batch is every frame's, and a smaller figure will not mend it
  if (first.some((result) => !result.ok)) {
    return { results: first, canvas: still, batches: 1 };
  }
  if (!extentOf(first).touching) {
    return { results: first, canvas: still, batches: 1 };
  }
  const probeCanvas: CanvasFit = { ...still, scale: still.scale * PROBE_SCALE };
  const probe = await renderBatch(frameRequests(code, probeCanvas, directions));
  if (probe.some((result) => !result.ok)) {
    return { results: probe, canvas: probeCanvas, batches: 2 };
  }
  const probed = extentOf(probe, PROBE_SCALE);
  if (probed.touching) {
    return { results: null, canvas: still, batches: 2 };
  }
  let canvas: CanvasFit = { ...still, scale: still.scale * fitFactor(probed) * FIT_SLACK };
  let batches = 2;
  for (let tries = 1; tries <= MAX_FINAL_TRIES; tries++) {
    if (canvas.scale < still.scale * MIN_SHRINK) {
      return { results: null, canvas, batches };
    }
    batches++;
    const results = await renderBatch(frameRequests(code, canvas, directions));
    if (results.some((result) => !result.ok)) {
      return { results, canvas, batches };
    }
    if (!extentOf(results).touching) {
      return { results, canvas, batches };
    }
    canvas = { ...canvas, scale: canvas.scale * SHRINK_STEP };
  }
  return { results: null, canvas, batches };
}

async function renderDirections(
  renderBatch: BatchRenderer,
  code: string,
  still: CanvasFit,
  directions: readonly CreatureDirection[],
): Promise<FrameSetResult & { batches: number }> {
  const fitted = await renderFitted(renderBatch, code, still, directions);
  if (!fitted.results) {
    return { ok: false, kind: "fit", reason: "the figure does not fit its frame", batches: fitted.batches };
  }
  const assembled = assembleFrameSet(fitted.results, directions);
  return assembled.ok
    ? { ...assembled, canvas: fitted.canvas, batches: fitted.batches }
    : { ...assembled, batches: fitted.batches };
}

/**
 * Renders a creature's frame set from its code and packs it: drawn from every direction when it can be (every frame
 * renders, none is blank, the walk moves from every side, the sides differ and the figure fits the canvas at a size
 * near its still's), else from its one south-east side, as creatures were drawn before directions. `still` is the canvas
 * the still was drawn on (`canvasOfStill`).
 */
export async function renderFrameSet(
  renderBatch: BatchRenderer,
  code: string,
  still: CanvasFit,
): Promise<FrameSetOutcome> {
  const all = await renderDirections(renderBatch, code, still, CREATURE_DIRECTIONS);
  if (all.ok) {
    return { ...all, earlier: [] };
  }
  const one = await renderDirections(renderBatch, code, still, [STILL_DIRECTION]);
  return { ...one, batches: all.batches + one.batches, earlier: [all.kind] };
}
