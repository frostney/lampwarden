// RGBA pixel images and the drawing operations the logo is built from: character grids, outlines, stepped glow
// rings, one-pixel extrusion, text masks, nearest-neighbour scaling and a run-length SVG export.

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

const transparent: Rgba = [0, 0, 0, 0];

export function hexColour(hex: string): Rgba {
  const digits = hex.replace("#", "");
  return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), 255];
}

export class PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, fill?: Rgba) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    if (fill) for (let index = 0; index < width * height; index++) this.data.set(fill, index * 4);
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    if (!this.contains(x, y)) return transparent;
    const offset = (y * this.width + x) * 4;
    const [red = 0, green = 0, blue = 0, alpha = 0] = this.data.subarray(offset, offset + 4);
    return [red, green, blue, alpha];
  }

  alpha(x: number, y: number): number {
    return this.contains(x, y) ? (this.data[(y * this.width + x) * 4 + 3] ?? 0) : 0;
  }

  set(x: number, y: number, colour: Rgba): void {
    if (this.contains(x, y)) this.data.set(colour, (y * this.width + x) * 4);
  }

  /** Source-over blend of one pixel, rounded to 8 bits per channel. */
  blendOver(x: number, y: number, colour: Rgba): void {
    if (!this.contains(x, y)) return;
    const destination = this.get(x, y);
    const sourceAlpha = colour[3] / 255;
    const destinationAlpha = destination[3] / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) return;
    const channel = (index: 0 | 1 | 2): number =>
      Math.round(
        (colour[index] * sourceAlpha + destination[index] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
      );
    this.set(x, y, [channel(0), channel(1), channel(2), Math.round(outputAlpha * 255)]);
  }

  /** Blends `source` over this image at (left, top), each source pixel drawn as a `scale` x `scale` block. */
  draw(source: PixelImage, left: number, top: number, scale = 1): this {
    for (let y = 0; y < source.height * scale; y++) {
      for (let x = 0; x < source.width * scale; x++) {
        const colour = source.get(Math.floor(x / scale), Math.floor(y / scale));
        if (colour[3]) this.blendOver(left + x, top + y, colour);
      }
    }
    return this;
  }

  clone(): PixelImage {
    const copy = new PixelImage(this.width, this.height);
    copy.data.set(this.data);
    return copy;
  }

  /** Crops to the bounding box of the pixels with non-zero alpha. */
  trim(): PixelImage {
    let left = Infinity,
      top = Infinity,
      right = -1,
      bottom = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.alpha(x, y)) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    const cropped = new PixelImage(right - left + 1, bottom - top + 1);
    for (let y = 0; y < cropped.height; y++) {
      for (let x = 0; x < cropped.width; x++) cropped.set(x, y, this.get(left + x, top + y));
    }
    return cropped;
  }
}

export type GridColours = Readonly<Record<string, Rgba>>;

/** Blends a character grid onto `image`; each character maps to a colour, and '.' is transparent. */
export function drawGrid(image: PixelImage, rows: readonly string[], colours: GridColours): PixelImage {
  rows.forEach((row, y) => {
    [...row].forEach((character, x) => {
      if (character === ".") return;
      const colour = colours[character];
      if (!colour) throw new Error(`No colour for grid character '${character}'`);
      image.blendOver(x, y, colour);
    });
  });
  return image;
}

export function gridImage(rows: readonly string[], colours: GridColours): PixelImage {
  const width = Math.max(...rows.map((row) => row.length));
  return drawGrid(new PixelImage(width, rows.length), rows, colours);
}

/** Adds a one-pixel outline (8-neighbour) around the fully opaque pixels. */
export function outline(image: PixelImage, colour: Rgba): PixelImage {
  const neighbours: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const result = image.clone();
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const touchesOpaque = neighbours.some(([offsetX, offsetY]) => image.alpha(x + offsetX, y + offsetY) === 255);
      if (image.alpha(x, y) < 255 && touchesOpaque) result.set(x, y, colour);
    }
  }
  return result;
}

export function pad(image: PixelImage, padding: number): PixelImage {
  return new PixelImage(image.width + 2 * padding, image.height + 2 * padding).draw(image, padding, padding);
}

/** Copies the opaque silhouette one pixel down in `colour`, beneath the image. */
export function extrude(image: PixelImage, colour: Rgba): PixelImage {
  const result = new PixelImage(image.width, image.height + 1);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) if (image.alpha(x, y) === 255) result.set(x, y + 1, colour);
  }
  return result.draw(image, 0, 0);
}

export interface GlowRing {
  readonly radius: number;
  readonly colour: Rgba;
}

/** Hard-edged concentric discs centred on (centreX, centreY); later rings overwrite earlier ones, so list largest first. */
export function glow(
  width: number,
  height: number,
  centreX: number,
  centreY: number,
  rings: readonly GlowRing[],
): PixelImage {
  const image = new PixelImage(width, height);
  for (const { radius, colour } of rings) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const distanceX = x + 0.5 - centreX;
        const distanceY = y + 0.5 - centreY;
        if (distanceX * distanceX + distanceY * distanceY <= radius * radius) image.set(x, y, colour);
      }
    }
  }
  return image;
}

/** Colours a text mask ('#' = ink) row by row; rows past the end of `rowColours` take its last colour. */
export function textImage(mask: readonly string[], rowColours: readonly Rgba[]): PixelImage {
  const image = new PixelImage(mask[0]?.length ?? 0, mask.length);
  mask.forEach((row, y) => {
    [...row].forEach((character, x) => {
      const colour = rowColours[Math.min(y, rowColours.length - 1)];
      if (character === "#" && colour) image.set(x, y, colour);
    });
  });
  return image;
}

/** Nearest-neighbour upscale that copies every channel, transparent pixels included. */
export function scaleImage(image: PixelImage, factor: number): PixelImage {
  const scaled = new PixelImage(image.width * factor, image.height * factor);
  for (let y = 0; y < scaled.height; y++) {
    for (let x = 0; x < scaled.width; x++) scaled.set(x, y, image.get(Math.floor(x / factor), Math.floor(y / factor)));
  }
  return scaled;
}

/** One crisp-edged <rect> per horizontal run of identical pixels, displayed at `displayScale`. */
export function toSvg(image: PixelImage, displayScale: number): string {
  const sameColour = (first: Rgba, second: Rgba): boolean => first.every((value, index) => value === second[index]);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width * displayScale}" height="${image.height * displayScale}" shape-rendering="crispEdges">\n`;
  for (let y = 0; y < image.height; y++) {
    let x = 0;
    while (x < image.width) {
      const colour = image.get(x, y);
      if (!colour[3]) {
        x++;
        continue;
      }
      let runEnd = x + 1;
      while (runEnd < image.width && sameColour(image.get(runEnd, y), colour)) runEnd++;
      const fill = `#${colour
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")}`;
      const opacity = colour[3] < 255 ? ` fill-opacity="${(colour[3] / 255).toFixed(3)}"` : "";
      svg += `<rect x="${x}" y="${y}" width="${runEnd - x}" height="1" fill="${fill}"${opacity}/>\n`;
      x = runEnd;
    }
  }
  return `${svg}</svg>\n`;
}
