import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  clampProposal,
  directorSchema,
  type EngagementKind,
  EVEN_MIX,
  mayEase,
  type Proposal,
  rulesDirector,
  tideRange,
} from "./director";
import { engagementOf, heldTide, type RecordedEngagement } from "./engagement";
import { applyDirector, newLegacy, parseLegacy, setRulesDirector } from "./legacy";
import { rulesTide } from "./sim";

// [step, moveX, moveY, strike, shot, aimX, aimY]
type Row = [number, number, number, number, number, number, number];
const row = (step: number, moveX: number, moveY: number, strike = 0, shot = 0): Row => [
  step,
  moveX,
  moveY,
  strike,
  shot,
  -1,
  -1,
];

/** A 40 s night of `steps` steps in which the warden walks for `movingSteps` of them, in one stretch from the start, and acts `actions` times. */
function night(movingSteps: number, actions: number, overrides: Partial<RecordedEngagement> = {}): RecordedEngagement {
  const steps = 2400;
  const rows: Row[] = [row(0, movingSteps > 0 ? 1 : 0, 0)];
  if (movingSteps > 0 && movingSteps < steps) rows.push(row(movingSteps, 0, 0));
  for (let action = 0; action < actions; action++) rows.push(row(movingSteps + 10 + action * 5, 0, 0, 1, 0));
  rows.sort((first, second) => first[0] - second[0]);
  return { inputs: rows, steps, outcome: "dark", ...overrides };
}

describe("the engagement of a night", () => {
  test("a warden who moves and acts is engaged", () => {
    const engagement = engagementOf(night(1200, 20));
    expect(engagement.kind).toBe("engaged");
    expect(engagement.movingShare).toBe(0.5);
    expect(engagement.strikes).toBe(20);
    expect(engagement.actionsPerMinute).toBe(30);
  });

  test("one who stands still and does little is idle", () => {
    expect(engagementOf(night(0, 0)).kind).toBe("idle");
    expect(engagementOf(night(200, 3)).kind).toBe("idle"); // 8% moving, 4.5 actions a minute
  });

  test("moving under 15% of the night is idle only while hardly acting: a warden who stands his ground and fights is engaged", () => {
    expect(engagementOf(night(300, 3)).kind).toBe("idle"); // 12.5% moving, 4.5 a minute
    expect(engagementOf(night(300, 5)).kind).toBe("engaged"); // 7.5 a minute
    expect(engagementOf(night(400, 1)).kind).toBe("engaged"); // 16.7% moving, hardly acting: moving is enough
  });

  test("a night with most of its real time away is paused, but only with the real time and at least 10 s of it", () => {
    const played = night(1200, 20);
    expect(engagementOf({ ...played, hiddenSeconds: 0 }).kind).toBe("engaged");
    expect(engagementOf({ ...played, hiddenSeconds: 30 }).kind).toBe("engaged"); // 43% of the real time away
    const away = engagementOf({ ...played, hiddenSeconds: 80 });
    expect(away.kind).toBe("paused");
    expect(away.wallSeconds).toBe(120);
    expect(away.pausedSeconds).toBe(80);
    expect(away.pausedShare).toBe(0.67);
    expect(engagementOf({ ...night(1200, 20, { steps: 240 }), hiddenSeconds: 8 }).kind).not.toBe("paused"); // 67% away, but under 10 s
  });

  test("a slow device is not a paused one: only time the tab was hidden counts, however long the night took to play", () => {
    // the sim of a 10 frames a second device runs at half speed, so its real time is twice the sim's; nothing was hidden
    expect(engagementOf({ ...night(1200, 20), hiddenSeconds: 0 }).kind).toBe("engaged");
  });

  test("a play from before the hidden time was kept has no pause time and is judged on its inputs", () => {
    const engagement = engagementOf(night(1200, 20));
    expect(engagement.wallSeconds).toBeNull();
    expect(engagement.pausedSeconds).toBeNull();
    expect(engagement.kind).toBe("engaged");
  });

  test("a night that did not finish is left, whatever the warden did", () => {
    expect(engagementOf({ ...night(1200, 20), outcome: null }).kind).toBe("left");
    expect(engagementOf({ ...night(0, 0), outcome: null }).kind).toBe("left");
  });

  test("a night with no steps is idle, not a division by zero", () => {
    expect(engagementOf({ inputs: [], steps: 0, outcome: "dark" })).toMatchObject({ kind: "idle", movingShare: 0 });
  });
});

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  reasoning: "",
  tide: 0.8,
  mix: { satyr: 0.5, cyclops: 0.5, harpy: 0.6 },
  creatureShare: 0.1,
  line: "The sea draws back.",
  ...overrides,
});

