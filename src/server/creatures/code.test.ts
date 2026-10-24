import { describe, expect, test } from "bun:test";
import type { Creature } from "@/game/creature";
import { codeResponse } from "./code";
import { createMemoryStore } from "./store.memory";

const creature = (id: string): Creature => ({
  id,
  name: "Brine hound",
  lore: "It follows the smell of lamp oil up the quay.",
  brief: "a sleek sea-hound with kelp-green fur",
  archetype: "skulker",
  modifiers: { speed: 0, toughness: 0, bite: 0, snuffing: 0 },
  anchorY: 0.8,
  score: 8,
  createdAt: "2026-10-24T12:00:00.000Z",
});

describe("GET /api/creatures/:id/code", () => {
  test("serves the code as text, cached for good, with nothing allowed to run from it", async () => {
    const store = createMemoryStore();
    await store.putCreature(creature("0000aaaa-hound-aaaaaa"), "function build(k) { humanoid(k, {}); }\n");
    const response = await codeResponse(store, "0000aaaa-hound-aaaaaa");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("function build(k) { humanoid(k, {}); }\n");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  test("answers 404 for an unknown creature and does not cache that", async () => {
    const response = await codeResponse(createMemoryStore(), "0000aaaa-nobody-aaaaaa");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("answers 400 for an id that is not one, without asking the store", async () => {
    let asked = 0;
    const store = {
      getCode: async () => {
        asked++;
        return null;
      },
    };
    for (const id of ["../etc/passwd", "UPPER-CASE-ID", "short", "a".repeat(81)]) {
      expect((await codeResponse(store, id)).status).toBe(400);
    }
    expect(asked).toBe(0);
  });

  test("answers 503 when storage fails, and does not cache that", async () => {
    const response = await codeResponse(
      {
        getCode: async () => {
          throw new Error("blob is down");
        },
      },
      "0000aaaa-hound-aaaaaa",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("blob is down");
  });
});
