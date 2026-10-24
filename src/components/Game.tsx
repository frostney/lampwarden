"use client";

import { Application } from "@pixi/react";
import Image from "next/image";
import type { Application as PixiApp } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { type Driver, type Night, Scene } from "@/components/Scene";
import { SeaSends } from "@/components/SeaSends";
import { TitleScroll } from "@/components/TitleScroll";
import { TouchControls } from "@/components/TouchControls";
import { useTonight } from "@/components/useTonight";
import { newControls, press, release, stick } from "@/game/controls";
import { activeGamepad, type MenuAction, newGamepadMemory, pollGamepadForMenu } from "@/game/gamepad";
import {
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
  TRAITS,
  tideLabel,
  UPGRADES,
  type UpgradeId,
  upgradeCost,
} from "@/game/legacy";
import { recordedCreatureSchema } from "@/game/plays";
import { creatureOf, legacyOf, type Play, Recorder, Replayer, upload, verifyPlay } from "@/game/replay";
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
import { SEXES, type Sex } from "@/scene/assets";
import { loadCreatureTextures, loadTextures, standInTextures, type TextureMap } from "@/scene/layers";

// the canvas: 960x600 game pixels, scaled by CSS, no smoothing
const APP = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  background: 0x1e5f8a,
  antialias: false,
  roundPixels: true,
  resolution: 1,
  autoDensity: false,
};

const CREATURE_LOAD_TIMEOUT = 4000; // ms a night waits for its creature's sprite before going without it

const SETTINGS = [
  { id: "greek", label: "Lychnos (Greek)", live: true },
  { id: "norse", label: "Norse", live: false },
  { id: "egyptian", label: "Egyptian", live: false },
];

const INTRODUCTION = [
  "Lychnos is a harbour of lamps.",
  "Every night the sea sends its creatures to put them out.",
  "Keep one burning until dawn.",
  "When a warden falls, an heir takes up the lamp.",
];

// one HUD diamond per lamp, keyed by where the lamp stands
const LAMP_SLOTS = LAMP_SPOTS.map(([x, y]) => `${x},${y}`);

