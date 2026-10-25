"use client";

// The opening scene's frame over the canvas: bars above and below the plaza, the line being told inked into the lower
// one, and Skip. The scene itself is the staged night on the canvas (src/game/opening.ts). Skip, Escape, Enter or Space,
// or the pad's A or Start (actOnMenu presses Skip) end it at once and bring the title.
import { useEffect } from "react";

import { OPENING_LINES } from "@/game/opening";

export function Opening({ line, onEnd }: { line: number; onEnd: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // a held key's repeats are not presses: they would carry on into the title once the opening has gone
      if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ") {
        return;
      }
      if (event.repeat) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onEnd();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onEnd]);
  return (
    <div className="opening" data-opening={line}>
      <div className="letterbox top" />
      <div className="letterbox bottom">
        {/* one live region reads the lines out; each is a new element in it, so it inks in from the start */}
        <p aria-live="polite" className="opening-line">
          <span key={line}>{OPENING_LINES[line]}</span>
        </p>
      </div>
      <button className="btn small opening-skip" onClick={onEnd} type="button">
        Skip
      </button>
    </div>
  );
}
