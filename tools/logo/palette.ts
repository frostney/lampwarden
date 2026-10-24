// The logo's colours: the bronze ramp of the lamp, its flame, the night sky, and the glow ramp around the flame.
import { hexColour, type GlowRing, type GridColours, type Rgba } from "./image";

export const colours = {
  outline: hexColour("#1a0f0d"),
  bronzeShadow: hexColour("#371f12"),
  bronzeDeep: hexColour("#593216"),
  bronzeLow: hexColour("#7f4b1c"),
  bronzeMid: hexColour("#a36824"),
  bronze: hexColour("#c58632"),
  bronzeLight: hexColour("#dea74e"),
  bronzeHighlight: hexColour("#f2ca7a"),
  paleGold: hexColour("#fff0b0"),
  brandGold: hexColour("#f2c14e"),
  flameCore: hexColour("#fff3a6"),
  flameYellow: hexColour("#ffca61"),
  flameOrange: hexColour("#faa12b"),
  flameEmber: hexColour("#ec7519"),
  night: hexColour("#0b1424"),
  cream: hexColour("#f4ecd8"),
} satisfies Record<string, Rgba>;

/** The characters used in the pixel grids of pixel-art.ts. */
export const gridColours: GridColours = {
  K: colours.outline,
  k: colours.bronzeShadow,
  d: colours.bronzeDeep,
  m: colours.bronzeLow,
  b: colours.bronzeMid,
  B: colours.bronze,
  G: colours.bronzeLight,
  H: colours.bronzeHighlight,
  W: colours.paleGold,
  Y: colours.flameCore,
  y: colours.flameYellow,
  F: colours.flameOrange,
  O: colours.flameEmber,
};

/** Top-to-bottom row colours of the wordmark (rows past the end repeat the last). */
export const wordmarkRows: readonly Rgba[] = [
  colours.paleGold,
  colours.bronzeHighlight,
  colours.bronzeHighlight,
  colours.brandGold,
  colours.brandGold,
  colours.brandGold,
  colours.bronzeLight,
  colours.bronze,
  colours.bronze,
];

// Each glow ring is a translucent colour solved so that, over the night colour, it lands exactly on a step of a
// hue-shifted night ramp (outermost first). Over any other background the rings stay translucent.
const glowRamp: readonly { readonly target: string; readonly opacity: number }[] = [
  { target: "#131c3a", opacity: 0.25 },
  { target: "#1e2046", opacity: 0.35 },
  { target: "#2f2549", opacity: 0.45 },
  { target: "#45294a", opacity: 0.55 },
];

const glowColours: readonly Rgba[] = glowRamp.map(({ target, opacity }) => {
  const targetColour = hexColour(target);
  const channel = (index: number): number =>
    Math.max(0, Math.min(255, Math.round((targetColour[index] - (1 - opacity) * colours.night[index]) / opacity)));
  return [channel(0), channel(1), channel(2), Math.round(opacity * 255)];
});

/** Glow rings for the given radii (largest first); the innermost ring always takes the strongest ramp step. */
export function glowRings(radii: readonly number[]): GlowRing[] {
  return radii.map((radius, index) => ({ radius, colour: glowColours[index + glowColours.length - radii.length] }));
}

export const stars: Readonly<Record<"bright" | "dim" | "blue", Rgba>> = {
  bright: [244, 236, 216, 255],
  dim: [244, 236, 216, 120],
  blue: [140, 160, 210, 90],
};
