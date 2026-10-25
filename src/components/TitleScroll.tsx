"use client";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// The title screen's scroll: a parchment between two rollers, painted from code (src/scene/scroll.ts) at 1x and shown at
// a whole multiple. It starts rolled up; the bottom roller travels down, turning, to reveal the parchment, then every
// [data-line] element of the contents is inked in, one after another. A click or tap, Enter or Space (not a held key's
// repeats), or a gamepad press (actOnMenu clicks the scroll) completes it at once and does nothing else. With ?verify=1
// (the visual verifier) or prefers-reduced-motion it is unrolled from the start.
import { band } from "@/lib/band";
import { paintParchment, paintRoller, ROLLER_HEIGHT, ROLLER_OVERHANG, ROLLER_SHADOW } from "@/scene/scroll";

type Stage = "unrolling" | "writing" | "done";

const UNROLL_DELAY = 250; // ms rolled up before the roller starts down
const UNROLL_DURATION = 2000;
const LINE_GAP = 110; // ms between the lines being inked in
const INK_DURATION = 320; // keep in step with the ink-in animation in globals.css
const MAX_ART_WIDTH = { 1: 400, 2: 360, 3: 270 };

interface ScrollSize {
  scale: 1 | 2 | 3; // screen pixels per art pixel
  width: number; // parchment width in art pixels
}

// the screen px of room from which the art is drawn at twice and three times its size
const SCALE_FROM = { double: 260, triple: 880 };
const LARGEST_SCALE = 3;

const instantly = () =>
  new URLSearchParams(location.search).has("verify") || matchMedia("(prefers-reduced-motion: reduce)").matches;
// eases in and out on a cubic: slow to start, quick through the middle, slow to stop
const CUBIC = 3;
const HALFWAY = 0.5;
const easeInOut = (fraction: number) =>
  fraction < HALFWAY ? (2 * fraction) ** CUBIC / 2 : 1 - (2 - 2 * fraction) ** CUBIC / 2;

function paint(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  draw: (pixels: Uint8ClampedArray) => void,
) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context || width <= 0 || height <= 0) {
    return;
  }
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  const image = context.createImageData(width, height);
  draw(image.data);
  context.putImageData(image, 0, 0);
}

