"use client";

import { Application } from "@pixi/react";
import Image from "next/image";
import type { Application as PixiApp } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { FailurePanel } from "@/components/FailurePanel";
import { HeroPortrait } from "@/components/HeroPortrait";
import { HowToPlay } from "@/components/HowToPlay";
import { Icon } from "@/components/Icon";
import { Opening } from "@/components/Opening";
import { PracticeCard } from "@/components/PracticeCard";
import { type Driver, type Night, Scene } from "@/components/Scene";
import { SeaSends } from "@/components/SeaSends";
import { TitleScroll } from "@/components/TitleScroll";
import { TouchControls } from "@/components/TouchControls";
import { useRaised } from "@/components/useRaised";
import { useTonight } from "@/components/useTonight";
import { type RecordedBuilding, recordedBuildingOf, recordedBuildingSchema } from "@/game/building";
import { newControls, press, release, stick } from "@/game/controls";
import { recordedCreatureSchema } from "@/game/creature";
import { askDirector } from "@/game/director-api";
import { engagementOf, heldTide } from "@/game/engagement";
import { activeGamepad, holdGamepad, type MenuAction, newGamepadMemory, pollGamepadForMenu } from "@/game/gamepad";
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
  MAX_LEVEL,
  meet,
  newLegacy,
  openShop,
  ordinal,
  saveLegacy,
  setRulesDirector,
  TRAITS,
  type TraitId,
  tideLabel,
  type UpgradeId,
  upgradeCost,
} from "@/game/legacy";
import { newOpening, OPENING_LINES, type Opening as OpeningScene, stageOpening } from "@/game/opening";
import { describeNight, playSchema, playVersion, RUNNING_SIM, replaysExactlyOn } from "@/game/plays";
import { type Lesson, newPractice, type Practice, stagePractice } from "@/game/practice";
import { bindKeyboardPress, flashPressed } from "@/game/pressed";
import { clearRaised, loadRaised, raise, saveRaised } from "@/game/raised";
import { isVerifying, type Play, Recorder, resendQueuedPlays, upload } from "@/game/recording";
import { creatureOf, legacyOf, Replayer, verifyPlay } from "@/game/replay";
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
import { isNewLine, loadWelcome, markWelcome, type Welcome } from "@/game/welcome";
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
const NEW_LINE_CONFIRM_TIME = 4000; // ms "Start a new bloodline" waits for its second press before it settles back

// A load that gives up after `milliseconds` with null, and stops its timer when it does not need to wait that long
function loadWithin<Loaded>(load: Promise<Loaded | null>, milliseconds: number): Promise<Loaded | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds);
  });
  return Promise.race([load, giveUp]).finally(() => clearTimeout(timer));
}

// the title's introduction tells the opening scene's story in its own third line
const INTRODUCTION = [OPENING_LINES[0], OPENING_LINES[1], "Keep one burning until dawn.", OPENING_LINES[3]];

// A new player's first visit opens on the opening scene: not a replay, not an heir choice left open, and never under the
// visual verifier, which asks for it. Read once at mount (the game only runs in the browser), so the title never shows
// before it.
function opensWithOpening() {
  const legacy = loadLegacy();
  return (
    !loadWelcome().opening &&
    isNewLine(legacy) &&
    !legacy.heirChoice &&
    !new URLSearchParams(location.search).has("replay") &&
    !isVerifying()
  );
}

// one HUD diamond per lamp, keyed by where the lamp stands
const LAMP_SLOTS = LAMP_SPOTS.map(([x, y]) => `${x},${y}`);

// The building raised on a night's plaza: its record as a recording keeps it, and its sprite, loaded
interface Plaza {
  building: RecordedBuilding;
  textures: TextureMap;
}

// "opening" is the opening scene before the title, "practice" the practice night and "practiced" the panel after it
type Phase =
  | "title"
  | "opening"
  | "practice"
  | "practiced"
  | "night"
  | "dawn"
  | "heir"
  | "replay"
  | "replayEnd"
  | "replayRefused";
// the phases in which the player has the warden: the window losing focus holds them, and the pad drives the warden
const playing = (phase: Phase) => phase === "night" || phase === "practice";
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
const sameHud = (first: Hud, second: Hud) =>
  first.health === second.health &&
  first.hits === second.hits &&
  first.lit === second.lit &&
  first.kills === second.kills &&
  first.oil === second.oil &&
  Math.abs(first.dawn - second.dawn) < 0.01;

