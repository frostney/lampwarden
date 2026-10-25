// A building from the live gallery on the plaza (src/game/building.ts, src/scene/decor.ts's building slot): placed only from the
// extents its record carries, held to the same rules as a committed prop, and skipped, with the committed building left
// standing, when it fits nowhere.
import { describe, expect, test } from "bun:test";

import { type RecordedBuilding, recordedBuildingSchema } from "../game/building";
import { LAMP_SPOTS } from "../game/sim";
import { decorFor, type Layout, type Placed, SPAWN_POINTS } from "./decor";
import { SPRITE_EXTENTS } from "./decor-extents";
import { measureSprite, type SpriteExtents } from "./extent";
import { groundShape, nearPoint, nearShape, toGround } from "./footprint";
import { liveBuildingOf } from "./layers";
import { plazaInset } from "./plaza";

const SEEDS = 500;
const TIMEOUT = 60_000; // a few thousand layouts, a few milliseconds each, on a machine other work may share
const seedOf = (index: number) => Math.imul(index + 1, 2654435761) >>> 0; // spread over all of 32 bits
const MARGIN = 8; // iso steps from the rim (decor.ts)
const LAMP_RING = 40; // ground px from a lamp's foot (decor.ts)
const SPAWN_GAP = 26; // ground px from where monsters come ashore (decor.ts)
const PROP_GAP = 12; // ground px between the bases of two props (decor.ts)

// A block as a model might draw one: `width` x `height` px, its bottom row on the anchor's, measured by the same function
// the server measures an accepted sprite with.
function blockExtents(width: number, height: number, anchorY: number): SpriteExtents {
  const rgba = new Uint8Array(128 * 128 * 4);
  const bottom = Math.round(anchorY * 128) + 3;
  for (let row = bottom - height + 1; row <= bottom; row++) {
    for (let column = 64 - Math.floor(width / 2); column < 64 + Math.ceil(width / 2); column++) {
      rgba[(row * 128 + column) * 4 + 3] = 255;
    }
  }
  return measureSprite(rgba, anchorY);
}

// Two buildings the live job made (23 Oct 2026, against Mubit and Vercel Sandbox): a small stone fountain house and a long
// Doric stoa. These are the extents their records carry.
const FOUNTAIN_HOUSE: SpriteExtents = {
  hull: [
    [-30, -28],
    [52, -28],
    [64, -22],
    [64, -21],
    [60, -9],
    [58, -7],
    [36, 4],
    [32, 4],
    [-30, -27],
  ],
  solid: [
    [-30, -28],
    [47, -28],
    [60, -11],
    [60, -9],
    [58, -7],
    [36, 4],
    [32, 4],
    [-30, -27],
  ],
  band: 28,
  sprite: { left: -60, right: 60, top: -93, bottom: 4 },
};
const STOA: SpriteExtents = {
  hull: [
    [-36, -28],
    [44, -28],
    [52, -24],
    [53, -22],
    [53, -21],
    [35, -6],
    [24, 0],
    [15, 3],
    [5, 4],
    [3, 4],
    [-35, -15],
    [-36, -16],
  ],
  solid: [
    [-36, -28],
    [36, -28],
    [37, -16],
    [37, -8],
    [35, -6],
    [27, -2],
    [15, 3],
    [5, 4],
    [3, 4],
    [-35, -15],
    [-36, -16],
  ],
  band: 28,
  sprite: { left: -43, right: 43, top: -71, bottom: 4 },
};

const BUILDINGS: Array<{ name: string; extents: SpriteExtents }> = [
  { name: "a fountain house", extents: FOUNTAIN_HOUSE },
  { name: "a stoa", extents: STOA },
  { name: "a tower", extents: blockExtents(20, 70, 0.9) },
];
// a base wider than the whole plaza: no sprite frame holds one, but a record's extents are only as large as the schema lets
// them be, and the placer must still skip a building that fits nowhere
const IMPOSSIBLE: SpriteExtents = {
  hull: [
    [-420, -28],
    [420, -28],
    [420, 4],
    [-420, 4],
  ],
  solid: [
    [-420, -28],
    [420, -28],
    [420, 4],
    [-420, 4],
  ],
  band: 28,
  sprite: { left: -420, right: 420, top: -90, bottom: 4 },
};

const KEY = "building/0000aaaa-live-abcdef";
const live = (extents: SpriteExtents) => ({ key: KEY, extents });

const BUILDING_SLOT = ["house", "house-ochre"];
// a check inside a loop of thousands: a throw names the seed, where thousands of expect() calls would only slow it
const must = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};
const keysOf = (layout: Layout) => layout.props.map((placed) => placed.key);

// a night's layout takes a few milliseconds, so each set of layouts is made once and shared by the tests that read it
const remembered = new Map<SpriteExtents | null, Layout[]>();
function layoutsOf(extents: SpriteExtents | null): Layout[] {
  const key = extents;
  let layouts = remembered.get(key);
  if (!layouts) {
    layouts = Array.from({ length: SEEDS }, (_, index) => decorFor(seedOf(index), extents && live(extents)));
    remembered.set(key, layouts);
  }
  return layouts;
}
function layoutAt(extents: SpriteExtents | null, index: number): Layout {
  const layout = layoutsOf(extents)[index];
  if (!layout) {
    throw new Error(`no layout for seed ${index}`);
  }
  return layout;
}

