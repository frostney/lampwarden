import { describe, expect, test } from "bun:test";
import {
  CREATURE_SHARE_MAX,
  CREATURE_SHARE_MIN,
  checkedDecision,
  clampProposal,
  cleanLine,
  DEFAULT_CREATURE_SHARE,
  type Director,
  directorFrom,
  directorSchema,
  EVEN_MIX,
  LINE_MAX,
  MIX_MAX,
  MIX_MIN,
  type Proposal,
  parseProposal,
  rulesDirector,
  TIDE_SPAN,
  tideRange,
} from "./director";

const PLAY_ID = "2026-10-24-16-11-46-juith2u0";

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  reasoning: "they lost early",
  expectedEffect: "two lamps at dawn",
  tide: 1,
  mix: { satyr: 1, cyclops: 1, harpy: 1 },
  creatureShare: 0.25,
  line: "The sea draws back.",
  ...overrides,
});

describe("the bounds", () => {
  test("the tide stays within 0.15 of the rules' tide, whatever the model asks", () => {
    for (const rules of [0.6, 0.85, 1, 1.3, 2]) {
      for (const asked of [-5, 0, 0.3, 0.9, 1, 1.4, 2.5, 99, Number.MAX_VALUE]) {
        const decision = clampProposal(proposal({ tide: asked }), rules, 2);
        if (!decision) throw new Error("no decision");
        expect(Math.abs(decision.tide - rules)).toBeLessThanOrEqual(TIDE_SPAN + 1e-9);
        expect(decision.tide).toBeGreaterThanOrEqual(0.6);
        expect(decision.tide).toBeLessThanOrEqual(2);
      }
    }
  });

  test("a tide inside the range is kept, and one outside lands on the edge of it", () => {
    expect(clampProposal(proposal({ tide: 0.95 }), 1, 1)?.tide).toBe(0.95);
    expect(clampProposal(proposal({ tide: 1.9 }), 1, 1)?.tide).toBe(1.15);
    expect(clampProposal(proposal({ tide: 0.1 }), 1, 1)?.tide).toBe(0.85);
    expect(tideRange(0.6)).toEqual([0.6, 0.75]);
    expect(tideRange(2)).toEqual([1.85, 2]);
  });

  test("each mix weight is clamped to 0.5..2 and the creature share to 0.1..0.4", () => {
    const wild = clampProposal(proposal({ mix: { satyr: -3, cyclops: 17, harpy: 1.234 }, creatureShare: 0.9 }), 1, 1);
    expect(wild?.mix).toEqual({ satyr: MIX_MIN, cyclops: MIX_MAX, harpy: 1.23 });
    expect(wild?.creatureShare).toBe(CREATURE_SHARE_MAX);
    expect(clampProposal(proposal({ creatureShare: 0 }), 1, 1)?.creatureShare).toBe(CREATURE_SHARE_MIN);
  });

  test("the line is plain, at most 90 characters, and a proposal with no line to show is no decision", () => {
    const long = "The sea draws back and lets the whole harbour breathe, for it has grown tired of the long night.";
    const clamped = clampProposal(proposal({ line: long }), 1, 1);
    expect(clamped?.line.length).toBeLessThanOrEqual(LINE_MAX);
    expect(clamped?.line.endsWith("…")).toBe(true);
    const markup = clampProposal(proposal({ line: "**Bold** <b>html</b> [link](http://x.y) `code` \n\n done" }), 1, 1);
    expect(markup?.line).toBe("Bold b html b link (http: x.y) code done");
    expect(markup?.line).not.toMatch(/[<>*`[\]/\n]/);
    expect(clampProposal(proposal({ line: "  \n <>*  " }), 1, 1)).toBeNull();
    expect(clampProposal(proposal({ line: "" }), 1, 1)).toBeNull();
  });

  test("cleanLine keeps Greek letters, apostrophes and the usual punctuation", () => {
    expect(cleanLine("Thálassa — the sea's patient (still) answer…")).toBe(
      "Thálassa — the sea's patient (still) answer…",
    );
    expect(cleanLine("😀 hello 🌊")).toBe("hello");
  });

  test("everything a clamped decision holds passes the stored schema", () => {
    for (const tide of [0.2, 1, 3]) {
      const decision = clampProposal(proposal({ tide, line: "x".repeat(300) }), 1.2, 4, PLAY_ID);
      expect(directorSchema.safeParse(decision).success).toBe(true);
    }
  });
});

describe("reading the model's reply", () => {
  const json = JSON.stringify(proposal());
  test("plain JSON, JSON in a code fence and JSON after a few words all parse", () => {
    expect(parseProposal(json)?.tide).toBe(1);
    expect(parseProposal(`\`\`\`json\n${json}\n\`\`\``)?.tide).toBe(1);
    expect(parseProposal(`Here is my decision: ${json} Hope that helps.`)?.tide).toBe(1);
  });
  test("not JSON, truncated JSON and JSON of the wrong shape are no proposal", () => {
    expect(parseProposal("The sea eases off.")).toBeNull();
    expect(parseProposal(json.slice(0, 40))).toBeNull();
    expect(parseProposal('{"tide": "high"}')).toBeNull();
    expect(parseProposal(JSON.stringify({ ...proposal(), mix: { satyr: 1 } }))).toBeNull();
    expect(parseProposal("")).toBeNull();
  });
  test("a reasoning that is not text is dropped, not fatal", () => {
    expect(parseProposal(JSON.stringify({ ...proposal(), reasoning: 5 }))?.reasoning).toBe("");
  });
});

