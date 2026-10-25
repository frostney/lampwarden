// A night beside a live building: the building is only ever drawn, so it is recorded with the night and shown again on replay,
// and the sim, the replay and the sim fingerprint are exactly what they were without it.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SIM_SOURCES, simFingerprint } from "../../tools/sim-fingerprint/sim-fingerprint";
import { decorFor } from "../scene/decor";
import { liveBuildingOf } from "../scene/layers";
import { recordedBuildingOf, recordedBuildingSchema } from "./building";
import { newLegacy } from "./legacy";
import { playSchema } from "./plays";
import { type Play, Recorder } from "./recording";
import { creatureOf, legacyOf, Replayer, STEP, verifyPlay } from "./replay";
import { NO_INPUT, newNight, step } from "./sim";

const RECORDED = recordedBuildingSchema.parse({
  id: "0000aaaa-stoa-abc123",
  name: "Stoa of the net-menders",
  anchorY: 0.83,
  extent: {
    hull: [
      [-30, -28],
      [30, -28],
      [30, 4],
      [-30, 4],
    ],
    solid: [
      [-30, -28],
      [30, -28],
      [30, 3],
      [-30, 3],
    ],
    band: 28,
    sprite: { left: -30, right: 30, top: -40, bottom: 4 },
  },
});

// A night played from nothing but its seed, recorded the way the game records one
function recordedNight(building: typeof RECORDED | null) {
  const legacy = newLegacy(11);
  legacy.night = 2;
  const seed = 424242;
  const recorder = new Recorder(legacy, seed, "", null, undefined, building);
  const state = newNight(legacy, seed, null);
  for (let index = 0; index < 600 && !state.outcome; index++) {
    recorder.input(index, NO_INPUT, state);
    step(state, STEP, NO_INPUT);
  }
  return { play: recorder.finish(state), state };
}

describe("the building a night was played beside", () => {
  test("is recorded with the night, as its id, name, anchor and extent", () => {
    const { play } = recordedNight(RECORDED);
    expect(play.building).toEqual(RECORDED);
    expect(recordedBuildingOf(play)).toEqual(RECORDED);
    // what /api/plays stores is what it parsed: the building is kept, not dropped as an unknown field
    expect(playSchema.parse(JSON.parse(JSON.stringify(play))).building).toEqual(RECORDED);
  });

  test("a night with no live building records none", () => {
    const { play } = recordedNight(null);
    expect("building" in play).toBe(false);
    expect(recordedBuildingOf(play)).toBeNull();
  });

  test("is validated where plays come in: a damaged record refuses the play", () => {
    const { play } = recordedNight(RECORDED);
    const sent = JSON.parse(JSON.stringify(play));
    expect(playSchema.safeParse({ ...sent, building: { ...RECORDED, anchorY: 3 } }).success).toBe(false);
    expect(playSchema.safeParse({ ...sent, building: { id: "x" } }).success).toBe(false);
    expect(playSchema.safeParse({ ...sent, building: undefined }).success).toBe(true);
  });

  test("a recording whose building does not validate replays as if it had none", () => {
    const { play } = recordedNight(RECORDED);
    expect(recordedBuildingOf({ ...play, building: { id: "x" } })).toBeNull();
    expect(recordedBuildingOf({})).toBeNull();
  });
});

describe("replaying a night beside a building", () => {
  test("ends where the night ended, with the building and without it: the sim never reads it", () => {
    for (const building of [RECORDED, null]) {
      const { play, state } = recordedNight(building);
      const verified = verifyPlay(play);
      expect(verified.endsMatch).toBe(true);
      expect(verified.state.stats).toEqual(state.stats);
      expect(verified.state.randomState).toEqual(state.randomState);
      expect(creatureOf(play)).toBeNull();
    }
  });

  test("the same recording replays to the same night whether or not it names a building", () => {
    const { play } = recordedNight(RECORDED);
    const stripped: Play = { ...play };
    delete stripped.building;
    const withBuilding = verifyPlay(play).state;
    const without = verifyPlay(stripped).state;
    expect(withBuilding.stats).toEqual(without.stats);
    expect(withBuilding.elapsed).toBe(without.elapsed);
    expect(new Replayer(play).input(10)).toEqual(new Replayer(stripped).input(10));
    expect(legacyOf(play)).toEqual(legacyOf(stripped));
  });

  test("shows the same plaza: the recorded building takes the building slot, and an older play has the committed layout", () => {
    const { play } = recordedNight(RECORDED);
    const building = recordedBuildingOf(play);
    const seed = play.seed;
    const withBuilding = decorFor(seed, building && liveBuildingOf(building));
    // laid out again, the plaza is the one the night was played on
    expect(decorFor(seed, building && liveBuildingOf(building))).toEqual(withBuilding);
    const older = recordedBuildingOf({});
    const committed = decorFor(seed, older && liveBuildingOf(older));
    expect(committed).toEqual(decorFor(seed));
    expect(committed.props.some((placed) => placed.key.startsWith("building/"))).toBe(false);
  });
});

describe("the sim fingerprint", () => {
  test("covers none of what the building touches: its contract, the recording, the plays API, the scene and the sea", () => {
    const names = SIM_SOURCES.map((source) => source.split("/").at(-1));
    for (const name of [
      "building.ts",
      "building-api.ts",
      "building-sea.ts",
      "gallery-sea.ts",
      "gallery-api.ts",
      "raised.ts",
      "recording.ts",
      "plays.ts",
      "decor.ts",
      "layers.ts",
      "sea.ts",
    ])
      expect(names, name).not.toContain(name);
  });

  test("is a 12 digit hash, as the plays record it", () => {
    expect(simFingerprint(join(import.meta.dir, "..", ".."))).toMatch(/^[0-9a-f]{12}$/);
  });
});
