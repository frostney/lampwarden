// Rasterises text in a pixel font to a '#'/'.' mask by drawing it on a canvas in headless Chromium (Playwright).
// The text is drawn at 10x and sampled at each pixel's centre, so a font drawn on the requested pixel grid comes out
// exact; any half-covered sample means the font or size is off-grid, and the build stops.
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

export interface TextRequest {
  readonly text: string;
  /** Path to a TrueType font file. */
  readonly fontFile: string;
  /** The font's pixel grid size (em size in CSS px). */
  readonly pixelSize: number;
}

/** Rows of '#' (ink) and '.' (empty), cropped to the ink, keeping up to two columns of left side bearing. */
export type TextMask = readonly string[];

// the alpha of the sample at the middle of each pixel, row by row, `width` to a row
interface SampledText {
  readonly alphas: number[];
  readonly width: number;
}

// The '#'/'.' rows of a sampled text, and how many samples were neither clearly ink nor clearly paper.
function maskOf(alphas: readonly number[], width: number): { rows: string[]; ambiguousSamples: number } {
  const rows: string[] = [];
  for (let start = 0; start < alphas.length; start += width) {
    rows.push(
      alphas
        .slice(start, start + width)
        .map((alpha) => (alpha >= 128 ? "#" : "."))
        .join(""),
    );
  }
  const ambiguousSamples = alphas.filter((alpha) => alpha > 20 && alpha < 235).length;
  return { rows, ambiguousSamples };
}

export async function rasteriseTexts(requests: readonly TextRequest[]): Promise<TextMask[]> {
  const jobs = requests.map(({ text, fontFile, pixelSize }) => ({
    text,
    pixelSize,
    fontBase64: readFileSync(fontFile).toString("base64"),
  }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const results = await page.evaluate(async (pageJobs): Promise<SampledText[]> => {
      const supersample = 10;
      const output: SampledText[] = [];
      for (const [index, { text, pixelSize, fontBase64 }] of pageJobs.entries()) {
        const family = `logo-font-${index}`;
        const fontFace = new FontFace(family, `url(data:font/ttf;base64,${fontBase64})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        const width = text.length * pixelSize + 8;
        const height = pixelSize * 2;
        const canvas = document.createElement("canvas");
        canvas.width = width * supersample;
        canvas.height = height * supersample;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("No 2D canvas context");
        }
        context.font = `${pixelSize * supersample}px ${family}`;
        context.fillStyle = "#000";
        context.fillText(text, 2 * supersample, Math.round(pixelSize * 1.25) * supersample);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        // each pixel is the sample at its middle
        const alphas = Array.from({ length: width * height }, (_, cell) => {
          const sampleY = Math.floor(cell / width) * supersample + supersample / 2;
          const sampleX = (cell % width) * supersample + supersample / 2;
          return pixels[(sampleY * canvas.width + sampleX) * 4 + 3] ?? 0;
        });
        output.push({ alphas, width });
      }
      return output;
    }, jobs);
    return results.map(({ alphas, width }, index) => {
      const { rows, ambiguousSamples } = maskOf(alphas, width);
      if (ambiguousSamples > 0) {
        throw new Error(`"${requests[index]?.text}" is off the pixel grid (${ambiguousSamples} half-covered samples)`);
      }
      return cropToInk(rows);
    });
  } finally {
    await browser.close();
  }
}

function cropToInk(rows: readonly string[]): TextMask {
  const inkRows = rows.flatMap((row, index) => (row.includes("#") ? [index] : []));
  const firstInk = Math.min(2, ...rows.filter((row) => row.includes("#")).map((row) => row.indexOf("#")));
  const lastInk = Math.max(...rows.map((row) => row.lastIndexOf("#")));
  const firstRow = inkRows[0] ?? 0;
  const lastRow = inkRows.at(-1) ?? -1;
  return rows.slice(firstRow, lastRow + 1).map((row) => row.slice(firstInk, lastInk + 1));
}
