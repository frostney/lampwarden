"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_LEVEL, TRAITS, UPGRADES, buy, clearLegacy, heirChoices, loadLegacy, newLegacy, ordinal, saveLegacy, tideLabel, upgradeCost,
  type Heir, type Legacy, type UpgradeId,
} from "@/lib/legacy";
import { createScene, type SceneHandle } from "@/lib/scene";
import { dawnBonus, litCount, newNight, nextTide, type Outcome, type State } from "@/lib/sim";

const SETTINGS = [
  { id: "greek", label: "Lychnos (Greek)", live: true },
  { id: "norse", label: "Norse", live: false },
  { id: "egyptian", label: "Egyptian", live: false },
];

type Phase = "title" | "night" | "dawn" | "heir";
interface Hud { hp: number; maxHp: number; lit: number; lamps: number; kills: number; oil: number; dawn: number }
interface Report { outcome: Outcome; night: number; kills: number; lampsLost: number; oil: number; bonus: number; name: string; tideBefore: number; tideAfter: number }

const hudOf = (s: State, l: Legacy): Hud => ({
  hp: Math.ceil(s.hero.hp), maxHp: s.hero.maxHp, lit: litCount(s), lamps: s.lamps.length, kills: s.stats.kills,
  oil: l.oil + s.oilEarned, dawn: Math.min(1, s.elapsed / s.length),
});
const sameHud = (a: Hud, b: Hud) => a.hp === b.hp && a.lit === b.lit && a.kills === b.kills && a.oil === b.oil && Math.abs(a.dawn - b.dawn) < 0.01;

export default function Game() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const state = useRef<State | null>(null);
  const legacy = useRef<Legacy>(newLegacy());
  const [, rerender] = useState(0);
  const refresh = () => rerender((n) => n + 1);
  const [phase, setPhase] = useState<Phase>("title");
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [heirs, setHeirs] = useState<Heir[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const endNight = useCallback((s: State) => {
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
    scene.current?.setPaused(true);
    setReport(rep);
  }, []);

  useEffect(() => {
    legacy.current = loadLegacy();
    refresh();
    let handle: SceneHandle | null = null, dead = false;
    let last: Hud | null = null;
    createScene(host.current!, (s) => {
      if (phaseRef.current !== "night") return;
      if (s.outcome) { endNight(s); return; }
      const h = hudOf(s, legacy.current);
      if (!last || !sameHud(last, h)) { last = h; setHud(h); }
    }).then((h) => {
      if (dead) { h.destroy(); return; }
      handle = h; scene.current = h;
      // preview: a quiet plaza behind the title screen
      const s = newNight(legacy.current); state.current = s;
      h.setState(s, legacy.current.heir.sex);
      setReady(true);
    });
    (window as unknown as { lampwarden: unknown }).lampwarden = { state: () => state.current, legacy: () => legacy.current };
    return () => { dead = true; handle?.destroy(); scene.current = null; };
  }, [endNight]);

  const startNight = () => {
    const s = newNight(legacy.current);
    state.current = s;
    scene.current?.setState(s, legacy.current.heir.sex);
    scene.current?.setPaused(false);
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
      <div className="oil">Oil: {l.oil}</div>
      {(Object.keys(UPGRADES) as UpgradeId[]).map((id) => {
        const c = upgradeCost(l, id);
        return (
          <button key={id} className="btn up" disabled={c === null || l.oil < c} onClick={() => purchase(id)}>
            <b>{UPGRADES[id].label}</b> {"●".repeat(l.levels[id])}{"○".repeat(MAX_LEVEL - l.levels[id])}
            <span>{UPGRADES[id].text}</span>
            <i>{c === null ? "max" : `${c} oil`}</i>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="stage" data-phase={phase} data-ready={ready ? 1 : 0} data-hp={hud?.hp} data-lit={hud?.lit} data-kills={hud?.kills}>
      <div ref={host} className="canvas" />
      <div className="hud">
        {phase === "night" && hud && (
          <>
            <div className="stats">
              <div>{heirLine}</div>
              <div className="bar"><i style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} /></div>
              <div>Slain {hud.kills} · Oil {hud.oil}</div>
            </div>
            <div className="nightbar">
              <div>Night {l.night} · the sea is {tideLabel(l.tide)}</div>
              <div className="bar dawnbar"><i style={{ width: `${hud.dawn * 100}%` }} /></div>
            </div>
            <div className="lamps">
              Lamps {Array.from({ length: hud.lamps }, (_, i) => <span key={i} className={i < hud.lit ? "lit" : ""}>◆</span>)}
            </div>
            <div className="help">WASD / arrows move · J or Space strike · K or click shoot · stand by a dark lamp to relight it</div>
          </>
        )}

        {phase === "title" && (
          <div className="panel">
            <div className="logo">LAMPWARDEN</div>
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
