"use client";

import dynamic from "next/dynamic";

// Pixi needs a browser (WebGL/canvas), so the game is never server-rendered.
const Game = dynamic(() => import("@/components/Game").then((module) => module.Game), {
  ssr: false,
  loading: () => <p>Lighting the lamps…</p>,
});

export function GameClient() {
  return <Game />;
}