export default function Game() {
  const appRef = useRef<PixiApp | null>(null);
  const stateRef = useRef<State | null>(null); // the night on screen, also read outside React (debug hook, pagehide)
  const [textures, setTextures] = useState<TextureMap | null>(null);
  const [night, setNight] = useState<Night | null>(null);
  const [paused, setPaused] = useState(true);
  const [away, setAway] = useState(false); // a live night is held because the window lost focus, until the player resumes
  const awayRef = useRef(away);
  awayRef.current = away;
  const [loadFailure, setLoadFailure] = useState<"assets" | "graphics" | null>(null); // why the title can never light
  const [frozenClock, freezeClock] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false); // the canvas has shown a frame; before that it is hidden, not black
  const [controls] = useState(newControls);
  const lastHudRef = useRef<Hud | null>(null);
  const legacyRef = useRef<Legacy>(newLegacy());
  const [, rerender] = useState(0);
  const refresh = useCallback(() => rerender((count) => count + 1), []);
  const [phase, setPhase] = useState<Phase>(() => (opensWithOpening() ? "opening" : "title"));
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
  const [loadingReplay, setLoadingReplay] = useState(false); // a recording is being fetched (and its sprites loaded)
  const [confirmingNewLine, setConfirmingNewLine] = useState(false); // the first press of "Start a new bloodline" came
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
  const [isStarting, setStarting] = useState(false); // the same, for the buttons: they wait with it
  const directorAsk = useRef<AbortController | null>(null); // the live director being asked about the night that ended
  const welcomeRef = useRef<Welcome>({ opening: true, practice: true }); // what this player has been shown (loaded below)
  const openingRef = useRef<OpeningScene | null>(null); // the opening scene on stage
  const [openingLine, setOpeningLine] = useState(0);
  const practiceRef = useRef<Practice | null>(null); // the practice night on stage
  const [lesson, setLesson] = useState<Lesson>("move");

  // every night is recorded (inputs + timeline) and sent to /api/plays; the last one is also kept locally (?replay=last)
  const sendPlay = useCallback((state: State | null): SentPlay | null => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !state) return null;
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
    if (play) void upload(play, true);
  }, []);

  // Asks the live director about the night that just ended, once its recording is up. The answer is used only if it comes
  // while the dawn or heir panel is still up: starting the next night calls it off (startNight), and the rules' decision,
  // which is already in place, plays instead. The panel never waits for it.
  const consultDirector = useCallback((playId: string, sent: Promise<boolean>) => {
    directorAsk.current?.abort();
    const asking = new AbortController();
    directorAsk.current = asking;
    void sent.then(async (uploaded) => {
      if (!uploaded || asking.signal.aborted) return;
      const answer = await askDirector(playId, asking.signal);
      if (!answer || asking.signal.aborted) return;
      const legacy = legacyRef.current;
      if (!applyDirector(legacy, answer.decision)) return;
      saveLegacy(legacy);
      setReport((current) => current && { ...current, tideAfter: legacy.tide, line: legacy.director.line });
    });
  }, []);

  // pausing also lets go of held keys and the stick
  const pause = useCallback(
    (shouldPause: boolean) => {
      setPaused(shouldPause);
      if (shouldPause) release(controls);
      else setAway(false);
    },
    [controls],
  );

  // a live night waits when the window loses focus or the tab is hidden; the player resumes it from the pause panel
  // (replays and menus carry on: a replay's steps come from its recording, not from the clock)
  useEffect(() => {
    const holdNight = () => {
      // a practice skipped for the night being put together stays held, without the pause panel
      if (!playing(phaseRef.current) || starting.current) return;
      pause(true);
      setAway(true);
    };
    const holdHiddenNight = () => {
      if (document.hidden) holdNight();
    };
    // the visual verifier (?verify) runs several pages in one window, and any of them may lose focus mid-night
    if (!isVerifying()) window.addEventListener("blur", holdNight);
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
      if (appRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!appRef.current) setLoadFailure("graphics");
      }, RENDERER_GRACE);
    };
    window.addEventListener("unhandledrejection", rendererFailed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("unhandledrejection", rendererFailed);
    };
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

  // The opening scene, before the title: a staged night whose driver plays it (src/game/opening.ts); the player's input
  // is not used. It ends by itself, or on Skip, and the title comes with the quiet plaza behind it.
  const playOpening = useCallback(() => {
    const opening = newOpening(legacyRef.current.heir.sex);
    openingRef.current = opening;
    show(opening.state, legacyRef.current.heir.sex, () => stageOpening(opening));
    setOpeningLine(0);
    pause(false);
    phaseRef.current = "opening";
    setPhase("opening");
  }, [show, pause]);
  const endOpening = useCallback(() => {
    if (phaseRef.current !== "opening") return;
    openingRef.current = null;
    welcomeRef.current = markWelcome(welcomeRef.current, "opening");
    show(newNight(legacyRef.current), legacyRef.current.heir.sex);
    pause(true);
    phaseRef.current = "title";
    setPhase("title");
  }, [show, pause]);

  // The practice night: a staged night (src/game/practice.ts) the player plays, its lessons staged before each step. It is
  // not recorded and its oil is not kept; when the last lesson is learned its panel leads into the real night.
  const startPractice = useCallback(() => {
    const practice = newPractice(legacyRef.current, newSeed());
    practiceRef.current = practice;
    show(practice.state, legacyRef.current.heir.sex, (_stepIndex, live) => {
      stagePractice(practice);
      return live;
    });
    setLesson(practice.lesson);
    setHud(hudOf(practice.state, legacyRef.current));
    setReport(null);
    pause(false);
    phaseRef.current = "practice";
    setPhase("practice");
  }, [show, pause]);
  // the practice is learned only when its last lesson is (a night that somehow ended is over, but teaches nothing)
  const endPractice = useCallback(
    (learned: boolean) => {
      if (learned) welcomeRef.current = markWelcome(welcomeRef.current, "practice");
      pause(true);
      phaseRef.current = "practiced";
      setPhase("practiced");
    },
    [pause],
  );

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
        const heirs = heirChoices(Math.random, legacy.heir.name);
        setHeirs(heirs);
        legacy.heirChoice = { name: nightReport.name, night: nightReport.night, outcome, tideBefore, heirs };
        phaseRef.current = "heir";
        setPhase("heir");
      }
      openShop(legacy); // the shop opens on the new offers; saved with them, so a reload does not reroll
      saveLegacy(legacy);
      pause(true);
      setReport(nightReport);
      askSea(legacy.bestiary); // what the sea sends next
      if (sent) consultDirector(sent.id, sent.uploaded);
    },
    [sendPlay, consultDirector, pause, askSea],
  );

  // every frame, after the sim has stepped: HUD, end of the night, end of a replay
  const onTick = useCallback(
    (state: State) => {
      if (state !== stateRef.current) return; // a night just replaced and not yet on stage
      const showHud = () => {
        const nextHud = hudOf(state, legacyRef.current);
        if (!lastHudRef.current || !sameHud(lastHudRef.current, nextHud)) {
          lastHudRef.current = nextHud;
          setHud(nextHud);
        }
      };
      if (phaseRef.current === "opening") {
        const opening = openingRef.current;
        if (opening?.state !== state) return;
        setOpeningLine(opening.line);
        if (opening.ended || state.outcome) endOpening();
        return;
      }
      if (phaseRef.current === "practice") {
        const practice = practiceRef.current;
        if (practice?.state !== state) return;
        setLesson(practice.lesson);
        if (practice.lesson === "done" || state.outcome) {
          endPractice(practice.lesson === "done");
          return;
        }
        showHud();
        return;
      }
      if (phaseRef.current === "replay") {
        if (state.outcome) {
          phaseRef.current = "replayEnd";
          setPhase("replayEnd");
          return;
        }
        showHud();
        return;
      }
      if (phaseRef.current !== "night") return;
      if (state.outcome) {
        endNight(state, state.outcome);
        return;
      }
      showHud();
    },
    [endNight, endOpening, endPractice],
  );
  const onReady = useCallback(() => setReady(true), []);
  const onInit = useCallback((app: PixiApp) => {
    appRef.current = app;
    // the ticker renders after this callback, and the frame is on screen by the next animation frame
    app.ticker.addOnce(() => requestAnimationFrame(() => setDrawn(true)));
  }, []);

  const playReplay = useCallback(
    async (id: string) => {
      let fetched: unknown;
      try {
        if (id === "last") fetched = JSON.parse(localStorage.getItem("lampwarden:lastPlay") || "null");
        else {
          const response = await fetch(`/api/plays/${encodeURIComponent(id)}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          fetched = await response.json();
        }
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
      // the night's creature is in the recording; if its sprite is gone the replay draws the monster that plays like it
      let creatureTextures: TextureMap | null = null;
      if (creature && play.creature)
        creatureTextures =
          (await loadCreatureTextures(creature.id)) ??
          standInTextures(await loadTextures(), creature.id, play.creature.archetype);
      // the building the night's plaza was laid out with is in the recording too (rendering only: the sim never reads it);
      // a play from before buildings, or one whose sprite is gone, replays on the committed plaza
      const recordedBuilding = recordedBuildingOf(play);
      const buildingTextures = recordedBuilding ? await loadBuildingTexture(recordedBuilding) : null;
      const plaza =
        recordedBuilding && buildingTextures ? { building: recordedBuilding, textures: buildingTextures } : null;
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

  // the title stays hidden while a replay is on its way
  const startReplay = useCallback(
    async (id: string) => {
      setLoadingReplay(true);
      try {
        await playReplay(id);
      } finally {
        setLoadingReplay(false);
      }
    },
    [playReplay],
  );

  // gamepad: note when one is connected (for the help line), and drive the menus with it outside a night (and on the
  // panel of a night held while the window was away, so a pad alone can resume it)
  useEffect(() => {
    const refreshConnection = () => setGamepadConnected(activeGamepad() !== null);
    window.addEventListener("gamepadconnected", refreshConnection);
    window.addEventListener("gamepaddisconnected", refreshConnection);
    const memory = newGamepadMemory();
    let frame = 0;
    const poll = (now: number) => {
      frame = requestAnimationFrame(poll);
      if ((playing(phaseRef.current) && !awayRef.current) || phaseRef.current === "replay") {
        // a button held as the night pauses is not a press on its panel; Start skips the practice
        if (holdGamepad(memory) && phaseRef.current === "practice")
          document.querySelector<HTMLButtonElement>(".practice-skip:not([disabled])")?.click();
        return;
      }
      const action = pollGamepadForMenu(memory, now);
      if (action) actOnMenu(action);
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
    welcomeRef.current = loadWelcome();
    refresh();
    const replayId = new URLSearchParams(location.search).get("replay");
    if (replayId) setLoadingReplay(true); // the title is not shown under a replay that is on its way
    const resent = resendQueuedPlays(); // nights an earlier page could not send
    let dead = false;
    void loadTextures().then(
      (loaded) => {
        if (dead) return;
        setTextures(loaded);
        // preview: a quiet plaza behind the title screen
        show(newNight(legacyRef.current), legacyRef.current.heir.sex);
        if (replayId) {
          void startReplay(replayId);
          return;
        }
        // the live director is asked again about the night that ended, if its answer had not come before the page went
        // away (once that night's recording, if it was still queued, has been sent)
        const legacy = legacyRef.current;
        const waiting = legacy.director;
        if (waiting.source === "rules" && waiting.playId)
          consultDirector(
            waiting.playId,
            resent.then(() => true),
          );
        // a warden fell and the page went away before an heir took up the lamp: the same choice is offered again
        const choice = legacy.heirChoice;
        if (choice) {
          setHeirs(choice.heirs);
          setReport({
            outcome: choice.outcome,
            night: choice.night,
            kills: 0, // the heir panel shows only who fell, when and how, and the sea's answer
            lampsLost: 0,
            oil: 0,
            bonus: 0,
            name: choice.name,
            tideBefore: choice.tideBefore,
            tideAfter: legacy.tide,
            line: legacy.director.line,
          });
          phaseRef.current = "heir";
          setPhase("heir");
        }
        // the opening scene the page started on (opensWithOpening), unless it was skipped while the pictures loaded
        else if (phaseRef.current === "opening") playOpening();
        askSea(legacy.bestiary); // before the night: what does the sea send?
      },
      () => {
        if (!dead) setLoadFailure((current) => current ?? "assets");
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
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      dead = true;
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [sendSnapshot, pause, controls, refresh, show, startReplay, askSea, consultDirector, playOpening]);

  // a creature announced for tonight has its sprite loaded ahead of the night; if it will not load, it is not announced
  const announced = tonight.kind === "ready" ? tonight.creature.id : null;
  const announcedFrames = tonight.kind === "ready" ? tonight.creature.frames : undefined;
  useEffect(() => {
    if (!announced) return;
    void loadCreatureTextures(announced, announcedFrames ?? null).then((loaded) => {
      if (!loaded) withdraw(announced);
    });
  }, [announced, announcedFrames, withdraw]);

  // a building announced for tonight has its sprite loaded ahead of the night; if it will not load, it is not announced
  const announcedBuilding = raised.kind === "ready" ? raised.building : null;
  useEffect(() => {
    if (!announcedBuilding) return;
    void loadBuildingTexture(announcedBuilding).then((loaded) => {
      if (!loaded) withdrawRaised(announcedBuilding.id);
    });
  }, [announcedBuilding, withdrawRaised]);

  // One night at a time; the buttons wait while it is put together, and come back if it cannot be
  const startNight = async () => {
    if (starting.current) return;
    starting.current = true;
    setStarting(true);
    try {
      await lightNight();
    } finally {
      starting.current = false;
      setStarting(false);
    }
  };
  const lightNight = async () => {
    directorAsk.current?.abort(); // an answer that comes now is too late for this night
    directorAsk.current = null;
    // The creature that was ready joins the night if its sprite is loaded by now. If it is still being made, or does
    // not load, the night has none; a job still being made carries on through the night and the creature is announced
    // at dawn for the next one.
    const announcedCreature = tonight.kind === "ready" ? tonight.creature : null;
    // The building that was ready stands on the night's plaza the same way: if its sprite is loaded by now. Otherwise the
    // plaza is the committed one.
    const buildingLoad = announcedBuilding
      ? loadWithin(loadBuildingTexture(announcedBuilding), CREATURE_LOAD_TIMEOUT)
      : Promise.resolve(null);
    const loaded = announcedCreature
      ? await loadWithin(
          loadCreatureTextures(announcedCreature.id, announcedCreature.frames ?? null),
          CREATURE_LOAD_TIMEOUT,
        )
      : null;
    const creature = announcedCreature && loaded ? announcedCreature : null;
    if (creature) {
      meet(legacyRef.current, creature.id);
      saveLegacy(legacyRef.current);
    }
    // Now that this night's creature is met, ask for the next night's: the ~minute a creature takes to make overlaps the
    // night, so it is ready by dawn on the longer nights (on the 28 to 40 s ones it is still being made at dawn). Asking again
    // with the same ids met keeps a job that is still running.
    const loadedBuilding = await buildingLoad;
    const building = announcedBuilding && loadedBuilding ? recordedBuildingSchema.parse(announcedBuilding) : null;
    if (building) {
      raisedRef.current = raise(raisedRef.current, building.id);
      saveRaised(raisedRef.current);
    }
    askSea(legacyRef.current.bestiary);
    const seed = newSeed();
    const state = newNight(legacyRef.current, seed, creature && nightCreature(creature));
    const recorder = new Recorder(
      legacyRef.current,
      seed,
      "",
      creature && recordedCreatureSchema.parse(creature),
      RUNNING_SIM,
      building,
    );
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
    if (legacyRef.current.heirChoice) {
      legacyRef.current.heirChoice = undefined; // an heir has taken up the lamp
      saveLegacy(legacyRef.current);
    }
    pause(false);
    setHud(hudOf(state, legacyRef.current));
    setReport(null);
    phaseRef.current = "night";
    setPhase("night");
  };
  // A new player's first "Light the lamps" opens the practice night (never under the visual verifier, which asks for it)
  const lightFirstNight = () => {
    if (!welcomeRef.current.practice && isNewLine(legacyRef.current) && !isVerifying()) startPractice();
    else void startNight();
  };
  // The practice holds still while the real night is put together (its creature's sprite may still be loading), and
  // carries on if the night could not be.
  const skipPractice = () => {
    welcomeRef.current = markWelcome(welcomeRef.current, "practice");
    pause(true);
    void startNight()
      .catch(() => {})
      .finally(() => {
        if (phaseRef.current === "practice") pause(false);
      });
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
  // The first press asks again, and the second, within NEW_LINE_CONFIRM_TIME, ends the line: it takes the oil, the
  // upgrades and the bestiary with it.
  useEffect(() => {
    if (!confirmingNewLine) return;
    const timer = setTimeout(() => setConfirmingNewLine(false), NEW_LINE_CONFIRM_TIME);
    return () => clearTimeout(timer);
  }, [confirmingNewLine]);
  const newLine = () => {
    if (!confirmingNewLine) {
      setConfirmingNewLine(true);
      return;
    }
    setConfirmingNewLine(false);
    directorAsk.current?.abort();
    clearLegacy();
    legacyRef.current = newLegacy();
    clearRaised();
    raisedRef.current = [];
    showPreview();
    refresh();
    askSea(legacyRef.current.bestiary);
  };
  // the warden behind the title screen is the one chosen; the plaza around them stays as it is laid out
  const showPreview = () => {
    const sex = legacyRef.current.heir.sex;
    setNight((current) => current && { ...current, sex });
  };
  const chooseSex = (sex: Sex) => {
    const legacy = legacyRef.current;
    // every choice, the chosen card's again too, has that warden swing once (HeroPortrait)
    setStrike((previous) => ({ sex, count: (previous?.count ?? 0) + 1 }));
    if (legacy.heir.sex === sex) return;
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
            key={id}
            type="button"
            className="btn up"
            data-upgrade={id}
            disabled={cost === null || legacy.oil < cost}
            onClick={() => purchase(id)}
          >
            <Icon name={view.icon} />
            <div>
              <b>{view.label}</b>
              <em role="img" aria-label={`level ${legacy.levels[id]} of ${MAX_LEVEL}`}>
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
      data-phase={phase}
      data-ready={ready ? 1 : 0}
      data-hp={hud?.health}
      data-lit={hud?.lit}
      data-kills={hud?.kills}
    >
      <div className="canvas" data-drawn={drawn || undefined}>
        <Application {...APP} onInit={onInit}>
          {textures && night && (
            <Scene
              night={night}
              textures={textures}
              controls={controls}
              paused={paused}
              speed={speed}
              frozenClock={frozenClock}
              onTick={onTick}
              onReady={onReady}
            />
          )}
        </Application>
      </div>
      <div className="hud">
        {(phase === "night" || phase === "replay" || phase === "practice") && hud && (
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
                className={hud.hits > 0 ? "bar struck" : "bar"}
                key={hud.hits}
                role="meter"
                aria-label="Health"
                aria-valuemin={0}
                aria-valuemax={Math.round(hud.maxHealth)}
                aria-valuenow={Math.round(hud.health)}
              >
                <i style={{ width: `${(hud.health / hud.maxHealth) * 100}%` }} />
              </div>
              {/* the practice night's oil is never kept, so it is not counted */}
              <div
                className="oilline"
                role="img"
                aria-label={phase === "practice" ? `${hud.kills} slain` : `${hud.kills} slain, ${hud.oil} oil`}
              >
                <Icon name="slain" size={16} /> {hud.kills}
                {phase !== "practice" && (
                  <>
                    {" "}
                    <Icon name="oil" size={16} /> {hud.oil}
                  </>
                )}
              </div>
            </div>
            {phase === "practice" ? (
              <PracticeCard
                lesson={lesson}
                gamepadConnected={gamepadConnected}
                sex={legacy.heir.sex}
                skipping={isStarting}
                onSkip={skipPractice}
              />
            ) : (
              <div className="nightbar">
                <div>
                  Night {legacy.night}
                  <span className="long"> · the sea is {tideLabel(legacy.tide)}</span>
                </div>
                <div
                  className="bar dawnbar"
                  role="progressbar"
                  aria-label="Night until dawn"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(hud.dawn * 100)}
                  aria-valuetext={`${Math.round(hud.dawn * 100)} percent of the night gone`}
                >
                  <i style={{ width: `${hud.dawn * 100}%` }} />
                </div>
              </div>
            )}
            <div className="lamps" role="img" aria-label={`${hud.lit} of ${hud.lamps} lamps lit`}>
              <span className="long">Lamps </span>
              {LAMP_SLOTS.slice(0, hud.lamps).map((slot, index) => (
                <span key={slot} className={index < hud.lit ? "lit" : ""}>
                  {index < hud.lit ? "◆" : "◇"}
                </span>
              ))}
            </div>
            {phase === "practice" ? null : phase === "night" ? (
              <div className="help">
                {gamepadConnected
                  ? "Left stick move · A strike (the stick turns you) · B or RT shoot (right stick aims) · stand by a dark lamp to relight it"
                  : "WASD move · J or Space strike (hold a direction to turn) · K or click shoot · stand by a dark lamp to relight it"}
              </div>
            ) : (
              <div className="replaybar">
                REPLAY {replay?.play.id}
                {[1, 2, 4].map((multiplier) => (
                  <button
                    key={multiplier}
                    type="button"
                    className={`btn small ${speed === multiplier ? "on" : ""}`}
                    aria-pressed={speed === multiplier}
                    onClick={() => setSpeed(multiplier)}
                  >
                    {multiplier}×
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {playing(phase) && <div className="rotate">Turn your phone sideways for a bigger view</div>}
        {playing(phase) && (
          <TouchControls
            sex={legacy.heir.sex}
            onStick={(horizontal, vertical) => stick(controls, horizontal, vertical)}
            onPress={(action) => press(controls, action, stateRef.current)}
          />
        )}

        {phase === "replayEnd" && replay && !replayError && (
          <div className="panel" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
              REPLAY OVER
            </h2>
            <p>{describeNight(replay.play)}</p>
            <p className="dim">
              {replay.endsMatch === null
                ? "Abandoned night: no end to compare."
                : replay.endsMatch
                  ? "Replay ends exactly where the live night ended."
                  : "Replay diverged from the live night."}
            </p>
            <button
              type="button"
              className="btn big"
              onClick={() => void startReplay(new URLSearchParams(location.search).get("replay") || "last")}
            >
              Watch again
            </button>
            <button type="button" className="btn small" onClick={() => location.assign("/")}>
              Back to the title
            </button>
          </div>
        )}
        {phase === "replayRefused" && refusedPlay !== null && (
          <div className="panel" data-panel="replay-refused" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
              AN EARLIER VERSION
            </h2>
            <p>This night was played on an earlier version of Lampwarden and can't be replayed exactly.</p>
            {describeNight(refusedPlay) && <p>{describeNight(refusedPlay)}</p>}
            <button type="button" className="btn big" onClick={() => location.assign("/")}>
              Back to the title
            </button>
          </div>
        )}
        {playing(phase) && away && (
          <div className="panel" data-panel="paused" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID}>
              PAUSED
            </h2>
            <p>The window lost focus, so the night is waiting for you.</p>
            <button type="button" className="btn big" onClick={resume} ref={focusResume}>
              Resume
            </button>
          </div>
        )}
        {loadFailure === "graphics" && (
          <FailurePanel
            title="NO LAMPLIGHT"
            message="Lampwarden could not start its graphics."
            hint="It draws with WebGL: turn on hardware acceleration or try another browser, then reload."
            action="Reload"
            onAction={() => location.reload()}
          />
        )}
        {loadFailure === "assets" && (
          <FailurePanel
            title="THE LAMPS WON'T LIGHT"
            message="The pictures for the night would not load."
            hint="Check your connection, then reload."
            action="Reload"
            onAction={() => location.reload()}
          />
        )}
        {replayError && (
          <div className="panel" data-panel="replay-error" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
              NO REPLAY
            </h2>
            <p>Could not load that replay: {replayError}</p>
            <button type="button" className="btn big" onClick={() => location.assign("/")}>
              Back to the title
            </button>
          </div>
        )}

        {phase === "opening" && !loadFailure && <Opening line={openingLine} onEnd={endOpening} />}
        {phase === "practiced" && (
          <div className="panel" data-panel="practiced" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
              THE WATCH IS YOURS
            </h2>
            <p>That is the whole of it: strike, shoot, relight, and keep a lamp burning until dawn.</p>
            <p className="dim">
              On a real night the bar at the top fills towards dawn, and the oil the slain leave buys upgrades. Practice
              is not recorded and keeps no oil.
            </p>
            <button type="button" className="btn big" disabled={isStarting} onClick={startNight}>
              {isStarting ? "Lighting the lamps…" : `Into night ${legacy.night}`}
            </button>
            <button type="button" className="btn small" disabled={isStarting} onClick={startPractice}>
              Practise again
            </button>
          </div>
        )}

        {/* a replay that could not load says so in place of the title, which would otherwise cover it */}
        {phase === "title" && !loadFailure && !replayError && !loadingReplay && (
          <TitleScroll>
            <div className="scroll-layout">
              <div className="scroll-intro">
                <h1 className="brand" data-line>
                  <Image
                    src="/logo/logo-noglow.png"
                    alt="Lampwarden"
                    width={68}
                    height={37}
                    unoptimized
                    loading="eager"
                  />
                </h1>
                <div className="scroll-prose">
                  {INTRODUCTION.map((line) => (
                    <p key={line} data-line>
                      {line}
                    </p>
                  ))}
                  <p data-line>
                    <button type="button" className="link" disabled={!ready || isStarting} onClick={playOpening}>
                      Watch the opening
                    </button>
                  </p>
                </div>
              </div>
              <SeaSends tonight={tonight} raised={raised} onSpriteBroken={withdraw} />
              <HowToPlay
                gamepadConnected={gamepadConnected}
                sex={legacy.heir.sex}
                practiseDisabled={!ready || isStarting}
                onPractise={startPractice}
              />
              <div className="scroll-hero">
                <h2 className="scroll-heading" data-line>
                  Who takes up the lamp?
                </h2>
                <div className="hero-cards" data-line>
                  {SEXES.map((sex) => {
                    const chosen = legacy.heir.sex === sex;
                    return (
                      <button
                        key={sex}
                        type="button"
                        className={`hero-card ${chosen ? "chosen" : ""}`}
                        data-sex={sex}
                        aria-pressed={chosen}
                        onClick={() => chooseSex(sex)}
                      >
                        <span className="hero-portrait">
                          <HeroPortrait
                            sex={sex}
                            textures={textures}
                            strike={strike?.sex === sex ? strike.count : null}
                          />
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
                <p className="warden" data-line>
                  {legacy.heir.name}, {ordinal(legacy.generation)} Lampwarden · <TraitMark trait={legacy.heir.trait} />
                </p>
                <p className="dim" data-line>
                  Night {legacy.night}
                  {legacy.bestNight ? ` · best night ${legacy.bestNight}` : ""}
                </p>
                <button
                  type="button"
                  className="btn big"
                  disabled={!ready || isStarting}
                  onClick={lightFirstNight}
                  data-line
                >
                  {ready && !isStarting ? "Light the lamps" : "Lighting the lamps…"}
                </button>
                {legacy.generation > 1 && (
                  <button type="button" className="btn small" disabled={isStarting} onClick={newLine} data-line>
                    {confirmingNewLine
                      ? `Press again to end the line of ${legacy.generation} wardens`
                      : "Start a new bloodline"}
                  </button>
                )}
                <p className="privacy dim" data-line>
                  Each night you play is recorded anonymously (your inputs, no personal data) so we can balance the
                  game.
                </p>
              </div>
            </div>
          </TitleScroll>
        )}

        {phase === "dawn" && report && (
          <div className="panel" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
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
            <SeaSends tonight={tonight} raised={raised} onSpriteBroken={withdraw} />
            <button type="button" className="btn big" disabled={isStarting} onClick={startNight}>
              {isStarting ? "Lighting the lamps…" : `Into night ${legacy.night}`}
            </button>
          </div>
        )}

        {phase === "heir" && report && (
          <div className="panel" role="dialog" aria-labelledby={PANEL_TITLE_ID}>
            <h2 className="logo small" id={PANEL_TITLE_ID} tabIndex={-1} ref={focusOnMount}>
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
                  key={heir.name}
                  type="button"
                  className={`btn heir ${legacy.heir.name === heir.name ? "on" : ""}`}
                  aria-pressed={legacy.heir.name === heir.name}
                  onClick={() => chooseHeir(heir)}
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
            <SeaSends tonight={tonight} raised={raised} onSpriteBroken={withdraw} />
            <button
              type="button"
              className="btn big"
              disabled={isStarting || !heirs.some((heir) => heir.name === legacy.heir.name)}
              onClick={startNight}
            >
              {isStarting
                ? "Lighting the lamps…"
                : heirs.some((heir) => heir.name === legacy.heir.name)
                  ? `${legacy.heir.name} takes up the lamp`
                  : "Choose an heir"}
            </button>
          </div>
        )}
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
        <p className="sea-answer" data-director-line>
          {report.line}
        </p>
      ) : (
        <p className="dim">{tideNote(report)}</p>
      )}
    </div>
  );
}

function tideNote(report: Report) {
  if (report.tideAfter > report.tideBefore) return `The sea noticed. It is ${tideLabel(report.tideAfter)} now.`;
  if (report.tideAfter < report.tideBefore) return `The sea draws back. It is ${tideLabel(report.tideAfter)} now.`;
  return `The sea stays ${tideLabel(report.tideAfter)}.`;
}

// Moves focus between the menu's buttons, or presses one, for a gamepad.
function actOnMenu(action: MenuAction) {
  document.body.dataset.input = "gamepad"; // shows the focus ring on gamepad-focused buttons
  // the first press while the title scroll unrolls completes it (TitleScroll catches the click) and does nothing else
  // the opening scene: A or Start skips it
  const skip = document.querySelector<HTMLButtonElement>(".opening-skip");
  if (skip) {
    if (action === "confirm" || action === "primary") skip.click();
    return;
  }
  const unrolling = document.querySelector<HTMLElement>(".scroll:not([data-stage='done'])");
  if (unrolling) {
    unrolling.click();
    return;
  }
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel button:not([disabled])")];
  const primary = document.querySelector<HTMLButtonElement>(".panel .btn.big:not([disabled])");
  const focused =
    document.activeElement instanceof HTMLButtonElement && buttons.includes(document.activeElement)
      ? document.activeElement
      : null;
  // the pad's press shows as a press (:active does not fire for a click made by code)
  const pressButton = (button: HTMLButtonElement | null | undefined) => {
    if (!button) return;
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
  if (!buttons.length) return;
  const index = focused ? buttons.indexOf(focused) : -1;
  const next = action === "next" ? (index + 1) % buttons.length : index <= 0 ? buttons.length - 1 : index - 1;
  buttons[next]?.focus();
  buttons[next]?.scrollIntoView({ block: "nearest" });
}
