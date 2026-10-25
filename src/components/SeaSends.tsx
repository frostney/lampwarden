"use client";
// "Tonight the sea sends…": the creature that will join the coming night, or a note that the sea is still shaping one.
// Shown on the title and on the dawn and heir panels, above the button that starts the night. It is only ever an
// announcement: nothing here has to finish before the night can begin.
import { useEffect, useRef } from "react";

import { creatureSpritePath, type JobStep } from "@/game/creature";
import type { Tonight } from "@/game/sea";

const STEP_TEXT: Record<JobStep, string> = {
  queued: "the tide gathers",
  writing: "it is being dreamed",
  drawing: "its shape is being drawn",
  rendering: "it is taking form",
  judging: "it is being weighed",
  fixing: "its flaws are being mended",
  done: "it is almost here",
  failed: "the tide takes it back",
};

interface SeaSendsProps {
  tonight: Tonight;
  onSpriteBroken: (creatureId: string) => void; // the sprite will not show: the creature is not announced
}

export function SeaSends({ tonight, onSpriteBroken }: SeaSendsProps) {
  if (tonight.kind === "ready") {
    const { creature } = tonight;
    return (
      <section
        aria-label="The creature coming tonight"
        className="sea"
        data-creature={creature.id}
        data-line
        data-state="ready"
      >
        <CreaturePortrait creatureId={creature.id} onBroken={onSpriteBroken} />
        <div className="sea-text">
          <span className="sea-label">Tonight the sea sends…</span>
          <b className="sea-name">{creature.name}</b>
          <span className="sea-lore">{creature.lore}</span>
        </div>
      </section>
    );
  }
  if (tonight.kind === "generating") {
    return (
      <section aria-live="polite" className="sea" data-line data-state="generating" data-step={tonight.step}>
        <div className="sea-text">
          <span className="sea-label">The sea is shaping something…</span>
          <span className="sea-lore">{STEP_TEXT[tonight.step]}</span>
          <span className="sea-lore dim">The night can begin without it.</span>
        </div>
      </section>
    );
  }
  return null;
}

// The figure fills only part of its 128 px frame, so the portrait crops the sprite to its opaque pixels and draws them
// at the largest whole multiple that fits the panel, keeping every pixel square.
const PORTRAIT_HEIGHT = 72;
const OPAQUE = 128;

function CreaturePortrait({ creatureId, onBroken }: { creatureId: string; onBroken: (creatureId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new window.Image();
    let current = true;
    image.onerror = () => {
      if (current) {
        onBroken(creatureId);
      }
    };
    image.onload = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (!current || !canvas || !context) {
        return;
      }
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) >= OPAQUE) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      if (right < 0) {
        onBroken(creatureId);
        return;
      }
      const width = right - left + 1;
      const height = bottom - top + 1;
      const scale = Math.max(1, Math.floor(PORTRAIT_HEIGHT / height));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, left, top, width, height, 0, 0, width, height);
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
      canvas.dataset.scale = String(scale);
      canvas.dataset.loaded = "1";
    };
    image.src = creatureSpritePath(creatureId);
    return () => {
      current = false;
    };
  }, [creatureId, onBroken]);
  return <canvas aria-hidden className="sea-sprite" data-src={creatureSpritePath(creatureId)} ref={canvasRef} />;
}
