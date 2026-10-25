import { describe, expect, test } from "bun:test";
import { creatureStats } from "../src/game/creature";
import {
  briefRequestMessage,
  type CreatureBrief,
  parseCreatureBrief,
  pickInspiration,
  writeCreatureBrief,
} from "./creature-brief";
import { briefJson, fakeModel } from "./fakes";
import { MUBIT_MESSAGES_URL, MUBIT_MODEL } from "./mubit";

describe("validating a brief", () => {
  test("accepts the documented shape, also inside a fence or with chatter around it", () => {
    const expected: CreatureBrief = {
      name: "Brine hound",
      lore: "It follows the smell of lamp oil up the quay.",
      brief: "a sleek sea-hound with kelp-green fur and webbed paws",
      archetype: "skulker",
      modifiers: { speed: 1, toughness: -1, bite: 0, snuffing: 0 },
    };
    expect(parseCreatureBrief(briefJson())).toEqual(expected);
    expect(parseCreatureBrief(`\`\`\`json\n${briefJson()}\n\`\`\``)).toEqual(expected);
    expect(parseCreatureBrief(`Here is the creature: ${briefJson()} Enjoy!`)).toEqual(expected);
  });

  test("never lets the model's own stat numbers through", () => {
    const parsed = parseCreatureBrief(briefJson({ stats: { health: 999 }, health: 999, speed: 500 }));
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("999");
    expect(JSON.stringify(parsed)).not.toContain("500");
    // what the game plays with comes from the archetype and the modifiers alone
    expect(parsed && creatureStats(parsed.archetype, parsed.modifiers).health).toBe(1);
  });

  test.each([
    ["no reply", null],
    ["no JSON", "I would suggest a hydra."],
    ["broken JSON", '{"name": "Hydra",'],
    ["a modifier above 1", briefJson({ modifiers: { speed: 2, toughness: 0, bite: 0, snuffing: 0 } })],
    ["a fractional modifier", briefJson({ modifiers: { speed: 0.5, toughness: 0, bite: 0, snuffing: 0 } })],
    ["a missing modifier", briefJson({ modifiers: { speed: 0, toughness: 0, bite: 0 } })],
    ["an unknown archetype", briefJson({ archetype: "dragon" })],
    ["a name that is too long", briefJson({ name: "x".repeat(41) })],
    ["a one-character name", briefJson({ name: "x" })],
    ["a lore line that is too long", briefJson({ lore: "x".repeat(161) })],
    ["a sprite brief that is too long", briefJson({ brief: "x".repeat(401) })],
    [
      "a missing lore line",
      JSON.stringify({
        name: "Hydra",
        brief: "a many-headed serpent",
        archetype: "brute",
        modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
      }),
    ],
  ])("rejects %s", (_description, reply) => {
    expect(parseCreatureBrief(reply)).toBeNull();
  });
});

describe("the brief writer's Mubit call", () => {
  test("sends the documented request: Mubit URL, model, cached system prompt, no temperature, the existing names", async () => {
    const model = fakeModel([briefJson()]);
    const result = await writeCreatureBrief(
      { model: model.client, prompt: "CREATURE PROMPT", random: () => 0 },
      ["Kelp witch", "Tide hound"],
      "session-1",
    );
    expect(result.ok).toBe(true);
    expect(model.urls).toEqual([MUBIT_MESSAGES_URL]);
    const [request] = model.sent;
    expect(request?.model).toBe(MUBIT_MODEL);
    expect(request).not.toHaveProperty("temperature");
    expect(request?.system).toEqual([{ type: "text", text: "CREATURE PROMPT", cache_control: { type: "ephemeral" } }]);
    const message = JSON.stringify(request?.messages);
    for (const name of ["Kelp witch", "Tide hound", "Satyr", "Cyclops", "Harpy"]) expect(message).toContain(name);
    expect(message).toContain("Charybdis"); // the thread of myth picked when random() is 0
  });

  test("offers a different thread of myth as the dice fall differently", () => {
    const rolls = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
    const messages = new Set(
      rolls.map((roll) =>
        briefRequestMessage(
          [],
          pickInspiration(() => roll),
        ),
      ),
    );
    expect(messages.size).toBe(rolls.length);
  });

  test("asks once more when the first reply is not a valid brief", async () => {
    const model = fakeModel(["Sorry, no.", briefJson()]);
    const result = await writeCreatureBrief({ model: model.client, prompt: "P" }, [], "session-2");
    expect(result).toMatchObject({ ok: true, brief: { name: "Brine hound" } });
    expect(model.sent).toHaveLength(2);
  });

  test("asks once more when the name repeats an existing creature, in any case or spelling", async () => {
    const model = fakeModel([briefJson({ name: "KELP  WITCH!" }), briefJson({ name: "Brine hound" })]);
    const result = await writeCreatureBrief({ model: model.client, prompt: "P" }, ["Kelp witch"], "session-3");
    expect(result).toMatchObject({ ok: true, brief: { name: "Brine hound" } });
  });

  test("a creature that copies a built-in monster is refused", async () => {
    const model = fakeModel([briefJson({ name: "Harpy" }), briefJson({ name: "satyr" })]);
    expect(await writeCreatureBrief({ model: model.client, prompt: "P" }, [], "session-4")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("gives up after two tries and says whether Mubit was reachable", async () => {
    const invalid = fakeModel(["nope", "still nope"]);
    expect(await writeCreatureBrief({ model: invalid.client, prompt: "P" }, [], "s")).toEqual({
      ok: false,
      reason: "invalid",
    });
    const down = fakeModel([null, null, null, null]); // each attempt is retried once by the client
    expect(await writeCreatureBrief({ model: down.client, prompt: "P" }, [], "s")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  test("reports each call's record without its text", async () => {
    const model = fakeModel([briefJson()]);
    const records: Array<Record<string, unknown>> = [];
    await writeCreatureBrief({ model: model.client, prompt: "P", onCall: (record) => records.push(record) }, [], "s");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ task: "brief", status: 200 });
    expect(JSON.stringify(records)).not.toContain("kelp-green");
  });
});
