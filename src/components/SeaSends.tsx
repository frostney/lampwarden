"use client";
// "Tonight the sea sends…": the creature that will join the coming night, or a note that the sea is still shaping one.
// Shown on the title and on the dawn and heir panels, above the button that starts the night. It is only ever an
// announcement: nothing here has to finish before the night can begin.
import { useEffect, useRef } from "react";
import { type Creature, creatureCodePath, creatureSpritePath, type JobStep } from "@/game/creature";
import { creaturePixels } from "@/scene/creature-render";
import type { Tonight } from "./useTonight";

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
        className="sea"
        data-line
        data-state="ready"
        data-creature={creature.id}
        aria-label="The creature coming tonight"
      >
        <CreaturePortrait creature={creature} onBroken={onSpriteBroken} />
        <div className="sea-text">
          <span className="sea-label">Tonight the sea sends…</span>
          <b className="sea-name">{creature.name}</b>
          <span className="sea-lore">{creature.lore}</span>
        </div>
      </section>
    );
  }
  if (tonight.kind === "generating")
    return (
      <section className="sea" data-line data-state="generating" data-step={tonight.step} aria-live="polite">
        <div className="sea-text">
          <span className="sea-label">The sea is shaping something…</span>
          <span className="sea-lore">{STEP_TEXT[tonight.step]}</span>
          <span className="sea-lore dim">The night can begin without it.</span>
        </div>
      </section>
    );
  return null;
}

// The figure fills only part of its 128 px frame, so the portrait crops the sprite to its opaque pixels and draws them
// at the largest whole multiple that fits the panel, keeping every pixel square.
const PORTRAIT_HEIGHT = 72;
const OPAQUE = 128;

// Crops `frame` (the whole sprite on a canvas) to its opaque pixels onto `canvas`; false when nothing in it is opaque.
function paintPortrait(canvas: HTMLCanvasElement, frame: HTMLCanvasElement): boolean {
  const frameContext = frame.getContext("2d", { willReadFrequently: true });
  const context = canvas.getContext("2d");
  if (!frameContext || !context) return false;
  const { data } = frameContext.getImageData(0, 0, frame.width, frame.height);
  let left = frame.width;
  let top = frame.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++)
      if ((data[(y * frame.width + x) * 4 + 3] ?? 0) >= OPAQUE) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) return false;
  const width = right - left + 1;
  const height = bottom - top + 1;
  const scale = Math.max(1, Math.floor(PORTRAIT_HEIGHT / height));
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(frame, left, top, width, height, 0, 0, width, height);
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  canvas.dataset.scale = String(scale);
  canvas.dataset.loaded = "1";
  return true;
}

// The sprite's pixels on a canvas of their own
function frameFromPixels(pixels: Uint8Array<ArrayBuffer>): HTMLCanvasElement | null {
  const frame = document.createElement("canvas");
  frame.width = 128;
  frame.height = 128;
  const context = frame.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 128, 128), 0, 0);
  return frame;
}

// A creature drawn from its code shows the very pixels the night will use (creature-render.ts hands the same render to the
// scene); one from before code was delivered shows its PNG.
function CreaturePortrait({ creature, onBroken }: { creature: Creature; onBroken: (creatureId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let current = true;
    const broken = () => {
      if (current) onBroken(creature.id);
    };
    const paint = (frame: HTMLCanvasElement | null) => {
      const canvas = canvasRef.current;
      if (!current || !canvas) return;
      if (!frame || !paintPortrait(canvas, frame)) broken();
    };
    if (creature.build) {
      void creaturePixels(creature).then((pixels) => paint(pixels && frameFromPixels(pixels)));
      return () => {
        current = false;
      };
    }
    const image = new window.Image();
    image.onerror = broken;
    image.onload = () => {
      const frame = document.createElement("canvas");
      frame.width = image.naturalWidth;
      frame.height = image.naturalHeight;
      frame.getContext("2d")?.drawImage(image, 0, 0);
      paint(frame);
    };
    image.src = creatureSpritePath(creature.id);
    return () => {
      current = false;
    };
  }, [creature, onBroken]);
  return (
    <canvas
      ref={canvasRef}
      className="sea-sprite"
      data-src={creature.build ? creatureCodePath(creature.id) : creatureSpritePath(creature.id)}
      aria-hidden
    />
  );
}
