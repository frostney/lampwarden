"use client";

import { Application } from "@pixi/react";
import Image from "next/image";
import type { Application as PixiApp } from "pixi.js";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { FailurePanel } from "@/components/FailurePanel";
import { HeroPortrait } from "@/components/HeroPortrait";
import { HowToPlay } from "@/components/HowToPlay";
import { Icon } from "@/components/Icon";
import { type Driver, type Night, Scene } from "@/components/Scene";
import { SeaSends } from "@/components/SeaSends";
import { TitleScroll } from "@/components/TitleScroll";
import { TouchControls } from "@/components/TouchControls";
import { useRaised } from "@/components/useRaised";
import { useTonight } from "@/components/useTonight";
import { type Building, type RecordedBuilding, recordedBuildingOf, recordedBuildingSchema } from "@/game/building";
import type { RaisedTonight } from "@/game/building-sea";
import { newControls, press, release, stick } from "@/game/controls";
import { recordedCreatureSchema } from "@/game/creature";
import type { CreatureRecord } from "@/game/creature-frames";
import { askDirector } from "@/game/director-api";
import { engagementOf, heldTide } from "@/game/engagement";
import { activeGamepad, type MenuAction, newGamepadMemory, pollGamepadForMenu } from "@/game/gamepad";
import {
  applyDirector,
  buy,
  clearLegacy,
  endWarden,
  type Heir,
  heirAs,
  heirChoices,
  type Legacy,
  loadLegacy,
  meet,
  newLegacy,
  openShop,
  ordinal,
  saveLegacy,
  setRulesDirector,
  TRAITS,
  type TraitId,
  tideLabel,
  upgradeCost,
} from "@/game/legacy";
import { MAX_LEVEL, type UpgradeId } from "@/game/levels";
import { describeNight, playSchema, playVersion, RUNNING_SIM, replaysExactlyOn } from "@/game/plays";
import { bindKeyboardPress, flashPressed } from "@/game/pressed";
import { clearRaised, loadRaised, raise, saveRaised } from "@/game/raised";
import { type Play, Recorder, resendQueuedPlays, upload } from "@/game/recording";
import { creatureOf, legacyOf, Replayer, verifyPlay } from "@/game/replay";
import type { Tonight } from "@/game/sea";
import {
  dawnBonus,
  LAMP_SPOTS,
  litCount,
  newNight,
  newSeed,
  nextTide,
  nightCreature,
  type Outcome,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type State,
} from "@/game/sim";
import { ARMS, shopSex, upgradeView } from "@/game/weapons";
import { SEXES, type Sex } from "@/scene/assets";
import { decorFor } from "@/scene/decor";
import {
  liveBuildingOf,
  loadBuildingTexture,
  loadCreatureTextures,
  loadTextures,
  NIGHT_SEA,
  standInTextures,
  type TextureMap,
} from "@/scene/layers";

// the canvas: 960x600 game pixels, scaled by CSS, no smoothing
const APP = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  background: NIGHT_SEA,
  antialias: false,
  roundPixels: true,
  resolution: 1,
  autoDensity: false,
};

const RENDERER_GRACE = 1500; // ms a renderer that failed to start is given before the title says so
const CREATURE_LOAD_TIMEOUT = 4000; // ms a night waits for its creature's sprite (and its building's) before going without it

// A load that gives up after `milliseconds` with null, and stops its timer when it does not need to wait that long
function loadWithin<Loaded>(load: Promise<Loaded | null>, milliseconds: number): Promise<Loaded | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds);
  });
  return Promise.race([load, giveUp]).finally(() => clearTimeout(timer));
}

const INTRODUCTION = [
  "Lychnos is a harbour of lamps.",
  "Every night the sea sends its creatures to put them out.",
  "Keep one burning until dawn.",
  "When a warden falls, an heir takes up the lamp.",
];

// one HUD diamond per lamp, keyed by where the lamp stands
const LAMP_SLOTS = LAMP_SPOTS.map(([x, y]) => `${x},${y}`);

// The building raised on a night's plaza: its record as a recording keeps it, and its sprite, loaded
interface Plaza {
  building: RecordedBuilding;
  textures: TextureMap;
}

type Phase = "title" | "night" | "dawn" | "heir" | "replay" | "replayEnd" | "replayRefused";
interface Hud {
  health: number;
  maxHealth: number;
  hits: number; // blows the warden has taken: the health bar flashes and shakes on each
  lit: number;
  lamps: number;
  kills: number;
  oil: number;
  dawn: number;
}
interface Report {
  outcome: Outcome;
  night: number;
  kills: number;
  lampsLost: number;
  oil: number;
  bonus: number;
  name: string;
  tideBefore: number;
  tideAfter: number;
  line: string; // the live director's answer, the sea's own words; empty while the rules' decision stands
}

// A recorded night on its way to the server: its id, and whether the upload went through.
interface SentPlay {
  id: string;
  play: Play;
  uploaded: Promise<boolean>;
}

// the visual verifier and recordings drive the game through window.lampwarden
interface DebugScene {
  setPaused: (paused: boolean) => void;
  freezeClock: (clock: number | null) => void;
  setSpeed: (speed: number) => void;
  stick: (horizontal: number, vertical: number) => void;
  press: (action: "melee" | "ranged") => void;
}
declare global {
  interface Window {
    lampwarden?: {
      state: () => State | null;
      legacy: () => Legacy;
      scene: () => DebugScene;
      app: () => PixiApp | null;
    };
  }
}

const hudOf = (state: State, legacy: Legacy): Hud => ({
  health: Math.ceil(state.hero.health),
  maxHealth: state.hero.maxHealth,
  hits: state.hero.hits,
  lit: litCount(state),
  lamps: state.lamps.length,
  kills: state.stats.kills,
  oil: legacy.oil + state.oilEarned,
  dawn: Math.min(1, state.elapsed / state.length),
});
const DAWN_STEP = 0.01; // the night bar moves on at every hundredth of the night
const sameHud = (first: Hud, second: Hud) =>
  first.health === second.health &&
  first.hits === second.hits &&
  first.lit === second.lit &&
  first.kills === second.kills &&
  first.oil === second.oil &&
  Math.abs(first.dawn - second.dawn) < DAWN_STEP;

