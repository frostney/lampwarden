// What the sea sends tonight, for anything the sea can send (a creature, a building): one question to the gallery at a
// time, asked with the ids the line has met, and the job that answers it followed for as long as the answer still
// matters. src/game/sea.ts is this for creatures, src/game/building-sea.ts for the plaza's buildings.
//
// The game asks when a night begins as well as when it ends. A night that begins asks for the NEXT night's one, so a job
// that takes about a minute is generated while the player plays and it is ready by dawn. Asking again about the same
// question (the same ids met) keeps the running one: a job that is still being made when a night begins is not dropped,
// it carries on through the night. It never blocks play: while it is asking, when nothing is coming and when the network
// fails, the answer is "none" and the night simply goes without.
import type { JobStep } from "./creature";
import type { WaitOptions } from "./gallery-api";

export type GalleryTonight<Ready> = { kind: "none" } | Ready | { kind: "generating"; step: JobStep };

/** What the gallery says, whatever it holds. */
export type GalleryAnswer<Made> =
  | { kind: "ready"; made: Made }
  | { kind: "generating"; jobId: string }
  // `retryAfterSeconds` is how long to wait: a short one means the single slot is busy and the question will be answered
  // soon, so it is asked again; a long one is a limit, and the question is let go
  | { kind: "none"; retryAfterSeconds?: number | undefined };

export interface GallerySeaDeps<Made extends { id: string }, Ready> {
  ask: (seen: string[]) => Promise<GalleryAnswer<Made> | null>;
  wait: (jobId: string, options: WaitOptions) => Promise<Made | null>;
  /** How a finished one is shown: `{ kind: "ready", creature }`. */
  ready: (made: Made) => Ready;
  /** Waits between asks after a "busy" answer; the clock in the game, the test's own in a test. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** The longest delay that is taken to mean "the slot is busy, ask again" and not "a limit has been reached". */
const BUSY_RETRY_LIMIT_SECONDS = 30;
/** How many times a busy answer is asked again before it is let go (8 asks of at most 30 s each: a long job's length). */
const BUSY_RETRIES = 8;

interface Asking {
  /** The question: the ids the line has met. */
  key: string;
  /** False once it ended with nothing to show (none coming, the job failed, the network failed, the sprite broke). */
  alive: boolean;
  madeId: string | null;
  /** Settles when the question has been answered, and the job it started, if any, has finished or been let go. */
  answering: Promise<void>;
}

export function createGallerySea<Made extends { id: string }, Ready extends { kind: "ready" }>(
  deps: GallerySeaDeps<Made, Ready>,
) {
  const none: GalleryTonight<Ready> = { kind: "none" };
  let tonight: GalleryTonight<Ready> = none;
  let generation = 0; // which asking is current; an older one's answer is dropped
  let current: Asking | null = null;
  const listeners = new Set<() => void>();
  const sleep = deps.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const show = (next: GalleryTonight<Ready>) => {
    tonight = next;
    for (const listener of listeners) listener();
  };

  /**
   * Asks the sea what comes next, given the ids the line has met. The same question while its asking is still alive (in
   * flight, being made, or ready) changes nothing; otherwise what it answers replaces what was shown. `after` holds the
   * question back until it has settled (the buildings wait for the creature's question, which goes first).
   */
  const ask = (seen: readonly string[], after?: Promise<void>) => {
    const key = [...seen].sort().join(",");
    if (current?.key === key && current.alive) return;
    const mine = ++generation;
    const isCurrent = () => mine === generation;
    const asking: Asking = { key, alive: true, madeId: null, answering: Promise.resolve() };
    current = asking;
    show(none);
    const answering = (async () => {
      if (after) {
        await after;
        if (!isCurrent()) return;
      }
      let answer = await deps.ask([...seen]);
      for (let retries = 0; ; retries++) {
        if (!isCurrent()) return;
        const delay = answer?.kind === "none" ? answer.retryAfterSeconds : undefined;
        if (delay === undefined || delay > BUSY_RETRY_LIMIT_SECONDS || retries >= BUSY_RETRIES) break;
        await sleep(delay * 1000);
        if (!isCurrent()) return;
        answer = await deps.ask([...seen]);
      }
      if (!isCurrent()) return;
      if (!answer || answer.kind === "none") {
        asking.alive = false;
        return;
      }
      if (answer.kind === "ready") {
        asking.madeId = answer.made.id;
        show(deps.ready(answer.made));
        return;
      }
      show({ kind: "generating", step: "queued" });
      const made = await deps.wait(answer.jobId, {
        onStep: (step) => isCurrent() && show({ kind: "generating", step }),
        isCurrent,
      });
      if (!isCurrent()) return;
      asking.madeId = made?.id ?? null;
      asking.alive = made !== null;
      show(made ? deps.ready(made) : none);
    })();
    asking.answering = answering;
    // the game's own calls never throw, but whatever is injected may: the asking ends and the next one is a new one
    answering.catch(() => {
      if (!isCurrent()) return;
      asking.alive = false;
      show(none);
    });
  };

  // It cannot come after all (its sprite did not load): nothing is announced, and the next asking is a new one.
  const withdraw = (id: string) => {
    if (current?.madeId !== id) return;
    current.alive = false;
    if (tonight.kind === "ready") show(none);
  };

  // The page goes: whatever is still being made is no longer waited for.
  const dispose = () => {
    generation++;
    current = null;
  };

  /** Settles when the current question has been answered and its job, if it started one, is over. Never rejects. */
  const settled = () => (current ? current.answering.catch(() => {}) : Promise.resolve());

  const get = () => tonight;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, subscribe, ask, withdraw, dispose, settled };
}
