// Draws a creature from the sea in the player's browser. The server delivers its build code, not an image; this fetches the
// code, checks it against the record, runs it in a Web Worker (src/scene/creature-worker.ts: QuickJS compiled to
// WebAssembly, no host functions, a fresh runtime, memory and stack limits) and checks the pixels it drew against the
// record (src/game/creature-build.ts). The scene's texture and the title panel's portrait both come from the pixels this
// returns, so they are always the same render.
//
// The worker is created when a creature is announced and terminated as soon as it answers or its deadline passes, so
// nothing is loaded for a night without a creature and nothing is kept for one that has been drawn. Any failure, a code
// fetch that fails, a hash that does not match, a worker error or a deadline, is null: no creature that night.

import { RENDER_LIMITS } from "../../pipeline/quickjs-limits";
import { type Creature, creatureCodePath } from "../game/creature";
import { type CreatureCodeSource, drawCreature } from "../game/creature-build";
import type { DrawReply, DrawRequest } from "./creature-worker";

/** The whole draw gets this long, from creating the worker (which fetches the WebAssembly) to having the pixels. */
const DRAW_DEADLINE_MILLISECONDS = 5000;
/** The interpreter stops itself this much earlier, so an endless loop ends as a failed render and not as a kill. */
const INTERPRETER_MARGIN_MILLISECONDS = 1000;
const CODE_FETCH_TIMEOUT_MILLISECONDS = 5000;
const MAXIMUM_CODE_CHARACTERS = 100_000;

function isDrawReply(value: unknown): value is DrawReply {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** What a draw came to: the pixels, or why not (a short reason, for the probes and the console, never shown to a player). */
export type DrawResult =
  | {
      ok: true;
      pixels: Uint8Array<ArrayBuffer>;
      milliseconds: number;
      loadMilliseconds: number;
      runMilliseconds: number;
    }
  | { ok: false; reason: string; milliseconds: number };

/**
 * Runs `code` in a new worker. The worker is gone when this settles, whatever happened in it. This does not check the code
 * against anything: it is for `drawCreature`, which checks it first, and for the visual verifier's probes.
 */
export function drawInWorker(code: string, deadlineMilliseconds = DRAW_DEADLINE_MILLISECONDS): Promise<DrawResult> {
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    const started = performance.now();
    const finish = (result: { ok: false; reason: string } | { ok: true; reply: Extract<DrawReply, { ok: true }> }) => {
      clearTimeout(timer);
      worker?.terminate();
      const milliseconds = performance.now() - started;
      if (!result.ok) return resolve({ ...result, milliseconds });
      const { reply } = result;
      performance.measure("creature-draw", {
        start: started,
        end: performance.now(),
        detail: { loadMilliseconds: reply.loadMilliseconds, runMilliseconds: reply.runMilliseconds },
      });
      resolve({
        ok: true,
        pixels: new Uint8Array(reply.pixels),
        milliseconds,
        loadMilliseconds: reply.loadMilliseconds,
        runMilliseconds: reply.runMilliseconds,
      });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "deadline" }), deadlineMilliseconds);
    try {
      worker = new Worker(new URL("./creature-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const reply = event.data;
        if (!isDrawReply(reply)) return finish({ ok: false, reason: "unexpected reply" });
        finish(reply.ok ? { ok: true, reply } : { ok: false, reason: reply.reason });
      };
      worker.onerror = () => finish({ ok: false, reason: "worker error" });
      worker.onmessageerror = () => finish({ ok: false, reason: "worker message error" });
      const request: DrawRequest = {
        code,
        limits: { ...RENDER_LIMITS, timeoutMilliseconds: deadlineMilliseconds - INTERPRETER_MARGIN_MILLISECONDS },
      };
      worker.postMessage(request);
    } catch {
      finish({ ok: false, reason: "no worker" });
    }
  });
}

async function fetchCode(creatureId: string, fresh = false): Promise<string | null> {
  const response = await fetch(creatureCodePath(creatureId), {
    signal: AbortSignal.timeout(CODE_FETCH_TIMEOUT_MILLISECONDS),
    ...(fresh ? { cache: "reload" } : {}),
  });
  if (!response.ok) return null;
  const code = await response.text();
  return code.length <= MAXIMUM_CODE_CHARACTERS ? code : null;
}

const browserSource: CreatureCodeSource = {
  fetchCode,
  draw: async (code) => {
    const result = await drawInWorker(code);
    return result.ok ? result.pixels : null;
  },
};

const draws = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

/**
 * The creature's pixels, drawn once per page and shared by everything that shows it. A failed draw is forgotten, so a
 * later night may try again. A creature without `build` has no code to draw (it has a PNG, see layers.ts).
 */
export function creaturePixels(creature: Pick<Creature, "id" | "build">): Promise<Uint8Array<ArrayBuffer> | null> {
  // keyed by the hashes too, so pixels checked against one record are never handed out for another
  const key = `${creature.id}/${creature.build?.codeSha256}/${creature.build?.pixelsSha256}`;
  let draw = draws.get(key);
  if (!draw) {
    draw = drawCreature(creature, browserSource).then((pixels) => {
      if (!pixels) draws.delete(key);
      return pixels;
    });
    draws.set(key, draw);
  }
  return draw;
}