type Phase = "title" | "night" | "dawn" | "heir" | "replay" | "replayEnd";
interface Hud {
  health: number;
  maxHealth: number;
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
  lit: litCount(state),
  lamps: state.lamps.length,
  kills: state.stats.kills,
  oil: legacy.oil + state.oilEarned,
  dawn: Math.min(1, state.elapsed / state.length),
});
const sameHud = (first: Hud, second: Hud) =>
  first.health === second.health &&
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
  const [frozenClock, freezeClock] = useState<number | null>(null);
  const [controls] = useState(newControls);
  const lastHudRef = useRef<Hud | null>(null);
  const legacyRef = useRef<Legacy>(newLegacy());
  const [, rerender] = useState(0);
  const refresh = useCallback(() => rerender((count) => count + 1), []);
  const [phase, setPhase] = useState<Phase>("title");
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [heirs, setHeirs] = useState<Heir[]>([]);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const recorderRef = useRef<Recorder | null>(null);
  const [replay, setReplay] = useState<{ play: Play; endsMatch: boolean | null } | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const { tonight, ask, stop, withdraw } = useTonight();
  const starting = useRef(false); // a night is being put together (its creature's sprite may still be loading)

  // every night is recorded (inputs + timeline) and sent to /api/plays; the last one is also kept locally (?replay=last)
  const sendPlay = useCallback((state: State | null) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !state) return;
    const play = recorder.finish(state);
    try {
      localStorage.setItem("lampwarden:lastPlay", JSON.stringify(play));
    } catch {
      /* full */
    }
    if (!new URLSearchParams(location.search).has("verify")) void upload(play); // the visual verifier's nights are not real plays
  }, []);

  // pausing also lets go of held keys and the stick
  const pause = useCallback(
    (shouldPause: boolean) => {
      setPaused(shouldPause);
      if (shouldPause) release(controls);
    },
    [controls],
  );

  const endNight = useCallback(
    (state: State, outcome: Outcome) => {
      sendPlay(state);
      const legacy = legacyRef.current;
      const bonus = outcome === "dawn" ? dawnBonus(state) : 0;
      const tideBefore = legacy.tide;
      legacy.oil += state.oilEarned + bonus;
      legacy.tide = nextTide(legacy.tide, state);
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
        setHeirs(heirChoices());
        phaseRef.current = "heir";
        setPhase("heir");
      }
      openShop(legacy); // the shop opens on the new offers; saved with them, so a reload does not reroll
      saveLegacy(legacy);
      pause(true);
      setReport(nightReport);
      ask(legacy.bestiary); // what the sea sends next
    },
    [sendPlay, pause, ask],
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
    [endNight],
  );
  const onReady = useCallback(() => setReady(true), []);
  const onInit = useCallback((app: PixiApp) => {
    appRef.current = app;
  }, []);

  // puts a night on stage
  const show = useCallback(
    (state: State, sex: Sex, driver: Driver | null = null, creatureTextures: TextureMap | null = null) => {
      stateRef.current = state;
      setNight({ state, sex, driver, creatureTextures });
    },
    [],
  );

  const startReplay = useCallback(
    async (id: string) => {
      let play: Play;
      try {
        if (id === "last") play = JSON.parse(localStorage.getItem("lampwarden:lastPlay") || "null");
        else {
          const response = await fetch(`/api/plays/${encodeURIComponent(id)}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          play = await response.json();
        }
        if (play?.v !== 1) throw new Error("no recording");
        if (play.creature !== undefined && !recordedCreatureSchema.safeParse(play.creature).success)
          throw new Error("bad creature in the recording");
      } catch (error) {
        setReplayError(String(error));
        return;
      }
      const replayLegacy = legacyOf(play);
      legacyRef.current = { ...legacyRef.current, ...replayLegacy }; // shown in the HUD only; never saved
      const creature = creatureOf(play);
      // the night's creature is in the recording; if its sprite is gone the replay draws the monster that plays like it
      let creatureTextures: TextureMap | null = null;
      if (creature && play.creature)
        creatureTextures =
          (await loadCreatureTextures(creature.id)) ??
          standInTextures(await loadTextures(), creature.id, play.creature.archetype);
      const state = newNight(replayLegacy, play.seed, creature);
      const replayer = new Replayer(play);
      show(state, replayLegacy.heir.sex, (stepIndex) => replayer.input(stepIndex), creatureTextures);
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
      if (phaseRef.current === "night" || phaseRef.current === "replay") return;
      const action = pollGamepadForMenu(memory, now);
      if (action) actOnMenu(action);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("gamepadconnected", refreshConnection);
      window.removeEventListener("gamepaddisconnected", refreshConnection);
    };
  }, []);

  useEffect(() => {
    legacyRef.current = loadLegacy();
    refresh();
    let dead = false;
    void loadTextures().then((loaded) => {
      if (dead) return;
      setTextures(loaded);
      // preview: a quiet plaza behind the title screen
      show(newNight(legacyRef.current), legacyRef.current.heir.sex);
      const id = new URLSearchParams(location.search).get("replay");
      if (id) void startReplay(id);
      else ask(legacyRef.current.bestiary); // before night 1: what does the sea send?
    });
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
    // a night abandoned by closing the tab is still recorded (outcome null)
    const leave = () => {
      if (phaseRef.current === "night") sendPlay(stateRef.current);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      dead = true;
      window.removeEventListener("pagehide", leave);
    };
  }, [sendPlay, pause, controls, refresh, show, startReplay, ask]);

  // a creature announced for tonight has its sprite loaded ahead of the night; if it will not load, it is not announced
  const announced = tonight.kind === "ready" ? tonight.creature.id : null;
  useEffect(() => {
    if (!announced) return;
    void loadCreatureTextures(announced).then((loaded) => {
      if (!loaded) withdraw(announced);
    });
  }, [announced, withdraw]);

  const startNight = async () => {
    if (starting.current) return;
    starting.current = true;
    // The creature that was ready joins the night if its sprite is loaded by now. If it is still being made, or does
    // not load, the night has none (a finished one is met on a later night).
    const announcedCreature = tonight.kind === "ready" ? tonight.creature : null;
    stop();
    const loaded = announcedCreature
      ? await Promise.race([
          loadCreatureTextures(announcedCreature.id),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), CREATURE_LOAD_TIMEOUT)),
        ])
      : null;
    const creature = announcedCreature && loaded ? announcedCreature : null;
    if (creature) {
      meet(legacyRef.current, creature.id);
      saveLegacy(legacyRef.current);
    }
    const seed = newSeed();
    const state = newNight(legacyRef.current, seed, creature && nightCreature(creature));
    const recorder = new Recorder(legacyRef.current, seed, "", creature && recordedCreatureSchema.parse(creature));
    recorderRef.current = recorder;
    show(
      state,
      legacyRef.current.heir.sex,
      (stepIndex, live, current) => {
        recorder.input(stepIndex, live, current);
        return live;
      },
      creature && loaded,
    );
    starting.current = false;
    pause(false);
    setHud(hudOf(state, legacyRef.current));
    setReport(null);
    phaseRef.current = "night";
    setPhase("night");
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
    clearLegacy();
    legacyRef.current = newLegacy();
    showPreview();
    refresh();
    ask(legacyRef.current.bestiary);
  };
  // the warden behind the title screen is the one chosen
  const showPreview = () => {
    if (stateRef.current) show(stateRef.current, legacyRef.current.heir.sex);
  };
  const chooseSex = (sex: Sex) => {
    const legacy = legacyRef.current;
    if (legacy.heir.sex === sex) return;
    legacy.heir = heirAs(legacy.heir, sex);
    saveLegacy(legacy);
    showPreview();
    refresh();
  };

  const legacy = legacyRef.current;
  const heirLine = `${legacy.heir.name}, ${ordinal(legacy.generation)} Lampwarden · ${TRAITS[legacy.heir.trait].label}`;

  const shop = (
    <div className="shop">
      <div className="oil">
        <Icon name="oil" size={16} /> {legacy.oil} oil
      </div>
      {legacy.offers.length === 0 && <p className="dim">Nothing left to buy. The line is complete.</p>}
      {legacy.offers.map((id) => {
        const cost = upgradeCost(legacy, id);
        return (
          <button
            key={id}
            type="button"
            className="btn up"
            data-upgrade={id}
            disabled={cost === null || legacy.oil < cost}
            onClick={() => purchase(id)}
          >
            <Icon name={id} />
            <div>
              <b>{UPGRADES[id].label}</b>
              <em role="img" aria-label={`level ${legacy.levels[id]} of ${MAX_LEVEL}`}>
                {"●".repeat(legacy.levels[id])}
                {"○".repeat(MAX_LEVEL - legacy.levels[id])}
              </em>
              <span>{UPGRADES[id].text}</span>
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
      <div className="canvas">
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
        {(phase === "night" || phase === "replay") && hud && (
          <>
            <div className="stats">
              <div>
                {legacy.heir.name}
                <span className="long">
                  , {ordinal(legacy.generation)} Lampwarden · {TRAITS[legacy.heir.trait].label}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${(hud.health / hud.maxHealth) * 100}%` }} />
              </div>
              <div className="oilline" role="img" aria-label={`${hud.kills} slain, ${hud.oil} oil`}>
                <Icon name="slain" size={16} /> {hud.kills} <Icon name="oil" size={16} /> {hud.oil}
              </div>
            </div>
            <div className="nightbar">
              <div>
                Night {legacy.night}
                <span className="long"> · the sea is {tideLabel(legacy.tide)}</span>
              </div>
              <div className="bar dawnbar">
                <i style={{ width: `${hud.dawn * 100}%` }} />
              </div>
            </div>
            <div className="lamps">
              <span className="long">Lamps </span>
              {LAMP_SLOTS.slice(0, hud.lamps).map((slot, index) => (
                <span key={slot} className={index < hud.lit ? "lit" : ""}>
                  ◆
                </span>
              ))}
            </div>
            {phase === "night" ? (
              <div className="help">
                {gamepadConnected
                  ? "Left stick move · A strike (the stick turns you) · B or RT shoot (right stick aims) · stand by a dark lamp to relight it"
                  : "WASD move · J strike (hold a direction to turn) · K or click shoot · stand by a dark lamp to relight it"}
              </div>
            ) : (
              <div className="help replaybar">
                REPLAY {replay?.play.id}
                {[1, 2, 4].map((multiplier) => (
                  <button
                    key={multiplier}
                    type="button"
                    className={`btn small ${speed === multiplier ? "on" : ""}`}
                    onClick={() => setSpeed(multiplier)}
                  >
                    {multiplier}×
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "night" && <div className="rotate">Turn your phone sideways for a bigger view</div>}
        {phase === "night" && (
          <TouchControls
            onStick={(horizontal, vertical) => stick(controls, horizontal, vertical)}
            onPress={(action) => press(controls, action, stateRef.current)}
          />
        )}

        {phase === "replayEnd" && replay && (
          <div className="panel">
            <div className="logo small">REPLAY OVER</div>
            <p>
              {replay.play.legacy.heir.name}, night {replay.play.legacy.night}: {replay.play.outcome ?? "abandoned"},{" "}
              {replay.play.stats.kills} slain, {replay.play.stats.lampsLost} lamps snuffed,{" "}
              {replay.play.timeline.length} s.
            </p>
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
          </div>
        )}
        {replayError && (
          <div className="panel">
            <p>Could not load that replay: {replayError}</p>
          </div>
        )}

        {phase === "title" && (
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
                {INTRODUCTION.map((line) => (
                  <p key={line} data-line>
                    {line}
                  </p>
                ))}
              </div>
              <div className="settings" data-line>
                {SETTINGS.map((setting) => (
                  <button
                    key={setting.id}
                    type="button"
                    className={`btn ${setting.id === "greek" ? "on" : ""}`}
                    disabled={!setting.live}
                    title={setting.live ? "" : "Coming soon"}
                  >
                    {setting.label}
                    {setting.live ? "" : " (soon)"}
                  </button>
                ))}
              </div>
              <SeaSends tonight={tonight} onSpriteBroken={withdraw} />
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
                          <Image
                            src={`/sprites/hero/${sex}_idle1.png`}
                            alt=""
                            width={128}
                            height={128}
                            unoptimized
                            className="hero-sprite"
                          />
                        </span>
                        <span className="hero-title">{sex === "male" ? "Son" : "Daughter"}</span>
                        <span>{sex === "male" ? "sword and bow" : "spear and sling"}</span>
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
                  {heirLine}
                </p>
                <p className="dim" data-line>
                  Night {legacy.night}
                  {legacy.bestNight ? ` · best night ${legacy.bestNight}` : ""}
                </p>
                <button type="button" className="btn big" disabled={!ready} onClick={startNight} data-line>
                  {ready ? "Light the lamps" : "Lighting the lamps…"}
                </button>
                {legacy.generation > 1 && (
                  <button type="button" className="btn small" onClick={newLine} data-line>
                    Start a new bloodline
                  </button>
                )}
              </div>
              <p className="privacy dim" data-line>
                Each night you play is recorded anonymously (your inputs, no personal data) so we can balance the game.
              </p>
            </div>
          </TitleScroll>
        )}

        {phase === "dawn" && report && (
          <div className="panel">
            <div className="logo small">DAWN</div>
            <p>
              {report.name} held night {report.night}. {report.kills} slain, {report.lampsLost}{" "}
              {report.lampsLost === 1 ? "lamp" : "lamps"} snuffed.
            </p>
            <p>
              +{report.oil} oil from the slain, +{report.bonus} for the lamps still burning.
            </p>
            <p className="dim">{tideNote(report)}</p>
            {shop}
            <SeaSends tonight={tonight} onSpriteBroken={withdraw} />
            <button type="button" className="btn big" onClick={startNight}>
              Into night {legacy.night}
            </button>
          </div>
        )}

        {phase === "heir" && report && (
          <div className="panel">
            <div className="logo small">{report.outcome === "dark" ? "DARKNESS" : "FALLEN"}</div>
            <p>
              {report.outcome === "dark"
                ? `The lamps of Lychnos went dark on night ${report.night}.`
                : `${report.name} fell on night ${report.night}.`}{" "}
              Their oil passes to the next warden.
            </p>
            <p className="dim">{tideNote(report)}</p>
            <div className="heirs">
              {heirs.map((heir) => (
                <button
                  key={heir.name}
                  type="button"
                  className={`btn heir ${legacy.heir.name === heir.name ? "on" : ""}`}
                  onClick={() => chooseHeir(heir)}
                >
                  <b>{heir.name}</b>
                  <span>{heir.sex === "male" ? "sword and bow" : "spear and sling"}</span>
                  <span>
                    {TRAITS[heir.trait].label}: {TRAITS[heir.trait].text}
                  </span>
                </button>
              ))}
            </div>
            {shop}
            <SeaSends tonight={tonight} onSpriteBroken={withdraw} />
            <button
              type="button"
              className="btn big"
              disabled={!heirs.some((heir) => heir.name === legacy.heir.name)}
              onClick={startNight}
            >
              {heirs.some((heir) => heir.name === legacy.heir.name)
                ? `${legacy.heir.name} takes up the lamp`
                : "Choose an heir"}
            </button>
          </div>
        )}
      </div>
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
  if (action === "primary") {
    primary?.click();
    return;
  }
  if (action === "confirm") {
    (focused ?? primary)?.click();
    return;
  }
  if (!buttons.length) return;
  const index = focused ? buttons.indexOf(focused) : -1;
  const next = action === "next" ? (index + 1) % buttons.length : index <= 0 ? buttons.length - 1 : index - 1;
  buttons[next]?.focus();
  buttons[next]?.scrollIntoView({ block: "nearest" });
}