describe("the stored decision", () => {
  const decision = (): Director => {
    const clamped = clampProposal(proposal({ tide: 0.9, mix: { satyr: 1, cyclops: 0.6, harpy: 1.4 } }), 1, 2, PLAY_ID);
    if (!clamped) throw new Error("no decision");
    return clamped;
  };

  test("what the game saved comes back as it was", () => {
    const saved = decision();
    expect(directorFrom(JSON.parse(JSON.stringify(saved)), saved.tide, 3)).toEqual(saved);
  });

  test("nothing, junk, an out-of-bounds decision or one for another tide is the rules'", () => {
    const rules = rulesDirector(1.2, 2);
    expect(directorFrom(undefined, 1.2, 3)).toEqual(rules);
    expect(directorFrom("mubit", 1.2, 3)).toEqual(rules);
    expect(directorFrom({ ...decision(), mix: { ...EVEN_MIX, cyclops: 9 } }, 0.9, 3).source).toBe("rules");
    expect(directorFrom({ ...decision(), creatureShare: 0.9 }, 0.9, 3).source).toBe("rules");
    expect(directorFrom({ ...decision(), line: "x".repeat(91) }, 0.9, 3).source).toBe("rules");
    expect(directorFrom({ ...decision(), line: "<script>" }, 0.9, 3).source).toBe("rules");
    expect(directorFrom({ ...decision(), tide: 1.4 }, 1.4, 3).source).toBe("rules"); // 0.4 from the rules' tide
    expect(directorFrom(decision(), 1.0, 3).source).toBe("rules"); // the legacy's tide is not the decision's
  });

  test("a decision that says it is the rules' but changes the numbers is the rules' with none of them", () => {
    const sneaky = { ...decision(), source: "rules" };
    const read = directorFrom(sneaky, 0.9, 3);
    expect(read.mix).toEqual(EVEN_MIX);
    expect(read.creatureShare).toBe(DEFAULT_CREATURE_SHARE);
    expect(read.line).toBe("");
  });

  test("a decision from the network is brought inside the bounds against the game's own rules' tide", () => {
    const received = JSON.parse(JSON.stringify(decision()));
    expect(checkedDecision(received, 1)).toEqual(decision());
    // the game computed a rules' tide of 0.8, so a tide of 0.9 is 0.1 away: kept; a rules' tide of 0.6 would make it 0.3 away: pulled in
    expect(checkedDecision(received, 0.8)?.tide).toBe(0.9);
    expect(checkedDecision(received, 0.6)?.tide).toBe(0.75);
    expect(checkedDecision({ ...received, source: "rules" }, 1)).toBeNull();
    expect(checkedDecision({ ...received, mix: { satyr: 1 } }, 1)).toBeNull();
    expect(checkedDecision(null, 1)).toBeNull();
  });
});