export function TitleScroll({ children }: { children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const parchmentRef = useRef<HTMLCanvasElement>(null);
  const topRollerRef = useRef<HTMLCanvasElement>(null);
  const bottomRollerRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>(() => (instantly() ? "done" : "unrolling"));
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [size, setSize] = useState<ScrollSize | null>(null);
  const finish = useCallback(() => setStage("done"), []);

  // the scale and parchment width from the room the panel gives: most of its width, at a whole multiple
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(panel);
      const room = panel.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const scale = band<1 | 2 | 3>(
        room,
        [
          [SCALE_FROM.double, 1],
          [SCALE_FROM.triple, 2],
        ],
        LARGEST_SCALE,
      );
      const width = Math.min(MAX_ART_WIDTH[scale], Math.floor(room / scale) - 2 * ROLLER_OVERHANG);
      setSize((previous) => (previous?.scale === scale && previous.width === width ? previous : { scale, width }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // CSS reads the scale for padding, the logo and the hero portraits; the rollers are painted once per size
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!size || !scroll) {
      return;
    }
    scroll.style.setProperty("--scale", String(size.scale));
    scroll.style.setProperty("--portrait", String(size.scale >= LARGEST_SCALE ? 2 : 1));
    const rollerWidth = size.width + 2 * ROLLER_OVERHANG;
    const rollerHeight = ROLLER_HEIGHT + ROLLER_SHADOW;
    paint(topRollerRef.current, rollerWidth, rollerHeight, (pixels) => paintRoller(pixels, rollerWidth, 0, true));
    paint(bottomRollerRef.current, rollerWidth, rollerHeight, (pixels) => paintRoller(pixels, rollerWidth, 0, false));
  }, [size]);

  // the parchment is as tall as the contents (it scrolls with them when they don't fit)
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!size || !content) {
      return;
    }
    let paintedHeight = 0;
    const repaint = () => {
      const height = Math.ceil(content.offsetHeight / size.scale);
      if (height === paintedHeight) {
        return;
      }
      paintedHeight = height;
      paint(parchmentRef.current, size.width, height, (pixels) => paintParchment(pixels, size.width, height));
    };
    repaint();
    const observer = new ResizeObserver(repaint);
    observer.observe(content);
    return () => observer.disconnect();
  }, [size]);

  // number the lines in reading order for the ink-in delays
  useLayoutEffect(() => {
    const lines = contentRef.current?.querySelectorAll<HTMLElement>("[data-line]") ?? [];
    for (const [index, line] of [...lines].entries()) {
      line.style.setProperty("--line", String(index));
    }
  });

  // unrolling: the parchment window grows from nothing to its full height, in whole art pixels, and the bottom roller
  // turns as it goes. The room still to unroll is kept as a margin under the scroll, so the top roller stays put. The
  // first step runs before the first paint.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const windowElement = windowRef.current;
    if (stage !== "unrolling" || !size || !scroll || !windowElement) {
      return;
    }
    const rollerWidth = size.width + 2 * ROLLER_OVERHANG;
    const start = performance.now() + UNROLL_DELAY;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / UNROLL_DURATION));
      windowElement.style.maxHeight = "none";
      scroll.style.marginBottom = "";
      const full = windowElement.getBoundingClientRect().height;
      const shown = Math.min(full, Math.round((easeInOut(progress) * full) / size.scale) * size.scale);
      windowElement.style.maxHeight = `${shown}px`;
      scroll.style.marginBottom = `${full - shown}px`;
      paint(bottomRollerRef.current, rollerWidth, ROLLER_HEIGHT + ROLLER_SHADOW, (pixels) =>
        paintRoller(pixels, rollerWidth, shown / size.scale, false),
      );
      if (progress >= 1) {
        setStage("writing");
      } else {
        frame = requestAnimationFrame(step);
      }
    };
    step(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      windowElement.style.maxHeight = "";
      scroll.style.marginBottom = "";
    };
  }, [stage, size]);

  // writing: the lines ink in by CSS; done once the last has
  useEffect(() => {
    if (stage !== "writing") {
      return;
    }
    const lines = contentRef.current?.querySelectorAll("[data-line]").length ?? 0;
    const timer = setTimeout(finish, lines * LINE_GAP + INK_DURATION);
    return () => clearTimeout(timer);
  }, [stage, finish]);

  // Enter or Space while it unrolls completes it, and reaches nothing else
  useEffect(() => {
    if (stage === "done") {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      // a key still held from the opening scene's Skip repeats: it reaches nothing, and does not complete the unroll
      if (!event.repeat) {
        finish();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [stage, finish]);

  const rollerStyle = size && {
    width: (size.width + 2 * ROLLER_OVERHANG) * size.scale,
    height: (ROLLER_HEIGHT + ROLLER_SHADOW) * size.scale,
  };
  return (
    <div
      className="panel title"
      onClickCapture={(event) => {
        if (stageRef.current === "done") {
          return;
        }
        // a press during the animation completes it and is not passed on to a button
        event.stopPropagation();
        event.preventDefault();
        finish();
      }}
      ref={panelRef}
    >
      <div className="scroll" data-stage={stage} hidden={!size} ref={scrollRef}>
        <canvas className="roller top" ref={topRollerRef} style={rollerStyle ?? undefined} />
        <div className="scroll-window" ref={windowRef} style={size ? { width: size.width * size.scale } : undefined}>
          <div className="scroll-body">
            <div className="scroll-sheet">
              <canvas className="parchment" ref={parchmentRef} />
              <div className="scroll-content" ref={contentRef}>
                {children}
              </div>
            </div>
          </div>
        </div>
        <canvas className="roller bottom" ref={bottomRollerRef} style={rollerStyle ?? undefined} />
      </div>
    </div>
  );
}