describe("nothing gets easier after a night nobody played", () => {
  const away: EngagementKind[] = ["idle", "paused", "left"];

  test.each(away)("after a %s night the model's easing is clamped: tide, mix and share", (kind) => {
    const decision = clampProposal(proposal(), 1, 2, undefined, kind);
    expect(decision).toMatchObject({
      tide: 1,
      mix: { satyr: 1, cyclops: 1, harpy: 1 },
      creatureShare: 0.25,
      engagement: kind,
    });
  });

  test.each(away)("after a %s night the model may still push", (kind) => {
    const decision = clampProposal(
      proposal({ tide: 1.1, mix: { satyr: 1.5, cyclops: 0.4, harpy: 2 }, creatureShare: 0.4 }),
      1,
      2,
      undefined,
      kind,
    );
    expect(decision).toMatchObject({ tide: 1.1, mix: { satyr: 1.5, cyclops: 1, harpy: 2 }, creatureShare: 0.4 });
  });

  test("whatever the model returns, an idle night never eases", () => {
    for (const tide of [-3, 0, 0.4, 0.84, 0.99, 1, 1.07, 9])
      for (const weight of [-1, 0, 0.5, 0.99, 1, 1.5, 7])
        for (const share of [0, 0.1, 0.2, 0.25, 0.3, 1]) {
          const decision = clampProposal(
            proposal({ tide, mix: { satyr: weight, cyclops: weight, harpy: weight }, creatureShare: share }),
            1,
            2,
            undefined,
            "idle",
          );
          if (!decision) throw new Error("no decision");
          expect(decision.tide).toBeGreaterThanOrEqual(1);
          for (const mix of Object.values(decision.mix)) expect(mix).toBeGreaterThanOrEqual(1);
          expect(decision.creatureShare).toBeGreaterThanOrEqual(0.25);
        }
  });

  test("an engaged night, and one with no engagement on record, can still ease (as far as the bounds allow)", () => {
    expect(clampProposal(proposal(), 1, 2, undefined, "engaged")).toMatchObject({
      tide: 0.85,
      mix: { satyr: 0.5, cyclops: 0.5, harpy: 0.6 },
      creatureShare: 0.1,
    });
    expect(clampProposal(proposal(), 1, 2)?.tide).toBe(0.85);
    expect(tideRange(1, "idle")).toEqual([1, 1.15]);
    expect(tideRange(1)).toEqual([0.85, 1.15]);
    expect(mayEase(undefined)).toBe(true);
    expect(mayEase("engaged")).toBe(true);
    for (const kind of away) expect(mayEase(kind)).toBe(false);
  });

  test("a stored decision that eases after such a night does not validate, so it loads as the rules'", () => {
    const eased = { ...rulesDirector(1, 2), source: "mubit", tide: 0.9, line: "The sea draws back." };
    expect(directorSchema.safeParse({ ...eased, engagement: "engaged" }).success).toBe(true);
    expect(directorSchema.safeParse({ ...eased, engagement: "idle" }).success).toBe(false);
    expect(
      directorSchema.safeParse({ ...eased, tide: 1, mix: { ...EVEN_MIX, cyclops: 0.9 }, engagement: "idle" }).success,
    ).toBe(false);
    expect(directorSchema.safeParse({ ...eased, tide: 1, creatureShare: 0.2, engagement: "paused" }).success).toBe(
      false,
    );
    expect(directorSchema.safeParse({ ...eased, tide: 1.05, engagement: "idle" }).success).toBe(true);
    expect(directorSchema.safeParse(eased).success).toBe(true); // an old save has no engagement
  });

  test("the rules' director does not ease after such a night either", () => {
    const loss = {
      night: 3,
      outcome: "dark" as const,
      kills: 2,
      seconds: 18,
      lampsLost: 5,
      health: 38,
      maxHealth: 100,
    };
    const eased = rulesTide(1.1, loss);
    expect(eased).toBe(0.94);
    for (const kind of away) expect(heldTide(1.1, eased, kind)).toBe(1.1); // an idle, paused or left loss holds the tide
    expect(heldTide(1.1, eased, "engaged")).toBe(0.94); // an engaged loss still eases
    expect(heldTide(1.1, eased, undefined)).toBe(0.94); // so does a night with no engagement on record (an old save)
    // a dawn never eased, and a push after a night nobody played is kept
    const dawn = { ...loss, outcome: "dawn" as const, lampsLost: 0, health: 90, kills: 10, seconds: 40 };
    expect(heldTide(1.1, rulesTide(1.1, dawn), "idle")).toBe(rulesTide(1.1, dawn));
  });

  test("the game takes the model's answer after an idle night only as far as the bounds allow, against its own engagement", () => {
    const legacy = newLegacy(3);
    legacy.night = 3;
    setRulesDirector(legacy, 1, 2, "2026-10-24-16-11-46-juith2u0", "idle");
    const answer = {
      ...legacy.director,
      source: "mubit",
      tide: 0.86,
      mix: { satyr: 0.7, cyclops: 0.6, harpy: 0.8 },
      creatureShare: 0.15,
      line: "The sea draws back.",
      engagement: "engaged", // the server's claim; the game's own read of the night wins
    };
    // the schema refuses nothing here (an "engaged" decision may ease), but the game re-clamps against its own read
    expect(applyDirector(legacy, answer)).toBe(true);
    expect(legacy.tide).toBe(1);
    expect(legacy.director).toMatchObject({
      engagement: "idle",
      mix: { satyr: 1, cyclops: 1, harpy: 1 },
      creatureShare: 0.25,
    });
  });

  test("an old save, with no engagement, loads", () => {
    const legacy = newLegacy(3);
    const saved = JSON.parse(JSON.stringify(legacy));
    expect(saved.director.engagement).toBeUndefined();
    expect(parseLegacy(saved).director.source).toBe("rules");
    const idle = newLegacy(3);
    setRulesDirector(idle, 1, 0, undefined, "idle");
    expect(parseLegacy(JSON.parse(JSON.stringify(idle))).director.engagement).toBe("idle");
  });
});

// The nine plays real people recorded on 24 Oct 2026 are not in the repository. Where they are on this machine, the four
// nights that were played to the end read as engaged (one of them moves for 13% of the night but fights 26 times a
// minute), and the three nights left early read as left. None is idle: everyone who played moved and acted.
const REAL_PLAYS = "/tmp/lw-plays/plays.json";
describe.skipIf(!existsSync(REAL_PLAYS))("the recorded plays on this machine", () => {
  const plays: RecordedEngagement[] = JSON.parse(existsSync(REAL_PLAYS) ? readFileSync(REAL_PLAYS, "utf8") : "[]");
  test("every night played to its end is engaged, every night left early is left, and none is idle or paused", () => {
    expect(plays).toHaveLength(9);
    for (const play of plays) expect(engagementOf(play).kind).toBe(play.outcome === null ? "left" : "engaged");
  });
});
