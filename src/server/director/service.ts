// What POST /api/director does, with everything it touches injected (store, clock, model, prompt), so the tests need no
// network. The route is thin: it validates the request and calls `decide`.
//
// The contract with the game: the answer is always a decision it can play. The model's when it answered in time and
// validly; the rules' (source "rules") when it did not, with the reason. Only a play the server cannot find or read is
// an error, and the game treats that as the rules' too.
import {
  clampProposal,
  type Director,
  directorFrom,
  type FallbackReason,
  parseProposal,
  rulesDirector,
} from "@/game/director";
import { type MubitClient, shortSha } from "../../../pipeline/mubit";
import { checkStartLimits, visitorKey } from "../creatures/limits";
import type { DirectorConfig } from "./config";
import type { DecisionLog, MubitCall } from "./log";
import type { DirectorStore } from "./store";
import { type PreviousReasoning, rulesTideAfter, type StoredPlay, storedPlaySchema, summarise } from "./summary";

const PLAY_RETRIES = 3;
const PLAY_RETRY_DELAY_MILLISECONDS = 700;
const MAX_TOKENS = 700;
const TASK = "director";

export interface DirectorDeps {
  store: DirectorStore;
  now: () => Date;
  config: DirectorConfig;
  /** The model, or null where there is no key. */
  model: MubitClient | null;
  /** The system prompt, identical on every call so the calls group and the prompt is cached. */
  prompt: string;
  sleep: (milliseconds: number) => Promise<void>;
  /** Where the structured log lines go (the function's stdout in production). */
  log: (entry: Record<string, unknown>) => void;
  /** Past this long, whatever is still waiting (a slow store, say) is given up and the rules answer. */
  deadlineMilliseconds: number;
}

export interface DirectorInput {
  playId: string;
  /** The caller's address, for the per-visitor limit; hashed and never stored. */
  ip: string | null;
}

export type DirectorResult =
  | { kind: "decision"; decision: Director; fallback: FallbackReason | null }
  | { kind: "no-play" };

/** The recorded play, looked for a few times: the game asks as its upload finishes, and a blob may take a moment. */
async function loadPlay(deps: DirectorDeps, playId: string): Promise<StoredPlay | null> {
  for (let attempt = 0; attempt < PLAY_RETRIES; attempt++) {
    if (attempt > 0) await deps.sleep(PLAY_RETRY_DELAY_MILLISECONDS);
    try {
      const parsed = storedPlaySchema.safeParse(await deps.store.getPlay(playId));
      if (parsed.success) return parsed.data.id === playId ? parsed.data : null;
    } catch {
      // storage hiccup: look again
    }
  }
  return null;
}

/**
 * What the model said about the decision this play was played under, from the log of the play that decision answered.
 * The id comes from the uploaded play, so the log is used only when it is of the same session: a forged id cannot read
 * another player's.
 */
async function previousReasoning(deps: DirectorDeps, play: StoredPlay): Promise<PreviousReasoning | null> {
  const previousPlayId = directorFrom(play.legacy.director, play.legacy.tide, play.legacy.night).playId;
  if (previousPlayId === undefined) return null;
  try {
    const log = await deps.store.getDecision(previousPlayId);
    return log && log.source === "mubit" && log.session === play.session ? { reasoning: log.reasoning } : null;
  } catch {
    return null;
  }
}

function failureReason(status: number | null, error: string | null | undefined): FallbackReason {
  if (status === 429) return "rate-limited"; // Mubit's own throttle, told apart from a fault in the logs
  return error && /timeout|abort/i.test(error) ? "timeout" : "error";
}

