"use client";

import { Application } from "@pixi/react";
import type { Application as PixiApp } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeGamepad, newGamepadMemory, pollGamepadForMenu, type MenuAction } from "@/lib/gamepad";
import type { Sex } from "@/lib/assets";
import { newControls, press, release, stick } from "@/lib/controls";
import {
  MAX_LEVEL, TRAITS, UPGRADES, buy, clearLegacy, heirChoices, loadLegacy, newLegacy, ordinal, saveLegacy, tideLabel, upgradeCost,
  type Heir, type Legacy, type UpgradeId,
} from "@/lib/legacy";
import { Icon } from "./Icons";
import { Scene, type Driver, type Night } from "./Scene";
import { TouchControls } from "./TouchControls";
import { Recorder, Replayer, legacyOf, upload, verifyPlay, type Play } from "@/lib/replay";
import { loadTextures, type Tex } from "@/lib/scene";
import { H, W, dawnBonus, litCount, newNight, newSeed, nextTide, type Outcome, type State } from "@/lib/sim";

// the canvas: 960x600 game pixels, scaled by CSS, no smoothing
const APP = { width: W, height: H, background: 0x1e5f8a, antialias: false, roundPixels: true, resolution: 1, autoDensity: false };

const SETTINGS = [
  { id: "greek", label: "Lychnos (Greek)", live: true },
  { id: "norse", label: "Norse", live: false },
  { id: "egyptian", label: "Egyptian", live: false },
];

type Phase = "title" | "night" | "dawn" | "heir" | "replay" | "replayEnd";
interface Hud { hp: number; maxHp: number; lit: number; lamps: number; kills: number; oil: number; dawn: number }
interface Report { outcome: Outcome; night: number; kills: number; lampsLost: number; oil: number; bonus: number; name: string; tideBefore: number; tideAfter: number }

const hudOf = (s: State, l: Legacy): Hud => ({
  hp: Math.ceil(s.hero.hp), maxHp: s.hero.maxHp, lit: litCount(s), lamps: s.lamps.length, kills: s.stats.kills,
  oil: l.oil + s.oilEarned, dawn: Math.min(1, s.elapsed / s.length),
});
const sameHud = (a: Hud, b: Hud) => a.hp === b.hp && a.lit === b.lit && a.kills === b.kills && a.oil === b.oil && Math.abs(a.dawn - b.dawn) < 0.01;