// The building that was announced, as the night records it, if its sprite loaded in time; else the plaza's own.
const buildingForNight = (announced: Building | null, loaded: TextureMap | null) =>
  announced && loaded ? recordedBuildingSchema.parse(announced) : null;

// What records a live night: its seed, and the creature and building it was played with.
const nightRecorder = (
  legacy: Legacy,
  seed: number,
  creature: CreatureRecord | null,
  building: RecordedBuilding | null,
) => new Recorder(legacy, seed, "", creature && recordedCreatureSchema.parse(creature), RUNNING_SIM, building);

// The creature that was announced, if its sprite loads in time: then it joins the night, and these are its textures.
async function creatureForNight(
  announced: CreatureRecord | null,
): Promise<{ creature: CreatureRecord | null; loaded: TextureMap | null }> {
  const loaded = announced
    ? await loadWithin(loadCreatureTextures(announced.id, announced.frames ?? null), CREATURE_LOAD_TIMEOUT)
    : null;
  return { creature: announced && loaded ? announced : null, loaded };
}

// A recording by its id: the last night this browser played ("last"), or one from the plays API. Throws when it cannot
// be had.
async function fetchRecording(id: string): Promise<unknown> {
  if (id === "last") {
    return JSON.parse(localStorage.getItem("lampwarden:lastPlay") || "null");
  }
  const response = await fetch(`/api/plays/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// What a replay draws its night with. The night's creature is in the recording; if its sprite is gone the replay draws
// the monster that plays like it. The building the night's plaza was laid out with is in the recording too (rendering
// only: the sim never reads it); a play from before buildings, or one whose sprite is gone, replays on the committed plaza.
async function replayTextures(play: Play): Promise<{ creatureTextures: TextureMap | null; plaza: Plaza | null }> {
  const creature = creatureOf(play);
  let creatureTextures: TextureMap | null = null;
  if (creature && play.creature) {
    creatureTextures =
      (await loadCreatureTextures(creature.id)) ??
      standInTextures(await loadTextures(), creature.id, play.creature.archetype);
  }
  const recordedBuilding = recordedBuildingOf(play);
  const buildingTextures = recordedBuilding ? await loadBuildingTexture(recordedBuilding) : null;
  const plaza =
    recordedBuilding && buildingTextures ? { building: recordedBuilding, textures: buildingTextures } : null;
  return { creatureTextures, plaza };
}

// What the replay panel says about how a replay ended: null is a night that was abandoned, so has no end to compare.
function replayVerdict(endsMatch: boolean | null): string {
  if (endsMatch === null) {
    return "Abandoned night: no end to compare.";
  }
  return endsMatch ? "Replay ends exactly where the live night ended." : "Replay diverged from the live night.";
}

export function Game() {
  const appRef = useRef<PixiApp | null>(null);
  const stateRef = useRef<State | null>(null); // the night on screen, also read outside React (debug hook, pagehide)
  const [textures, setTextures] = useState<TextureMap | null>(null);
  const [night, setNight] = useState<Night | null>(null);
  const [paused, setPaused] = useState(true);
  const [away, setAway] = useState(false); // a live night is held because the window lost focus, until the player resumes
  const [loadFailure, setLoadFailure] = useState<"assets" | "graphics" | null>(null); // why the title can never light
  const [frozenClock, freezeClock] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false); // the canvas has shown a frame; before that it is hidden, not black
  const [controls] = useState(newControls);
  const lastHudRef = useRef<Hud | null>(null);
  const legacyRef = useRef<Legacy>(newLegacy());
  const [, rerender] = useState(0);
  const refresh = useCallback(() => rerender((count) => count + 1), []);
  const [phase, setPhase] = useState<Phase>("title");
  const [ready, setReady] = useState(false);
  const [strike, setStrike] = useState<{ sex: Sex; count: number } | null>(null); // the hero card last chosen
  const [hud, setHud] = useState<Hud | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [heirs, setHeirs] = useState<Heir[]>([]);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const recorderRef = useRef<Recorder | null>(null);
  const [replay, setReplay] = useState<{ play: Play; endsMatch: boolean | null } | null>(null);
  const [refusedPlay, setRefusedPlay] = useState<unknown>(null); // a recording from another version of the sim
  const [replayError, setReplayError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const { tonight, ask, withdraw, settled } = useTonight();
  const { raised, ask: askRaised, withdraw: withdrawRaised } = useRaised();
  const raisedRef = useRef<string[]>([]); // the ids of the buildings the line has seen go up (src/game/raised.ts)
  // What the sea sends next: the creature, and once its question has settled the building for the plaza (they share the one
  // generation slot, and the creature goes first).
  const askSea = useCallback(
    (bestiary: string[]) => {
      ask(bestiary);
      askRaised(raisedRef.current, settled());
    },
    [ask, askRaised, settled],
  );
  const starting = useRef(false); // a night is being put together (its creature's sprite may still be loading)
  const directorAsk = useRef<AbortController | null>(null); // the live director being asked about the night that ended

  // every night is recorded (inputs + timeline) and sent to /api/plays; the last one is also kept locally (?replay=last)
  const sendPlay = useCallback((state: State | null): SentPlay | null => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !state) {
      return null;
    }
    const play = recorder.finish(state);
    try {
      localStorage.setItem("lampwarden:lastPlay", JSON.stringify(play));
    } catch {
      /* full */
    }
    return { id: play.id, play, uploaded: upload(play) }; // upload queues one that fails and skips the verifier's nights
  }, []);

  // A tab that is hidden or going away may not come back (mobile Safari often kills a background tab without a
  // pagehide) or may (a back-forward-cache restore). Either way the night so far goes out under its id, and the recorder
  // stays until the night really ends, when sendPlay sends the finished play under the same id.
  const sendSnapshot = useCallback((state: State | null) => {
    const play = phaseRef.current === "night" && state ? recorderRef.current?.snapshot(state) : null;
    if (play) {
      upload(play, true).catch(reportError);
    }
  }, []);

  // Asks the live director about the night that just ended, once its recording is up. The answer is used only if it comes
  // while the dawn or heir panel is still up: starting the next night calls it off (startNight), and the rules' decision,
  // which is already in place, plays instead. The panel never waits for it.
  const consultDirector = useCallback((sent: SentPlay) => {
    directorAsk.current?.abort();
    const asking = new AbortController();
    directorAsk.current = asking;
    sent.uploaded
      .then(async (uploaded) => {
        if (!uploaded || asking.signal.aborted) {
          return;
        }
        const answer = await askDirector(sent.id, asking.signal);
        if (!answer || asking.signal.aborted) {
          return;
        }
        const legacy = legacyRef.current;
        if (!applyDirector(legacy, answer.decision)) {
          return;
        }
        saveLegacy(legacy);
        setReport((current) => current && { ...current, tideAfter: legacy.tide, line: legacy.director.line });
      })
      .catch(reportError);
  }, []);

  // pausing also lets go of held keys and the stick
  const pause = useCallback(
    (shouldPause: boolean) => {
      setPaused(shouldPause);
      if (shouldPause) {
        release(controls);
      } else {
        setAway(false);
      }
    },
    [controls],
  );

  // a live night waits when the window loses focus or the tab is hidden; the player resumes it from the pause panel
  // (replays and menus carry on: a replay's steps come from its recording, not from the clock)
  useEffect(() => {
    const holdNight = () => {
      if (phaseRef.current !== "night") {
        return;
      }
      pause(true);
      setAway(true);
    };
    const holdHiddenNight = () => {
      if (document.hidden) {
        holdNight();
      }
    };
    // the visual verifier (?verify) runs several pages in one window, and any of them may lose focus mid-night
    const verifying = new URLSearchParams(location.search).has("verify");
    if (!verifying) {
      window.addEventListener("blur", holdNight);
    }
    document.addEventListener("visibilitychange", holdHiddenNight);
    return () => {
      window.removeEventListener("blur", holdNight);
      document.removeEventListener("visibilitychange", holdHiddenNight);
    };
  }, [pause]);
  const resume = useCallback(() => {
    release(controls); // presses made while the night waited are not the player's next move
    pause(false);
  }, [controls, pause]);
  const focusResume = useCallback((button: HTMLButtonElement | null) => button?.focus(), []);

  // @pixi/react has no error callback: when the renderer cannot start (the message varies: no adapter, no context, no 2D
  // context to fall back on), its init promise rejects unhandled, before the app has ever existed. A rejection counts only
  // if the app is still not up a moment later, so an unrelated one, or the first mount of a strict-mode double mount, does not.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rendererFailed = () => {
      if (appRef.current) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!appRef.current) {
          setLoadFailure("graphics");
        }
      }, RENDERER_GRACE);
    };
    window.addEventListener("unhandledrejection", rendererFailed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("unhandledrejection", rendererFailed);
    };
  }, []);

  const endNight = useCallback(
    (state: State, outcome: Outcome) => {
      const sent = sendPlay(state);
      const legacy = legacyRef.current;
      const bonus = outcome === "dawn" ? dawnBonus(state) : 0;
      const tideBefore = legacy.tide;
      legacy.oil += state.oilEarned + bonus;
      // a night the player was not there for (idle, tab away, left) is no evidence it was too hard: the tide does not ease
      // (a night with no recording cannot be judged, and is held the same way)
      const engagement = sent ? engagementOf(sent.play).kind : "idle";
      const nextRulesTide = heldTide(legacy.tide, nextTide(legacy.tide, state), engagement);
      setRulesDirector(legacy, nextRulesTide, state.night, sent?.id, engagement); // the live director may replace it
      const nightReport: Report = {
        outcome,
        night: state.night,
        kills: state.stats.kills,
        lampsLost: state.stats.lampsLost,
        oil: state.oilEarned,
        bonus,
        name: legacy.heir.name,
        tideBefore,
        tideAfter: legacy.tide,
        line: "",
      };
      if (outcome === "dawn") {
        legacy.bestNight = Math.max(legacy.bestNight, legacy.night);
        legacy.night++;
        phaseRef.current = "dawn";
        setPhase("dawn");
      } else {
        legacy.fallen.push({
          name: legacy.heir.name,
          night: legacy.night,
          cause: outcome === "dark" ? "the lamps went dark" : "fell in the plaza",
        });
        legacy.bestNight = Math.max(legacy.bestNight, legacy.night - 1);
        legacy.generation++;
        legacy.night = 1;
        endWarden(legacy);
        setHeirs(heirChoices(Math.random, legacy.heir.name));
        phaseRef.current = "heir";
        setPhase("heir");
      }
      openShop(legacy); // the shop opens on the new offers; saved with them, so a reload does not reroll
      saveLegacy(legacy);
      pause(true);
      setReport(nightReport);
      askSea(legacy.bestiary); // what the sea sends next
      if (sent) {
        consultDirector(sent);
      }
    },
    [sendPlay, consultDirector, pause, askSea],
  );

  // every frame, after the sim has stepped: HUD, end of the night, end of a replay
  const onTick = useCallback(
    (state: State) => {
      if (state !== stateRef.current) {
        return; // a night just replaced and not yet on stage
      }
      const showHud = () => {
        const nextHud = hudOf(state, legacyRef.current);
        if (!lastHudRef.current || !sameHud(lastHudRef.current, nextHud)) {
          lastHudRef.current = nextHud;
          setHud(nextHud);
        }
      };
      if (phaseRef.current === "replay") {
        if (state.outcome) {
          phaseRef.current = "replayEnd";
          setPhase("replayEnd");
          return;
        }
        showHud();
        return;
      }
      if (phaseRef.current !== "night") {
        return;
      }
      if (state.outcome) {
        endNight(state, state.outcome);
        return;
      }
      showHud();
    },
    [endNight],
  );
  const onReady = useCallback(() => setReady(true), []);
  const onInit = useCallback((app: PixiApp) => {
    appRef.current = app;
    // the ticker renders after this callback, and the frame is on screen by the next animation frame
    app.ticker.addOnce(() => requestAnimationFrame(() => setDrawn(true)));
  }, []);

  // Puts a night on stage. Its decorations are laid out from the seed the night starts from, which is still the sim's
  // randomState here: no step has drawn from it, and a replay builds its state from the recorded seed, so it lays out the
  // same plaza. The live building, when there is one, takes the building slot of the layout (src/scene/decor.ts).
  const show = useCallback(
    (
      state: State,
      sex: Sex,
      driver: Driver | null = null,
      creatureTextures: TextureMap | null = null,
      plaza: Plaza | null = null,
    ) => {
      stateRef.current = state;
      setNight({
        state,
        sex,
        driver,
        creatureTextures,
        buildingTextures: plaza?.textures ?? null,
        decor: decorFor(state.randomState, plaza && liveBuildingOf(plaza.building)),
      });
    },
    [],
  );

  const startReplay = useCallback(
    async (id: string) => {
      let fetched: unknown;
      try {
        fetched = await fetchRecording(id);
      } catch (error) {
        setReplayError(String(error));
        return;
      }
      const version = playVersion.safeParse(fetched);
      if (!version.success) {
        setReplayError("there is no recording");
        return;
      }
      // A night replays exactly only on the sim it was played on. Another version (or one from before versions were
      // noted) would show a night nobody played, so it is described, not played.
      if (!replaysExactlyOn(version.data, RUNNING_SIM)) {
        setRefusedPlay(fetched);
        setReplayError(null);
        phaseRef.current = "replayRefused";
        setPhase("replayRefused");
        return;
      }
      // a recording on this sim is replayed only whole: one that is damaged or was not made by the game is refused
      const parsed = playSchema.safeParse(fetched);
      if (!parsed.success) {
        setReplayError("the recording is damaged and can't be replayed");
        return;
      }
      const play = parsed.data;
      const replayLegacy = legacyOf(play);
      legacyRef.current = { ...legacyRef.current, ...replayLegacy }; // shown in the HUD only; never saved
      const creature = creatureOf(play);
      const { creatureTextures, plaza } = await replayTextures(play);
      const state = newNight(replayLegacy, play.seed, creature);
      const replayer = new Replayer(play);
      show(state, replayLegacy.heir.sex, (stepIndex) => replayer.input(stepIndex), creatureTextures, plaza);
      pause(false);
      setReplay({ play, endsMatch: play.outcome ? verifyPlay(play).endsMatch : null });
      setReplayError(null);
      setHud(hudOf(state, legacyRef.current));
      phaseRef.current = "replay";
      setPhase("replay");
    },
    [show, pause],
  );

  // gamepad: note when one is connected (for the help line), and drive the menus with it outside a night
  useEffect(() => {
    const refreshConnection = () => setGamepadConnected(activeGamepad() !== null);
    window.addEventListener("gamepadconnected", refreshConnection);
    window.addEventListener("gamepaddisconnected", refreshConnection);
    const memory = newGamepadMemory();
    let frame = 0;
    const poll = (now: number) => {
      frame = requestAnimationFrame(poll);
      if (phaseRef.current === "night" || phaseRef.current === "replay") {
        return;
      }
      const action = pollGamepadForMenu(memory, now);
      if (action) {
        actOnMenu(action);
      }
    };
    frame = requestAnimationFrame(poll);
    const unbindKeyboardPress = bindKeyboardPress();
    return () => {
      cancelAnimationFrame(frame);
      unbindKeyboardPress();
      window.removeEventListener("gamepadconnected", refreshConnection);
      window.removeEventListener("gamepaddisconnected", refreshConnection);
    };
  }, []);

  useEffect(() => {
    legacyRef.current = loadLegacy();
    raisedRef.current = loadRaised();
    refresh();
    let dead = false;
    loadTextures().then(
      (loaded) => {
        if (dead) {
          return;
        }
        setTextures(loaded);
        // preview: a quiet plaza behind the title screen
        show(newNight(legacyRef.current), legacyRef.current.heir.sex);
        const id = new URLSearchParams(location.search).get("replay");
        if (id) {
          startReplay(id).catch(reportError);
        } else {
          askSea(legacyRef.current.bestiary); // before night 1: what does the sea send?
        }
      },
      () => {
        if (!dead) {
          setLoadFailure((current) => current ?? "assets");
        }
      },
    );
    // debug hook for the visual verifier and recordings
    const scene: DebugScene = {
      setPaused: pause,
      freezeClock,
      setSpeed,
      stick: (horizontal, vertical) => stick(controls, horizontal, vertical),
      press: (action) => press(controls, action, stateRef.current),
    };
    window.lampwarden = {
      state: () => stateRef.current,
      legacy: () => legacyRef.current,
      scene: () => scene,
      app: () => appRef.current,
    };
    // a night abandoned by closing or backgrounding the tab is still recorded (outcome null)
    const leave = () => sendSnapshot(stateRef.current);
    const hide = () => {
      if (document.visibilityState === "hidden") {
        leave();
      }
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    resendQueuedPlays().catch(reportError); // nights an earlier page could not send
    return () => {
      dead = true;
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [sendSnapshot, pause, controls, refresh, show, startReplay, askSea]);

  // a creature announced for tonight has its sprite loaded ahead of the night; if it will not load, it is not announced
  const announcedCreature = tonight.kind === "ready" ? tonight.creature : null;
  const announced = announcedCreature?.id;
  const announcedFrames = announcedCreature?.frames;
  useEffect(() => {
    if (!announced) {
      return;
    }
    loadCreatureTextures(announced, announcedFrames ?? null)
      .then((loaded) => {
        if (!loaded) {
          withdraw(announced);
        }
      })
      .catch(reportError);
  }, [announced, announcedFrames, withdraw]);

  // a building announced for tonight has its sprite loaded ahead of the night; if it will not load, it is not announced
  const announcedBuilding = raised.kind === "ready" ? raised.building : null;
  useEffect(() => {
    if (!announcedBuilding) {
      return;
    }
    loadBuildingTexture(announcedBuilding)
      .then((loaded) => {
        if (!loaded) {
          withdrawRaised(announcedBuilding.id);
        }
      })
      .catch(reportError);
  }, [announcedBuilding, withdrawRaised]);

  const startNight = async () => {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref that startNight sets below, read again on the next call
    if (starting.current) {
      return;
    }
    starting.current = true;
    directorAsk.current?.abort(); // an answer that comes now is too late for this night
    directorAsk.current = null;
    // The creature that was ready joins the night if its sprite is loaded by now. If it is still being made, or does
    // not load, the night has none; a job still being made carries on through the night and the creature is announced
    // at dawn for the next one.
    // The building that was ready stands on the night's plaza the same way: if its sprite is loaded by now. Otherwise the
    // plaza is the committed one.
    const buildingLoad = announcedBuilding
      ? loadWithin(loadBuildingTexture(announcedBuilding), CREATURE_LOAD_TIMEOUT)
      : Promise.resolve(null);
    const { creature, loaded } = await creatureForNight(announcedCreature);
    if (creature) {
      meet(legacyRef.current, creature.id);
      saveLegacy(legacyRef.current);
    }
    // Now that this night's creature is met, ask for the next night's: the ~minute a creature takes to make overlaps the
    // night, so it is ready by dawn on the longer nights (on the 28 to 40 s ones it is still being made at dawn). Asking again
    // with the same ids met keeps a job that is still running.
    const loadedBuilding = await buildingLoad;
    const building = buildingForNight(announcedBuilding, loadedBuilding);
    if (building) {
      raisedRef.current = raise(raisedRef.current, building.id);
      saveRaised(raisedRef.current);
    }
    askSea(legacyRef.current.bestiary);
    const seed = newSeed();
    const state = newNight(legacyRef.current, seed, creature && nightCreature(creature));
    const recorder = nightRecorder(legacyRef.current, seed, creature, building);
    recorderRef.current = recorder;
    show(
      state,
      legacyRef.current.heir.sex,
      (stepIndex, live, current) => {
        recorder.input(stepIndex, live, current);
        return live;
      },
      creature && loaded,
      building && loadedBuilding ? { building, textures: loadedBuilding } : null,
    );
    starting.current = false;
    pause(false);
    setHud(hudOf(state, legacyRef.current));
    setReport(null);
    phaseRef.current = "night";
    setPhase("night");
  };
  const watchAgain = () => {
    startReplay(new URLSearchParams(location.search).get("replay") || "last").catch(reportError);
  };
  const chooseHeir = (heir: Heir) => {
    legacyRef.current.heir = heir;
    saveLegacy(legacyRef.current);
    refresh();
  };
  const purchase = (id: UpgradeId) => {
    if (buy(legacyRef.current, id)) {
      saveLegacy(legacyRef.current);
      refresh();
    }
  };
  const newLine = () => {
    directorAsk.current?.abort();
    clearLegacy();
    legacyRef.current = newLegacy();
    clearRaised();
    raisedRef.current = [];
    showPreview();
    refresh();
    askSea(legacyRef.current.bestiary);
  };
  // the warden behind the title screen is the one chosen
  const showPreview = () => {
    if (stateRef.current) {
      show(stateRef.current, legacyRef.current.heir.sex);
    }
  };
  const chooseSex = (sex: Sex) => {
    const legacy = legacyRef.current;
    // every choice, the chosen card's again too, has that warden swing once (HeroPortrait)
    setStrike((previous) => ({ sex, count: (previous?.count ?? 0) + 1 }));
    if (legacy.heir.sex === sex) {
      return;
    }
    legacy.heir = heirAs(legacy.heir, sex);
    saveLegacy(legacy);
    showPreview();
    refresh();
  };

  const legacy = legacyRef.current;

  const shopWarden = shopSex(legacy);
  const shop = (
    <div className="shop">
      <div className="oil">
        <Icon name="oil" size={16} /> {legacy.oil} oil
      </div>
      {legacy.offers.length === 0 && <p className="dim">Nothing left to buy. The line is complete.</p>}
      {legacy.offers.map((id) => {
        const cost = upgradeCost(legacy, id);
        const view = upgradeView(id, shopWarden);
        return (
          <button
            className="btn up"
            data-upgrade={id}
            disabled={cost === null || legacy.oil < cost}
            key={id}
            onClick={() => purchase(id)}
            type="button"
          >
            <Icon name={view.icon} />
            <div>
              <b>{view.label}</b>
              <em aria-label={`level ${legacy.levels[id]} of ${MAX_LEVEL}`} role="img">
                {"●".repeat(legacy.levels[id])}
                {"○".repeat(MAX_LEVEL - legacy.levels[id])}
              </em>
              <span>{view.text}</span>
              <i>{cost === null ? "max" : `${cost} oil`}</i>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="stage"
      data-hp={hud?.health}
      data-kills={hud?.kills}
      data-lit={hud?.lit}
      data-phase={phase}
      data-ready={Number(ready)}
    >
      <div className="canvas" data-drawn={drawn || undefined}>
        <Application {...APP} onInit={onInit}>
          {textures && night ? (
            <Scene
              controls={controls}
              frozenClock={frozenClock}
              night={night}
              onReady={onReady}
              onTick={onTick}
              paused={paused}
              speed={speed}
              textures={textures}
            />
          ) : null}
        </Application>
      </div>
      <div className="hud">
        <NightOverlays
          away={away}
          gamepadConnected={gamepadConnected}
          hud={hud}
          legacy={legacy}
          onPress={(action) => press(controls, action, stateRef.current)}
          onResume={resume}
          onSpeed={setSpeed}
          onStick={(horizontal, vertical) => stick(controls, horizontal, vertical)}
          phase={phase}
          replayId={replay?.play.id}
          resumeRef={focusResume}
          speed={speed}
        />

        {phase === "replayEnd" && replay ? <ReplayEndPanel onWatchAgain={watchAgain} replay={replay} /> : null}
        {phase === "replayRefused" ? <ReplayRefusedPanel play={refusedPlay} /> : null}
        <LoadFailurePanel failure={loadFailure} />
        <ReplayErrorPanel error={replayError} />

        {/* a replay that could not load says so in place of the title, which would otherwise cover it */}
        {phase === "title" && !loadFailure && !replayError ? (
          <TitleScreen
            gamepadConnected={gamepadConnected}
            legacy={legacy}
            onChooseSex={chooseSex}
            onNewLine={newLine}
            onSpriteBroken={withdraw}
            onStart={startNight}
            raised={raised}
            ready={ready}
            strike={strike}
            textures={textures}
            tonight={tonight}
          />
        ) : null}

        {phase === "dawn" && report ? (
          <DawnPanel
            legacy={legacy}
            onSpriteBroken={withdraw}
            onStart={startNight}
            raised={raised}
            report={report}
            shop={shop}
            tonight={tonight}
          />
        ) : null}

        {phase === "heir" && report ? (
          <HeirPanel
            heirs={heirs}
            legacy={legacy}
            onChooseHeir={chooseHeir}
            onSpriteBroken={withdraw}
            onStart={startNight}
            raised={raised}
            report={report}
            shop={shop}
            tonight={tonight}
          />
        ) : null}
      </div>
    </div>
  );
}

// The dawn and heir panels' title, which is their dialog's name. The panel is a dialog for a screen reader but does not
// trap focus, so it is not aria-modal.
const PANEL_TITLE_ID = "panel-title";

// A panel's title takes focus when the panel appears, so a keyboard or screen-reader player starts at its top (the buttons
// the title was in front of just unmounted) and Tab walks on into the panel.
function focusOnMount(element: HTMLElement | null) {
  element?.focus();
}

// a trait's name with its icon (the icon is decoration: the name says it)
// What lies over a night or a replay: its bars, and on a live night the touch controls and the paused panel.
function NightOverlays({
  phase,
  hud,
  legacy,
  gamepadConnected,
  replayId,
  speed,
  onSpeed,
  away,
  onResume,
  resumeRef,
  onPress,
  onStick,
}: {
  phase: Phase;
  hud: Hud | null;
  legacy: Legacy;
  gamepadConnected: boolean;
  replayId: string | undefined;
  speed: number;
  onSpeed: (speed: number) => void;
  away: boolean;
  onResume: () => void;
  resumeRef: (button: HTMLButtonElement | null) => void;
  onPress: (action: "melee" | "ranged") => void;
  onStick: (horizontal: number, vertical: number) => void;
}) {
  const live = phase === "night";
  if (!(live || phase === "replay")) {
    return null;
  }
  return (
    <>
      {hud ? (
        <NightHud
          gamepadConnected={gamepadConnected}
          hud={hud}
          legacy={legacy}
          live={live}
          onSpeed={onSpeed}
          replayId={replayId}
          speed={speed}
        />
      ) : null}
      {live ? (
        <>
          <div className="rotate">Turn your phone sideways for a bigger view</div>
          <TouchControls onPress={onPress} onStick={onStick} sex={legacy.heir.sex} />
        </>
      ) : null}
      {live && away ? (
        <div className="panel" data-panel="paused">
          <div className="logo small">PAUSED</div>
          <p>The window lost focus, so the night is waiting for you.</p>
          <button className="btn big" onClick={onResume} ref={resumeRef} type="button">
            Resume
          </button>
        </div>
      ) : null}
    </>
  );
}

const PERCENT = 100;
const FASTEST_REPLAY = 4;
const REPLAY_SPEEDS = [1, 2, FASTEST_REPLAY];

// The bars over a night: the warden, health and slain, the night's progress, the lamps, and the controls (or, for a
// replay, its speed).
function NightHud({
  hud,
  legacy,
  live,
  gamepadConnected,
  replayId,
  speed,
  onSpeed,
}: {
  hud: Hud;
  legacy: Legacy;
  live: boolean;
  gamepadConnected: boolean;
  replayId: string | undefined;
  speed: number;
  onSpeed: (speed: number) => void;
}) {
  return (
    <>
      <div className="stats">
        <div>
          {legacy.heir.name}
          <span className="long">
            , {ordinal(legacy.generation)} Lampwarden · <TraitMark trait={legacy.heir.trait} />
          </span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a <meter> cannot take the bar's pixel styling or struck animation */}
        <div
          aria-label="Health"
          aria-valuemax={Math.round(hud.maxHealth)}
          aria-valuemin={0}
          aria-valuenow={Math.round(hud.health)}
          className={hud.hits > 0 ? "bar struck" : "bar"}
          key={hud.hits}
          role="meter"
        >
          <i style={{ width: `${(hud.health / hud.maxHealth) * PERCENT}%` }} />
        </div>
        <div aria-label={`${hud.kills} slain, ${hud.oil} oil`} className="oilline" role="img">
          <Icon name="slain" size={16} /> {hud.kills} <Icon name="oil" size={16} /> {hud.oil}
        </div>
      </div>
      <div className="nightbar">
        <div>
          Night {legacy.night}
          <span className="long"> · the sea is {tideLabel(legacy.tide)}</span>
        </div>
        <div
          aria-label="Night until dawn"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(hud.dawn * PERCENT)}
          aria-valuetext={`${Math.round(hud.dawn * PERCENT)} percent of the night gone`}
          className="bar dawnbar"
          role="progressbar"
        >
          <i style={{ width: `${hud.dawn * PERCENT}%` }} />
        </div>
      </div>
      <div aria-label={`${hud.lit} of ${hud.lamps} lamps lit`} className="lamps" role="img">
        <span className="long">Lamps </span>
        {LAMP_SLOTS.slice(0, hud.lamps).map((slot, index) => (
          <span className={index < hud.lit ? "lit" : ""} key={slot}>
            {index < hud.lit ? "◆" : "◇"}
          </span>
        ))}
      </div>
      {live ? (
        <div className="help">
          {gamepadConnected
            ? "Left stick move · A strike (the stick turns you) · B or RT shoot (right stick aims) · stand by a dark lamp to relight it"
            : "WASD move · J strike (hold a direction to turn) · K or click shoot · stand by a dark lamp to relight it"}
        </div>
      ) : (
        <div className="help replaybar">
          REPLAY {replayId}
          {REPLAY_SPEEDS.map((multiplier) => (
            <button
              className={`btn small ${speed === multiplier ? "on" : ""}`}
              key={multiplier}
              onClick={() => onSpeed(multiplier)}
              type="button"
            >
              {multiplier}×
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// The title scroll: the story, what the sea sends tonight, how to play, and the choice of warden.
function TitleScreen({
  legacy,
  tonight,
  raised,
  gamepadConnected,
  textures,
  strike,
  ready,
  onChooseSex,
  onStart,
  onNewLine,
  onSpriteBroken,
}: {
  legacy: Legacy;
  tonight: Tonight;
  raised: RaisedTonight;
  gamepadConnected: boolean;
  textures: TextureMap | null;
  strike: { sex: Sex; count: number } | null;
  ready: boolean;
  onChooseSex: (sex: Sex) => void;
  onStart: () => void;
  onNewLine: () => void;
  onSpriteBroken: (creatureId: string) => void;
}) {
  return (
    <TitleScroll>
      <div className="scroll-layout">
        <div className="scroll-intro">
          <h1 className="brand" data-line={true}>
            <Image
              alt="Lampwarden"
              height={37}
              loading="eager"
              src="/logo/logo-noglow.png"
              unoptimized={true}
              width={68}
            />
          </h1>
          <div className="scroll-prose">
            {INTRODUCTION.map((line) => (
              <p data-line={true} key={line}>
                {line}
              </p>
            ))}
          </div>
        </div>
        <SeaSends onSpriteBroken={onSpriteBroken} raised={raised} tonight={tonight} />
        <HowToPlay gamepadConnected={gamepadConnected} sex={legacy.heir.sex} />
        <div className="scroll-hero">
          <h2 className="scroll-heading" data-line={true}>
            Who takes up the lamp?
          </h2>
          <div className="hero-cards" data-line={true}>
            {SEXES.map((sex) => {
              const chosen = legacy.heir.sex === sex;
              return (
                <button
                  aria-pressed={chosen}
                  className={`hero-card ${chosen ? "chosen" : ""}`}
                  data-sex={sex}
                  key={sex}
                  onClick={() => onChooseSex(sex)}
                  type="button"
                >
                  <span className="hero-portrait">
                    <HeroPortrait sex={sex} strike={strike?.sex === sex ? strike.count : null} textures={textures} />
                  </span>
                  <span className="hero-title">{sex === "male" ? "Son" : "Daughter"}</span>
                  <span>{ARMS[sex].loadout}</span>
                  <span className="hero-mark">
                    {chosen ? (
                      <>
                        <Icon name="wick" size={16} /> chosen
                      </>
                    ) : (
                      "choose"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="warden" data-line={true}>
            {legacy.heir.name}, {ordinal(legacy.generation)} Lampwarden · <TraitMark trait={legacy.heir.trait} />
          </p>
          <p className="dim" data-line={true}>
            Night {legacy.night}
            {legacy.bestNight ? ` · best night ${legacy.bestNight}` : ""}
          </p>
          <button className="btn big" data-line={true} disabled={!ready} onClick={onStart} type="button">
            {ready ? "Light the lamps" : "Lighting the lamps…"}
          </button>
          {legacy.generation > 1 && (
            <button className="btn small" data-line={true} onClick={onNewLine} type="button">
              Start a new bloodline
            </button>
          )}
          <p className="privacy dim" data-line={true}>
            Each night you play is recorded anonymously (your inputs, no personal data) so we can balance the game.
          </p>
        </div>
      </div>
    </TitleScroll>
  );
}

// After a night that was lost: what happened, the heirs to choose from, the shop, and on into the next night.
function HeirPanel({
  report,
  heirs,
  legacy,
  shop,
  tonight,
  raised,
  onSpriteBroken,
  onChooseHeir,
  onStart,
}: {
  report: Report;
  heirs: readonly Heir[];
  legacy: Legacy;
  shop: ReactNode;
  tonight: Tonight;
  raised: RaisedTonight;
  onSpriteBroken: (creatureId: string) => void;
  onChooseHeir: (heir: Heir) => void;
  onStart: () => void;
}) {
  return (
    <div aria-labelledby={PANEL_TITLE_ID} className="panel" role="dialog">
      <h2 className="logo small" id={PANEL_TITLE_ID} ref={focusOnMount} tabIndex={-1}>
        {report.outcome === "dark" ? "DARKNESS" : "FALLEN"}
      </h2>
      <p>
        {report.outcome === "dark"
          ? `The lamps of Lychnos went dark on night ${report.night}.`
          : `${report.name} fell on night ${report.night}.`}{" "}
        Their oil passes to the next warden.
      </p>
      <SeaAnswer report={report} />
      <div className="heirs">
        {heirs.map((heir) => (
          <button
            className={`btn heir ${legacy.heir.name === heir.name ? "on" : ""}`}
            key={heir.name}
            onClick={() => onChooseHeir(heir)}
            type="button"
          >
            <Icon name={heir.trait} />
            <div>
              <b>{heir.name}</b>
              <span>{ARMS[heir.sex].loadout}</span>
              <span>
                {TRAITS[heir.trait].label}: {TRAITS[heir.trait].text}
              </span>
            </div>
          </button>
        ))}
      </div>
      {shop}
      <SeaSends onSpriteBroken={onSpriteBroken} raised={raised} tonight={tonight} />
      <button
        className="btn big"
        disabled={!heirs.some((heir) => heir.name === legacy.heir.name)}
        onClick={onStart}
        type="button"
      >
        {heirs.some((heir) => heir.name === legacy.heir.name)
          ? `${legacy.heir.name} takes up the lamp`
          : "Choose an heir"}
      </button>
    </div>
  );
}

// After a night held to dawn: what it earned, the shop, and on into the next night.
function DawnPanel({
  report,
  legacy,
  shop,
  tonight,
  raised,
  onSpriteBroken,
  onStart,
}: {
  report: Report;
  legacy: Legacy;
  shop: ReactNode;
  tonight: Tonight;
  raised: RaisedTonight;
  onSpriteBroken: (creatureId: string) => void;
  onStart: () => void;
}) {
  return (
    <div aria-labelledby={PANEL_TITLE_ID} className="panel" role="dialog">
      <h2 className="logo small" id={PANEL_TITLE_ID} ref={focusOnMount} tabIndex={-1}>
        DAWN
      </h2>
      <p>
        {report.name} held night {report.night}. {report.kills} slain, {report.lampsLost}{" "}
        {report.lampsLost === 1 ? "lamp" : "lamps"} snuffed.
      </p>
      <p>
        +{report.oil} oil from the slain, +{report.bonus} for the lamps still burning.
      </p>
      <SeaAnswer report={report} />
      {shop}
      <SeaSends onSpriteBroken={onSpriteBroken} raised={raised} tonight={tonight} />
      <button className="btn big" onClick={onStart} type="button">
        Into night {legacy.night}
      </button>
    </div>
  );
}

// The end of a replay: the night it showed, and whether it ended where the live night did.
function ReplayEndPanel({
  replay,
  onWatchAgain,
}: {
  replay: { play: Play; endsMatch: boolean | null };
  onWatchAgain: () => void;
}) {
  return (
    <div aria-labelledby={PANEL_TITLE_ID} className="panel" role="dialog">
      <h2 className="logo small" id={PANEL_TITLE_ID} ref={focusOnMount} tabIndex={-1}>
        REPLAY OVER
      </h2>
      <p>{describeNight(replay.play)}</p>
      <p className="dim">{replayVerdict(replay.endsMatch)}</p>
      <button className="btn big" onClick={onWatchAgain} type="button">
        Watch again
      </button>
    </div>
  );
}

// A recording from another version of the sim, which cannot be replayed exactly. Nothing until there is one.
function ReplayRefusedPanel({ play }: { play: unknown }) {
  if (play === null) {
    return null;
  }
  const described = describeNight(play);
  return (
    <div aria-labelledby={PANEL_TITLE_ID} className="panel" data-panel="replay-refused" role="dialog">
      <h2 className="logo small" id={PANEL_TITLE_ID} ref={focusOnMount} tabIndex={-1}>
        AN EARLIER VERSION
      </h2>
      <p>This night was played on an earlier version of Lampwarden and can't be replayed exactly.</p>
      {described ? <p>{described}</p> : null}
      <button className="btn big" onClick={() => location.assign("/")} type="button">
        Back to the title
      </button>
    </div>
  );
}

// Why the title can never light, when it cannot: the graphics would not start, or the pictures would not load.
function LoadFailurePanel({ failure }: { failure: "assets" | "graphics" | null }) {
  if (failure === "graphics") {
    return (
      <FailurePanel
        action="Reload"
        hint="It draws with WebGL: turn on hardware acceleration or try another browser, then reload."
        message="Lampwarden could not start its graphics."
        onAction={() => location.reload()}
        title="NO LAMPLIGHT"
      />
    );
  }
  if (failure === "assets") {
    return (
      <FailurePanel
        action="Reload"
        hint="Check your connection, then reload."
        message="The pictures for the night would not load."
        onAction={() => location.reload()}
        title="THE LAMPS WON'T LIGHT"
      />
    );
  }
  return null;
}

// A replay that could not be loaded, and why. Nothing when there is no such error.
function ReplayErrorPanel({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }
  return (
    <div aria-labelledby={PANEL_TITLE_ID} className="panel" data-panel="replay-error" role="dialog">
      <h2 className="logo small" id={PANEL_TITLE_ID} ref={focusOnMount} tabIndex={-1}>
        NO REPLAY
      </h2>
      <p>Could not load that replay: {error}</p>
      <button className="btn big" onClick={() => location.assign("/")} type="button">
        Back to the title
      </button>
    </div>
  );
}

function TraitMark({ trait }: { trait: TraitId }) {
  return (
    <span className="trait">
      <Icon name={trait} size={16} />
      {TRAITS[trait].label}
    </span>
  );
}

// The sea's answer on the dawn and heir panels: the live director's own line when it came in time, else the rules' note.
// One live region stays mounted, so a screen reader hears the line when it replaces the note.
function SeaAnswer({ report }: { report: Report }) {
  return (
    <div aria-live="polite">
      {report.line ? (
        <p className="sea-answer" data-director-line={true}>
          {report.line}
        </p>
      ) : (
        <p className="dim">{tideNote(report)}</p>
      )}
    </div>
  );
}

function tideNote(report: Report) {
  if (report.tideAfter > report.tideBefore) {
    return `The sea noticed. It is ${tideLabel(report.tideAfter)} now.`;
  }
  if (report.tideAfter < report.tideBefore) {
    return `The sea draws back. It is ${tideLabel(report.tideAfter)} now.`;
  }
  return `The sea stays ${tideLabel(report.tideAfter)}.`;
}

// Moves focus between the menu's buttons, or presses one, for a gamepad.
function actOnMenu(action: MenuAction) {
  document.body.dataset.input = "gamepad"; // shows the focus ring on gamepad-focused buttons
  // the first press while the title scroll unrolls completes it (TitleScroll catches the click) and does nothing else
  // biome-ignore lint/security/noSecrets: a CSS selector
  const unrolling = document.querySelector<HTMLElement>(".scroll:not([data-stage='done'])");
  if (unrolling) {
    unrolling.click();
    return;
  }
  // biome-ignore lint/security/noSecrets: a CSS selector
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel button:not([disabled])")];
  // biome-ignore lint/security/noSecrets: a CSS selector
  const primary = document.querySelector<HTMLButtonElement>(".panel .btn.big:not([disabled])");
  const focused =
    document.activeElement instanceof HTMLButtonElement && buttons.includes(document.activeElement)
      ? document.activeElement
      : null;
  // the pad's press shows as a press (:active does not fire for a click made by code)
  const pressButton = (button: HTMLButtonElement | null | undefined) => {
    if (!button) {
      return;
    }
    flashPressed(button);
    button.click();
  };
  if (action === "primary") {
    pressButton(primary);
    return;
  }
  if (action === "confirm") {
    pressButton(focused ?? primary);
    return;
  }
  if (!buttons.length) {
    return;
  }
  const index = focused ? buttons.indexOf(focused) : -1;
  const previous = index <= 0 ? buttons.length - 1 : index - 1;
  const next = action === "next" ? (index + 1) % buttons.length : previous;
  buttons[next]?.focus();
  buttons[next]?.scrollIntoView({ block: "nearest" });
}