export async function decide(deps: DirectorDeps, input: DirectorInput): Promise<DirectorResult> {
  const began = performance.now();
  const found = await loadPlay(deps, input.playId);
  if (!found) return { kind: "no-play" };
  const play: StoredPlay = found;

  const rules = rulesDirector(rulesTideAfter(play), play.legacy.night, play.id);
  const fallback = (reason: FallbackReason): DirectorResult => ({
    kind: "decision",
    decision: rules,
    fallback: reason,
  });
  const lookedUp = performance.now();

  async function ask(): Promise<DirectorResult> {
    // asked before: the same play gets the same answer, so a retry or a second tab costs nothing
    const earlier = await deps.store.getDecision(play.id);
    if (earlier && earlier.source === "mubit") return { kind: "decision", decision: earlier.decision, fallback: null };

    const { model, config } = deps;
    if (!model || config.rateSalt === null) return fallback("unavailable");
    const now = deps.now();
    const visitor = visitorKey(input.ip, config.rateSalt);
    if (!(await checkStartLimits(deps.store, now, visitor, config.limits)).allowed) return fallback("rate-limited");
    const limited = performance.now();

    const summary = summarise(play, await previousReasoning(deps, play));
    const session = /^[a-z0-9]{1,40}$/.test(play.session) ? play.session : "anon";
    // the call is marked for the limits while the model thinks, not before
    const [call] = await Promise.all([
      model.call(
        TASK,
        deps.prompt,
        [
          {
            role: "user",
            content: `Night report (data):\n${JSON.stringify(summary)}\n\nReply with the JSON object only.`,
          },
        ],
        session,
        { play: play.id, night: play.legacy.night },
        MAX_TOKENS,
      ),
      deps.store.recordCall(visitor, play.id, now).catch(() => undefined),
    ]);
    const answered = performance.now();
    const proposal = call.text === null ? null : parseProposal(call.text);
    const decision = proposal && clampProposal(proposal, rules.rulesTide, play.legacy.night, play.id);
    const reason: FallbackReason | null =
      call.text === null ? failureReason(call.record.status, call.record.error) : decision ? null : "invalid";

    const mubit: MubitCall = {
      requestId: call.record.rid,
      status: call.record.status,
      milliseconds: call.record.ms,
      inputTokens: call.record.in_tokens,
      outputTokens: call.record.out_tokens,
      cacheCreationInputTokens: call.record.cache_creation_input_tokens,
      cacheReadInputTokens: call.record.cache_read_input_tokens,
      promptSha: shortSha(deps.prompt),
    };
    const log: DecisionLog = {
      v: 1,
      playId: play.id,
      session,
      at: now.toISOString(),
      night: play.legacy.night,
      source: decision ? "mubit" : "rules",
      fallback: reason,
      decision: decision ?? rules,
      reasoning: proposal?.reasoning ?? "",
      summary,
      mubit,
      stagesMilliseconds: {
        lookup: Math.round(lookedUp - began),
        limits: Math.round(limited - lookedUp),
        model: Math.round(answered - limited),
        total: Math.round(performance.now() - began),
      },
    };
    try {
      // a concurrent call for the same play may have decided first: its decision stands, so what the player played and
      // what the log says the model reasoned about stay one decision
      const decidedMeanwhile = decision ? await deps.store.getDecision(play.id) : null;
      if (decidedMeanwhile && decidedMeanwhile.source === "mubit")
        return { kind: "decision", decision: decidedMeanwhile.decision, fallback: null };
      await deps.store.putDecision(log);
    } catch (error) {
      deps.log({ event: "director-log-failed", kind: error instanceof Error ? error.name : "unknown" });
    }
    deps.log({
      event: "director-decision",
      play: play.id,
      night: play.legacy.night,
      source: log.source,
      fallback: reason,
      requestId: mubit.requestId,
      milliseconds: mubit.milliseconds,
      stagesMilliseconds: log.stagesMilliseconds,
      tide: log.decision.tide,
      mix: log.decision.mix,
      creatureShare: log.decision.creatureShare,
      line: log.decision.line,
      reasoning: log.reasoning,
      cacheRead: mubit.cacheReadInputTokens ?? 0,
    });
    return { kind: "decision", decision: log.decision, fallback: reason };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<DirectorResult>((resolve) => {
    timer = setTimeout(() => {
      deps.log({ event: "director-deadline", play: play.id, milliseconds: deps.deadlineMilliseconds });
      resolve(fallback("timeout"));
    }, deps.deadlineMilliseconds);
  });
  try {
    return await Promise.race([ask(), deadline]);
  } catch (error) {
    deps.log({ event: "director-failed", kind: error instanceof Error ? error.name : "unknown" });
    return fallback("error");
  } finally {
    clearTimeout(timer);
  }
}