export default function Game() {
  const app = useRef<PixiApp | null>(null);
  const state = useRef<State | null>(null);   // the night on screen, also read outside React (debug hook, pagehide)
  const [tex, setTex] = useState<Tex | null>(null);
  const [night, setNight] = useState<Night | null>(null);
  const [paused, setPaused] = useState(true);
  const [frozenClock, freezeClock] = useState<number | null>(null);
  const [controls] = useState(newControls);
  const lastHud = useRef<Hud | null>(null);
  const legacy = useRef<Legacy>(newLegacy());
  const [, rerender] = useState(0);
  const refresh = () => rerender((n) => n + 1);
  const [phase, setPhase] = useState<Phase>("title");
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [heirs, setHeirs] = useState<Heir[]>([]);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const recorder = useRef<Recorder | null>(null);
  const [replay, setReplay] = useState<{ play: Play; endsMatch: boolean | null; error?: string } | null>(null);
  const [speed, setSpeed] = useState(1);

  // every night is recorded (inputs + timeline) and sent to /api/plays; the last one is also kept locally (?replay=last)
  const sendPlay = useCallback((s: State | null) => {
    const r = recorder.current;
    recorder.current = null;
    if (!r || !s) return;
    const p = r.finish(s);
    try { localStorage.setItem("lampwarden:lastPlay", JSON.stringify(p)); } catch { /* full */ }
    if (!new URLSearchParams(location.search).has("verify")) void upload(p);   // the visual verifier's nights are not real plays
  }, []);

  // pausing also lets go of held keys and the stick
  const pause = useCallback((p: boolean) => { setPaused(p); if (p) release(controls); }, [controls]);

  const endNight = useCallback((s: State) => {
    sendPlay(s);
    const l = legacy.current;
    const outcome = s.outcome!;
    const bonus = outcome === "dawn" ? dawnBonus(s) : 0;
    const tideBefore = l.tide;
    l.oil += s.oilEarned + bonus;
    l.tide = nextTide(l.tide, s);
    const rep: Report = { outcome, night: s.night, kills: s.stats.kills, lampsLost: s.stats.lampsLost, oil: s.oilEarned, bonus, name: l.heir.name, tideBefore, tideAfter: l.tide };
    if (outcome === "dawn") {
      l.bestNight = Math.max(l.bestNight, l.night);
      l.night++;
      phaseRef.current = "dawn";
      setPhase("dawn");
    } else {
      l.fallen.push({ name: l.heir.name, night: l.night, cause: outcome === "dark" ? "the lamps went dark" : "fell in the plaza" });
      l.bestNight = Math.max(l.bestNight, l.night - 1);
      l.generation++;
      l.night = 1;
      setHeirs(heirChoices());
      phaseRef.current = "heir";
      setPhase("heir");
    }
    saveLegacy(l);
    pause(true);
    setReport(rep);
  }, [sendPlay, pause]);

  // every frame, after the sim has stepped: HUD, end of the night, end of a replay
  const onTick = useCallback((s: State) => {
    if (s !== state.current) return;   // a night just replaced and not yet on stage
    const showHud = () => {
      const h = hudOf(s, legacy.current);
      if (!lastHud.current || !sameHud(lastHud.current, h)) { lastHud.current = h; setHud(h); }
    };
    if (phaseRef.current === "replay") {
      if (s.outcome) { phaseRef.current = "replayEnd"; setPhase("replayEnd"); return; }
      showHud();
      return;
    }
    if (phaseRef.current !== "night") return;
    if (s.outcome) { endNight(s); return; }
    showHud();
  }, [endNight]);
  const onReady = useCallback(() => setReady(true), []);
  const onInit = useCallback((a: PixiApp) => { app.current = a; }, []);

  // puts a night on stage
  const show = (s: State, sex: Sex, driver: Driver | null = null) => { state.current = s; setNight({ state: s, sex, driver }); };

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
    legacy.current = loadLegacy();
    refresh();
    let dead = false;
    void loadTextures().then((t) => {
      if (dead) return;
      setTex(t);
      // preview: a quiet plaza behind the title screen
      show(newNight(legacy.current), legacy.current.heir.sex);
      const id = new URLSearchParams(location.search).get("replay");
      if (id) void startReplay(id);
    });
    // debug hook for the visual verifier and recordings
    const scene = {
      setPaused: pause, freezeClock, setSpeed,
      stick: (dx: number, dy: number) => stick(controls, dx, dy),
      press: (k: "melee" | "ranged") => press(controls, k, state.current),
    };
    (window as unknown as { lampwarden: unknown }).lampwarden = { state: () => state.current, legacy: () => legacy.current, scene: () => scene, app: () => app.current };
    // a night abandoned by closing the tab is still recorded (outcome null)
    const leave = () => { if (phaseRef.current === "night") sendPlay(state.current); };
    window.addEventListener("pagehide", leave);
    return () => { dead = true; window.removeEventListener("pagehide", leave); };
  }, [sendPlay, pause, controls]);

  const startReplay = async (id: string) => {
    let play: Play;
    try {
      if (id === "last") play = JSON.parse(localStorage.getItem("lampwarden:lastPlay") || "null");
      else { const r = await fetch(`/api/plays/${encodeURIComponent(id)}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); play = await r.json(); }
      if (!play || play.v !== 1) throw new Error("no recording");
    } catch (e) { setReplay({ play: null as unknown as Play, endsMatch: null, error: String(e) }); return; }
    const l = legacyOf(play);
    legacy.current = { ...legacy.current, ...l };   // shown in the HUD only; never saved
    const s = newNight(l, play.seed);
    const r = new Replayer(play);
    show(s, l.heir.sex, (n) => r.input(n));
    pause(false);
    setReplay({ play, endsMatch: play.outcome ? verifyPlay(play).endsMatch : null });
    setHud(hudOf(s, legacy.current));
    phaseRef.current = "replay";
    setPhase("replay");
  };

  const startNight = () => {
    const seed = newSeed();
    const s = newNight(legacy.current, seed);
    const rec = new Recorder(legacy.current, seed, "");
    recorder.current = rec;
    show(s, legacy.current.heir.sex, (n, live, st) => { rec.input(n, live, st); return live; });
    pause(false);
    setHud(hudOf(s, legacy.current));
    setReport(null);
    phaseRef.current = "night";
    setPhase("night");
  };
  const chooseHeir = (h: Heir) => { legacy.current.heir = h; saveLegacy(legacy.current); refresh(); };
  const purchase = (id: UpgradeId) => { if (buy(legacy.current, id)) { saveLegacy(legacy.current); refresh(); } };
  const newLine = () => { clearLegacy(); legacy.current = newLegacy(); refresh(); };

  const l = legacy.current;
  const heirLine = `${l.heir.name}, ${ordinal(l.generation)} Lampwarden · ${TRAITS[l.heir.trait].label}`;

  const shop = (
    <div className="shop">
      <div className="oil"><Icon name="oil" size={16} /> {l.oil} oil</div>
      {(Object.keys(UPGRADES) as UpgradeId[]).map((id) => {
        const c = upgradeCost(l, id);
        return (
          <button key={id} className="btn up" disabled={c === null || l.oil < c} onClick={() => purchase(id)}>
            <Icon name={id} />
            <div>
              <b>{UPGRADES[id].label}</b> {"●".repeat(l.levels[id])}{"○".repeat(MAX_LEVEL - l.levels[id])}
              <span>{UPGRADES[id].text}</span>
              <i>{c === null ? "max" : `${c} oil`}</i>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="stage" data-phase={phase} data-ready={ready ? 1 : 0} data-hp={hud?.hp} data-lit={hud?.lit} data-kills={hud?.kills}>
      <div className="canvas">
        <Application {...APP} onInit={onInit}>
          {tex && night && (
            <Scene night={night} tex={tex} controls={controls} paused={paused} speed={speed} frozenClock={frozenClock} onTick={onTick} onReady={onReady} />
          )}
        </Application>
      </div>
      <div className="hud">
        {(phase === "night" || phase === "replay") && hud && (
          <>
            <div className="stats">
              <div>{l.heir.name}<span className="long">, {ordinal(l.generation)} Lampwarden · {TRAITS[l.heir.trait].label}</span></div>
              <div className="bar"><i style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} /></div>
              <div className="oilline">Slain {hud.kills} · <Icon name="oil" size={16} /> {hud.oil}</div>
            </div>
            <div className="nightbar">
              <div>Night {l.night}<span className="long"> · the sea is {tideLabel(l.tide)}</span></div>
              <div className="bar dawnbar"><i style={{ width: `${hud.dawn * 100}%` }} /></div>
            </div>
            <div className="lamps">
              <span className="long">Lamps </span>{Array.from({ length: hud.lamps }, (_, i) => <span key={i} className={i < hud.lit ? "lit" : ""}>◆</span>)}
            </div>
            {phase === "night"
              ? <div className="help">{gamepadConnected
                  ? "Left stick move · A strike · B or RT shoot (right stick aims) · stand by a dark lamp to relight it"
                  : "WASD move · J strike · K or click shoot · stand by a dark lamp to relight it"}</div>
              : <div className="help replaybar">
                  REPLAY {replay?.play.id}
                  {[1, 2, 4].map((x) => (
                    <button key={x} className={`btn small ${speed === x ? "on" : ""}`} onClick={() => setSpeed(x)}>{x}×</button>
                  ))}
                </div>}
          </>
        )}

        {phase === "night" && <div className="rotate">Turn your phone sideways for a bigger view</div>}
        {phase === "night" && <TouchControls onStick={(x, y) => stick(controls, x, y)} onPress={(k) => press(controls, k, state.current)} />}

        {phase === "replayEnd" && replay && (
          <div className="panel">
            <div className="logo small">REPLAY OVER</div>
            <p>{replay.play.legacy.heir.name}, night {replay.play.legacy.night}: {replay.play.outcome ?? "abandoned"}, {replay.play.stats.kills} slain, {replay.play.stats.lampsLost} lamps snuffed, {replay.play.timeline.length} s.</p>
            <p className="dim">{replay.endsMatch === null ? "Abandoned night: no end to compare." : replay.endsMatch ? "Replay ends exactly where the live night ended." : "Replay diverged from the live night."}</p>
            <button className="btn big" onClick={() => void startReplay(new URLSearchParams(location.search).get("replay") || "last")}>Watch again</button>
          </div>
        )}
        {replay?.error && <div className="panel"><p>Could not load that replay: {replay.error}</p></div>}

        {phase === "title" && (
          <div className="panel">
            <h1 className="brand"><img src="/logo/logo.png" alt="Lampwarden" width={68} height={45} /></h1>
            <p>Every night the sea sends its creatures to put out the lamps of Lychnos. Keep one burning until dawn.</p>
            <div className="settings">
              {SETTINGS.map((s) => (
                <button key={s.id} className={`btn ${s.id === "greek" ? "on" : ""}`} disabled={!s.live} title={s.live ? "" : "Coming soon"}>
                  {s.label}{s.live ? "" : " (soon)"}
                </button>
              ))}
            </div>
            <p className="dim">{heirLine} · night {l.night}{l.bestNight ? ` · best night ${l.bestNight}` : ""}</p>
            <button className="btn big" disabled={!ready} onClick={startNight}>{ready ? "Light the lamps" : "Lighting the lamps…"}</button>
            {l.generation > 1 && <button className="btn small" onClick={newLine}>Start a new bloodline</button>}
            <p className="dim tiny">Each night you play is recorded anonymously (your inputs, no personal data) so we can balance the game.</p>
          </div>
        )}

        {phase === "dawn" && report && (
          <div className="panel">
            <div className="logo small">DAWN</div>
            <p>{report.name} held night {report.night}. {report.kills} slain, {report.lampsLost} {report.lampsLost === 1 ? "lamp" : "lamps"} snuffed.</p>
            <p>+{report.oil} oil from the slain, +{report.bonus} for the lamps still burning.</p>
            <p className="dim">{tideNote(report)}</p>
            {shop}
            <button className="btn big" onClick={startNight}>Into night {l.night}</button>
          </div>
        )}

        {phase === "heir" && report && (
          <div className="panel">
            <div className="logo small">{report.outcome === "dark" ? "DARKNESS" : "FALLEN"}</div>
            <p>{report.outcome === "dark" ? `The lamps of Lychnos went dark on night ${report.night}.` : `${report.name} fell on night ${report.night}.`} Their oil passes to the next warden.</p>
            <p className="dim">{tideNote(report)}</p>
            <div className="heirs">
              {heirs.map((h) => (
                <button key={h.name} className={`btn heir ${l.heir.name === h.name ? "on" : ""}`} onClick={() => chooseHeir(h)}>
                  <b>{h.name}</b>
                  <span>{h.sex === "male" ? "sword and bow" : "spear and sling"}</span>
                  <span>{TRAITS[h.trait].label}: {TRAITS[h.trait].text}</span>
                </button>
              ))}
            </div>
            {shop}
            <button className="btn big" disabled={!heirs.some((h) => h.name === l.heir.name)} onClick={startNight}>
              {heirs.some((h) => h.name === l.heir.name) ? `${l.heir.name} takes up the lamp` : "Choose an heir"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function tideNote(r: Report) {
  if (r.tideAfter > r.tideBefore) return `The sea noticed. It is ${tideLabel(r.tideAfter)} now.`;
  if (r.tideAfter < r.tideBefore) return `The sea draws back. It is ${tideLabel(r.tideAfter)} now.`;
  return `The sea stays ${tideLabel(r.tideAfter)}.`;
}

// Moves focus between the menu's buttons, or presses one, for a gamepad.
function actOnMenu(action: MenuAction) {
  document.body.dataset.input = "gamepad";   // shows the focus ring on gamepad-focused buttons
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".panel button:not([disabled])")];
  const primary = document.querySelector<HTMLButtonElement>(".panel .btn.big:not([disabled])");
  const focused = document.activeElement instanceof HTMLButtonElement && buttons.includes(document.activeElement) ? document.activeElement : null;
  if (action === "primary") { primary?.click(); return; }
  if (action === "confirm") { (focused ?? primary)?.click(); return; }
  if (!buttons.length) return;
  const index = focused ? buttons.indexOf(focused) : -1;
  const next = action === "next" ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
  buttons[next]?.focus();
  buttons[next]?.scrollIntoView({ block: "nearest" });
}
