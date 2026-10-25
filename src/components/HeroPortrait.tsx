"use client";

import { useEffect, useRef } from "react";

import { MILLISECONDS_PER_SECOND } from "@/lib/units";
import {
  FRAMES,
  FRAMES_PER_SECOND,
  HERO_FRAME_SIZE,
  type HeroAnimation,
  heroAtlasCell,
  heroAtlasKey,
  type Sex,
} from "@/scene/assets";
import type { TextureMap } from "@/scene/layers";
import { PORTRAIT, portraitShift } from "@/scene/portrait";

// The hero choice card's warden, facing the player, drawn from the atlas the scene has already loaded (the same picture,
// so it is downloaded once), a pixel for a pixel, scaled with the card by CSS. He stands at rest; when his card is chosen
// (`strike` changes to a new number) he swings once, the melee frames at the game's own pace, and is at rest again.
// Every frame is drawn at the same offset, the one that puts his resting body in the middle, so he does not jitter.
export function HeroPortrait({
  sex,
  textures,
  strike,
}: {
  sex: Sex;
  textures: TextureMap | null;
  strike: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // a card chosen before this one was drawn again (the title shown anew after a night) does not swing on its own
  const chosenBefore = useRef(strike);
  const swing = strike !== null && strike !== chosenBefore.current ? strike : null; // which choice to swing for
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    const picture = textures?.[heroAtlasKey(sex)]?.source.resource;
    if (!context || !(picture instanceof ImageBitmap || picture instanceof HTMLImageElement)) {
      return;
    }
    const resting = heroAtlasCell("idle", 0, "s");
    const shift = shiftOfBody(picture, resting);
    const draw = (animation: HeroAnimation, frame: number) => {
      const cell = heroAtlasCell(animation, frame, "s");
      context.clearRect(0, 0, PORTRAIT.width, PORTRAIT.height);
      context.drawImage(
        picture,
        cell.x,
        cell.y,
        HERO_FRAME_SIZE,
        HERO_FRAME_SIZE,
        shift,
        -PORTRAIT.top,
        HERO_FRAME_SIZE,
        HERO_FRAME_SIZE,
      );
    };
    draw("idle", 0);
    // with reduced motion the warden is only ever shown at rest
    if (swing === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    draw("melee", 0);
    let shown = 0;
    let began: number | null = null;
    let handle = 0;
    const step = (now: number) => {
      began ??= now;
      const frame = Math.floor(((now - began) * FRAMES_PER_SECOND.melee) / MILLISECONDS_PER_SECOND);
      if (frame >= FRAMES.melee) {
        draw("idle", 0);
        return;
      }
      if (frame !== shown) {
        draw("melee", frame);
        shown = frame;
      }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [sex, textures, swing]);
  return <canvas className="hero-sprite" height={PORTRAIT.height} ref={canvas} width={PORTRAIT.width} />;
}

// the offset that centres the solid body of the frame in `cell` in the portrait, read once for each picture (0 when the
// browser will not give up its pixels, which leaves the frame as the atlas has it)
const shifts = new WeakMap<ImageBitmap | HTMLImageElement, number>();
function shiftOfBody(picture: ImageBitmap | HTMLImageElement, cell: { x: number; y: number }) {
  const known = shifts.get(picture);
  if (known !== undefined) {
    return known;
  }
  const reader = document.createElement("canvas");
  reader.width = HERO_FRAME_SIZE;
  reader.height = HERO_FRAME_SIZE;
  const context = reader.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return 0;
  }
  context.drawImage(picture, cell.x, cell.y, HERO_FRAME_SIZE, HERO_FRAME_SIZE, 0, 0, HERO_FRAME_SIZE, HERO_FRAME_SIZE);
  const { data } = context.getImageData(0, 0, HERO_FRAME_SIZE, HERO_FRAME_SIZE);
  const shift = portraitShift(data, HERO_FRAME_SIZE, HERO_FRAME_SIZE);
  shifts.set(picture, shift);
  return shift;
}
