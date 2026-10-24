"use client";
// "Tonight the sea sends…": the creature that will join the coming night, or a note that the sea is still shaping one.
// Shown on the title and on the dawn and heir panels, above the button that starts the night. It is only ever an
// announcement: nothing here has to finish before the night can begin.
import Image from "next/image";
import { creatureSpritePath, type JobStep } from "@/game/creature";
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
        <Image
          src={creatureSpritePath(creature.id)}
          alt=""
          width={128}
          height={128}
          unoptimized
          className="sea-sprite"
          onError={() => onSpriteBroken(creature.id)}
        />
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
