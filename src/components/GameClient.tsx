"use client";

import dynamic from "next/dynamic";

import { DEFINITION, ORIGIN_NOTE, PLAY_NOTE, SITE_NAME } from "@/lib/site";

// Pixi needs a browser (WebGL/canvas), so the game is never server-rendered. What is sent instead is this fallback, so the
// HTML a crawler that runs no script reads says what the game is. It is visible text, and the title screen replaces it
// (the title screen has its own <h1>, so a page never holds two).
const Game = dynamic(() => import("@/components/Game").then((module) => module.Game), {
  ssr: false,
  loading: () => (
    <div className="loading">
      <h1>{SITE_NAME}</h1>
      <p className="loading-copy">{DEFINITION}</p>
      <p className="loading-copy">{PLAY_NOTE}</p>
      <p className="loading-copy">{ORIGIN_NOTE}</p>
      <p className="loading-copy">Lighting the lamps…</p>
    </div>
  ),
});

export function GameClient() {
  return <Game />;
}
