// Lays out the logo (the oil-lamp emblem stacked over the wordmark) and everything derived from it: favicons, the
// Apple touch icon and the social card.
import { drawGrid, extrude, glow, gridImage, outline, pad, PixelImage, textImage } from "./image";
import { colours, glowRings, gridColours, stars, wordmarkRows } from "./palette";
import { oilLamp, oilLampFavicon } from "./pixel-art";
import type { TextMask } from "./glyphs";

/** The emblem with its outline: 31 x 24. */
const emblem = outline(pad(gridImage(oilLamp, gridColours), 1), colours.outline);

/** Where the flame sits inside `emblem`, in emblem pixels. */
const flameCentre = { x: 1 + 24.5, y: 1 + 6 };

/** The emblem centred over the wordmark, optionally with the glow behind the flame, trimmed to its pixels. */
export function logo(wordmark: TextMask, withGlow: boolean): PixelImage {
  const word = outline(pad(extrude(textImage(wordmark, wordmarkRows), colours.bronzeLow), 1), colours.outline);
  const margin = 16;
  const width = Math.max(emblem.width, word.width) + 2 * margin;
  const height = margin + emblem.height + 1 + word.height + 2;
  const emblemLeft = Math.floor((width - emblem.width) / 2) + 2;
  const emblemTop = margin;
  const canvas = new PixelImage(width, height);
  if (withGlow) {
    canvas.draw(glow(width, height, emblemLeft + flameCentre.x, emblemTop + flameCentre.y,glowRings([15, 11, 8, 5])), 0, 0);
  }
  canvas.draw(emblem, emblemLeft, emblemTop);
  canvas.draw(word, Math.floor((width - word.width) / 2), emblemTop + emblem.height + 1);
  return canvas.trim();
}

/** The hand-drawn 16 x 16 lamp on the night colour, with a small glow. */
export function favicon16(): PixelImage {
  const icon = new PixelImage(16, 16, colours.night);
  icon.draw(glow(16, 16, 11.5, 5.5, glowRings([6, 4])), 0, 0);
  return drawGrid(icon, oilLampFavicon, gridColours);
}

/** The emblem centred on a night square at an integer scale, with glow rings (radii in emblem pixels) on the flame. */
function emblemIcon(size: number, scale: number, glowRadii: readonly number[]): PixelImage {
  const icon = new PixelImage(size, size, colours.night);
  const left = Math.floor((size - emblem.width * scale) / 2);
  const top = Math.floor((size - emblem.height * scale) / 2);
  const glowSize = Math.ceil(size / scale) + 2;
  icon.draw(glow(glowSize, glowSize, flameCentre.x + left / scale, flameCentre.y + top / scale, glowRings(glowRadii)), 0, 0, scale);
  return icon.draw(emblem, left, top, scale);
}

export const favicon32 = (): PixelImage => emblemIcon(32, 1, [11, 8, 5]);
export const appleTouchIcon = (): PixelImage => emblemIcon(180, 5, [15, 11, 8, 5]);

/** 1200 x 630 social card: the logo at the largest integer scale that fits, the tagline under it, and stars. */
export function socialCard(logoImage: PixelImage, tagline: TextMask): PixelImage {
  const cardWidth = 1200, cardHeight = 630;
  const card = new PixelImage(cardWidth, cardHeight, colours.night);
  const taglineImage = textImage(tagline, [colours.cream]);
  const logoScale = Math.max(1, Math.min(Math.floor((cardWidth * 0.72) / logoImage.width), Math.floor((cardHeight * 0.6) / logoImage.height)));
  const taglineScale = Math.max(3, Math.floor(logoScale / 2));
  const gap = taglineScale * 9;
  const blockHeight = logoImage.height * logoScale + gap + taglineImage.height * taglineScale;
  const logoLeft = Math.floor((cardWidth - logoImage.width * logoScale) / 2);
  const logoTop = Math.floor((cardHeight - blockHeight) / 2);

  // Stars from a fixed-seed Park-Miller generator, snapped to the tagline's pixel grid and kept clear of the text.
  let seed = 11;
  const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const clearance = 4 * taglineScale;
  for (let index = 0; index < 60; index++) {
    const x = Math.floor((random() * cardWidth) / taglineScale) * taglineScale;
    const y = Math.floor((random() * cardHeight) / taglineScale) * taglineScale;
    const brightness = random();
    const insideX = x > logoLeft - clearance && x < logoLeft + logoImage.width * logoScale + clearance;
    const insideY = y > logoTop - clearance && y < logoTop + blockHeight + clearance;
    if (insideX && insideY) continue;
    const colour = brightness < 0.25 ? stars.bright : brightness < 0.6 ? stars.dim : stars.blue;
    for (let offsetY = 0; offsetY < taglineScale; offsetY++) {
      for (let offsetX = 0; offsetX < taglineScale; offsetX++) card.blendOver(x + offsetX, y + offsetY, colour);
    }
  }

  card.draw(logoImage, logoLeft, logoTop, logoScale);
  const taglineLeft = Math.floor((cardWidth - taglineImage.width * taglineScale) / 2);
  return card.draw(taglineImage, taglineLeft, logoTop + logoImage.height * logoScale + gap, taglineScale);
}
