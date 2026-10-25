"use client";

// The practice night's lesson, at the top of the screen in place of the night bar: which lesson of how many, what to do,
// the control that does it for the input in use (drawn as on the title's How to play), and Skip (or a pad's Start),
// which goes straight to the real night. The lessons themselves are staged by src/game/practice.ts.
import { ControlGlyphs, type ControlsKind, useControlsKind } from "@/components/HowToPlay";
import { LESSONS, type Lesson, lessonNumber } from "@/game/practice";
import type { Sex } from "@/scene/assets";

interface LessonText {
  heading: string;
  text: string;
  control?: "move" | "strike" | "shoot";
  hint?: Record<ControlsKind, string>;
  note?: string; // a line under the text, for a lesson with no control to show
}

// each line is short enough to sit on one line of the card on a desktop stage, so the card stays clear of the back lamp
const TEXTS: Record<Exclude<Lesson, "done">, LessonText> = {
  move: {
    heading: "Walk",
    text: "Walk across the plaza.",
    control: "move",
    hint: { keyboard: "The arrow keys walk too.", gamepad: "The d-pad walks too.", touch: "Hold the stick." },
  },
  strike: {
    heading: "Strike",
    text: "A satyr is going for a lamp. Walk up to it and strike.",
    control: "strike",
    hint: {
      keyboard: "Your swing hits what's in front: hold a direction to turn.",
      gamepad: "Your swing hits what's in front: the stick turns you.",
      touch: "Your swing hits what's in front: the stick turns you.",
    },
  },
  shoot: {
    heading: "Shoot",
    text: "A harpy flies at the lamps. Shoot it before it gets there.",
    control: "shoot",
    hint: {
      keyboard: "K shoots the way you face; a click, at the cursor.",
      gamepad: "The right stick aims, or you shoot the way you face.",
      touch: "A shot flies at the nearest monster.",
    },
  },
  relight: {
    heading: "Relight",
    text: "The sea put a lamp out. Stand by it until it burns again.",
  },
  hold: {
    heading: "Hold the plaza",
    text: "Here they come. Keep the lamps lit until the wave is gone.",
    note: "On a real night you lose when every lamp goes dark or you fall.",
  },
};

export function PracticeCard({
  lesson,
  gamepadConnected,
  sex,
  skipping,
  onSkip,
}: {
  lesson: Lesson;
  gamepadConnected: boolean;
  sex: Sex;
  skipping: boolean; // the real night is being put together
  onSkip: () => void;
}) {
  const kind = useControlsKind(gamepadConnected);
  if (lesson === "done") return null;
  const { heading, text, control, hint, note } = TEXTS[lesson];
  return (
    <section className="practice" data-lesson={lesson} aria-label="Practice">
      <div className="practice-top">
        <h2 className="practice-heading">{heading}</h2>
        <span className="practice-step">
          <span className="long">Practice </span>
          {lessonNumber(lesson)} of {LESSONS.length}
        </span>
        {/* the pad's Start presses it (Game's gamepad poll) */}
        <button type="button" className="btn small practice-skip" disabled={skipping} onClick={onSkip}>
          {kind === "gamepad" ? "Start: skip practice" : "Skip practice"}
        </button>
      </div>
      {/* one live region: each lesson's words are read out as it begins */}
      <p aria-live="polite">
        <span className="practice-words" key={lesson}>
          {text}
        </span>
      </p>
      {control && (
        <div className="practice-control">
          <ControlGlyphs control={control} kind={kind} sex={sex} />
          {hint && <span>{hint[kind]}</span>}
        </div>
      )}
      {note && <p className="practice-note">{note}</p>}
    </section>
  );
}
