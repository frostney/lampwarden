import { describe, expect, test } from "bun:test";

import {
  BUILDING_BRIEF_TASK,
  buildingRequestMessage,
  parseBuildingBrief,
  pickBuildingInspiration,
  writeBuildingBrief,
} from "./building-brief";
import { buildingBriefJson, fakeModel } from "./fakes";
import { MUBIT_MESSAGES_URL, MUBIT_MODEL } from "./mubit";

describe("validating a building brief", () => {
  const expected = {
    name: "Stoa of the net-menders",
    brief:
      "long Ionic marble colonnade, two columns across the front and ten along each side, with a terracotta tiled roof",
  };

  test("accepts the documented shape, also inside a fence or with chatter around it", () => {
    expect(parseBuildingBrief(buildingBriefJson())).toEqual(expected);
    expect(parseBuildingBrief(`\`\`\`json\n${buildingBriefJson()}\n\`\`\``)).toEqual(expected);
    expect(parseBuildingBrief(`Here it is: ${buildingBriefJson()} Enjoy!`)).toEqual(expected);
  });

  test("never lets the model place or measure the building itself", () => {
    const parsed = parseBuildingBrief(buildingBriefJson({ anchorY: 0.5, extent: { hull: [] }, score: 10, x: 400 }));
    expect(parsed).toEqual(expected);
  });

  test.each([
    ["no reply", null],
    ["no JSON", "I would suggest a granary."],
    ["broken JSON", '{"name": "Granary",'],
    ["a name that is too long", buildingBriefJson({ name: "x".repeat(41) })],
    ["a one-character name", buildingBriefJson({ name: "x" })],
    ["a sprite brief that is too long", buildingBriefJson({ brief: "x".repeat(401) })],
    ["a missing sprite brief", JSON.stringify({ name: "Granary" })],
  ])("rejects %s", (_description, reply) => {
    expect(parseBuildingBrief(reply)).toBeNull();
  });
});

describe("the building brief writer's Mubit call", () => {
  test("sends the documented request under its own task: Mubit URL, model, cached system prompt, no temperature", async () => {
    const model = fakeModel([buildingBriefJson()]);
    const records: Record<string, unknown>[] = [];
    const result = await writeBuildingBrief(
      { model: model.client, prompt: "BUILDING PROMPT", random: () => 0, onCall: (record) => records.push(record) },
      ["Fountain house", "Granary"],
      "session-1",
    );
    expect(result.ok).toBe(true);
    expect(model.urls).toEqual([MUBIT_MESSAGES_URL]);
    const [request] = model.sent;
    expect(request?.model).toBe(MUBIT_MODEL);
    expect(request).not.toHaveProperty("temperature");
    expect(request?.system).toEqual([{ type: "text", text: "BUILDING PROMPT", cache_control: { type: "ephemeral" } }]);
    const message = JSON.stringify(request?.messages);
    for (const name of ["Fountain house", "Granary", "Temple", "House", "Stall"]) {
      expect(message).toContain(name);
    }
    expect(message).toContain("stoa"); // the kind picked when random() is 0
    // its own Mubit task, apart from the creatures' "brief"
    expect(BUILDING_BRIEF_TASK).not.toBe("brief");
    expect(records[0]).toMatchObject({ task: BUILDING_BRIEF_TASK, status: 200 });
    expect(JSON.stringify(records)).not.toContain("colonnade");
  });

  test("offers a different kind of building as the dice fall differently", () => {
    const rolls = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
    const messages = new Set(
      rolls.map((roll) =>
        buildingRequestMessage(
          [],
          pickBuildingInspiration(() => roll),
        ),
      ),
    );
    expect(messages.size).toBe(rolls.length);
    expect(pickBuildingInspiration(() => 0.999999)).toBeTruthy();
  });

  test("asks once more when the first reply is not a valid brief", async () => {
    const model = fakeModel(["Sorry, no.", buildingBriefJson()]);
    const result = await writeBuildingBrief({ model: model.client, prompt: "P" }, [], "session-2");
    expect(result).toMatchObject({ ok: true, brief: { name: "Stoa of the net-menders" } });
    expect(model.sent).toHaveLength(2);
  });

  test("asks once more when the name repeats an existing building, in any case or spelling", async () => {
    const model = fakeModel([buildingBriefJson({ name: "FOUNTAIN  HOUSE!" }), buildingBriefJson()]);
    const result = await writeBuildingBrief({ model: model.client, prompt: "P" }, ["Fountain house"], "session-3");
    expect(result).toMatchObject({ ok: true, brief: { name: "Stoa of the net-menders" } });
  });

  test("a building that copies a committed one is refused", async () => {
    const model = fakeModel([buildingBriefJson({ name: "Temple" }), buildingBriefJson({ name: "stall" })]);
    expect(await writeBuildingBrief({ model: model.client, prompt: "P" }, [], "session-4")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("gives up after two tries and says whether Mubit was reachable", async () => {
    const invalid = fakeModel(["nope", "still nope"]);
    expect(await writeBuildingBrief({ model: invalid.client, prompt: "P" }, [], "s")).toEqual({
      ok: false,
      reason: "invalid",
    });
    const down = fakeModel([null, null, null, null]); // each attempt is retried once by the client
    expect(await writeBuildingBrief({ model: down.client, prompt: "P" }, [], "s")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