// The live building stands where a committed one may: inside the plaza with the margin, by every corner of its base; clear
// of the lamps and of where monsters come ashore; and off the other props.
function mustStandClear(seed: number, placed: Placed, extents: SpriteExtents, layout: Layout) {
  for (const [hullX, hullY] of extents.hull) {
    must(plazaInset(placed.x + hullX, placed.y + hullY) >= MARGIN, `seed ${seed}: near the rim`);
  }
  const base = groundShape(extents.solid, placed.x, placed.y);
  for (const spot of LAMP_SPOTS) {
    must(!nearPoint(base, toGround(spot), LAMP_RING), `seed ${seed}: by a lamp`);
  }
  for (const spawn of SPAWN_POINTS) {
    must(!nearPoint(base, toGround(spawn), SPAWN_GAP), `seed ${seed}: by a spawn`);
  }
  // the pieces of one cluster or run may stand closer: only a different kind is held to the gap
  for (const other of layout.props.filter((prop) => prop !== placed && prop.key !== placed.key)) {
    const otherExtents = SPRITE_EXTENTS[other.key];
    if (otherExtents) {
      must(
        !nearShape(base, groundShape(otherExtents.solid, other.x, other.y), PROP_GAP),
        `seed ${seed}: on ${other.key}`,
      );
    }
  }
}

describe("a live building on the plaza", () => {
  for (const { name, extents } of BUILDINGS) {
    test(
      `${name} stands in the building slot of nearly every layout of ${SEEDS} seeds, within the bounds of a committed building`,
      () => {
        let placedCount = 0;
        for (const [index, layout] of layoutsOf(extents).entries()) {
          const seed = seedOf(index);
          const keys = keysOf(layout);
          // one building in the slot, live or committed, and never an extra
          const standing = keys.filter((key) => key === KEY || BUILDING_SLOT.includes(key));
          expect(standing, `seed ${seed}`).toHaveLength(1);
          // never the temple, which every plaza keeps
          expect(
            keys.filter((key) => key === "temple"),
            `seed ${seed}`,
          ).toHaveLength(1);
          const placed = layout.props.find((prop) => prop.key === KEY);
          if (!placed) {
            continue;
          }
          placedCount++;
          mustStandClear(seed, placed, extents, layout);
        }
        // it is a building a layout can take: placed on most nights (a long one fits less often than a small one)
        expect(placedCount).toBeGreaterThan(SEEDS * 0.3);
      },
      TIMEOUT,
    );
  }

  test("the same night lays out the same plaza, with the building and without it", () => {
    for (let index = 0; index < 50; index++) {
      const seed = seedOf(index);
      expect(decorFor(seed, live(FOUNTAIN_HOUSE))).toEqual(decorFor(seed, live(FOUNTAIN_HOUSE)));
      expect(decorFor(seed)).toEqual(decorFor(seed, null));
    }
  });

  test(
    "replaces the house or the ochre house and nothing else: every other prop is one of the committed kinds",
    () => {
      const committed = new Set(
        layoutsOf(null).flatMap((layout) => [...layout.props, ...layout.boats].map((placed) => placed.key)),
      );
      for (const layout of layoutsOf(FOUNTAIN_HOUSE)) {
        for (const placed of [...layout.props, ...layout.boats]) {
          must(placed.key === KEY || committed.has(placed.key), `an unknown prop ${placed.key}`);
        }
      }
    },
    TIMEOUT,
  );

  test(
    "a building that fits nowhere is skipped for that night, and the committed one stays",
    () => {
      for (let index = 0; index < 100; index++) {
        const seed = seedOf(index);
        const layout = decorFor(seed, live(IMPOSSIBLE));
        const keys = keysOf(layout);
        expect(keys).not.toContain(KEY);
        expect(
          keys.filter((key) => BUILDING_SLOT.includes(key)),
          `seed ${seed}`,
        ).toHaveLength(1);
      }
    },
    TIMEOUT,
  );

  test(
    "never adds clutter: a plaza with a live building has no more props than the most a committed one has",
    () => {
      const most = Math.max(...layoutsOf(null).map((layout) => layout.props.length));
      for (const layout of layoutsOf(FOUNTAIN_HOUSE)) {
        must(layout.props.length <= most, "more props than a committed plaza has");
      }
    },
    TIMEOUT,
  );
});

describe("a recording carries the building the plaza was laid out with", () => {
  const recorded: RecordedBuilding = recordedBuildingSchema.parse({
    id: "0000aaaa-live-abcdef",
    name: "Fountain house of the Lower Town",
    anchorY: 0.89,
    extent: FOUNTAIN_HOUSE,
  });

  test("lays out the same plaza from the recorded building as the night was played on", () => {
    // the night's plaza was laid out from the record's extents with the building's key; a replay has the recording's
    for (let index = 0; index < 30; index++) {
      const seed = seedOf(index);
      expect(decorFor(seed, liveBuildingOf(recorded))).toEqual(layoutAt(FOUNTAIN_HOUSE, index));
    }
    expect(liveBuildingOf(recorded).key).toBe(KEY);
  });

  test("an older play, with no building, lays out the committed plaza", () => {
    for (let index = 0; index < 20; index++) {
      const seed = seedOf(index);
      const layout = decorFor(seed, null);
      expect(keysOf(layout).filter((key) => BUILDING_SLOT.includes(key))).toHaveLength(1);
      expect(keysOf(layout).some((key) => key.startsWith("building/"))).toBe(false);
    }
  });
});
