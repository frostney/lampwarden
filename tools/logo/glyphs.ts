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

interface RasterisedText {
  readonly rows: string[];
  readonly ambiguousSamples: number;
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
    const results = await page.evaluate(async (pageJobs): Promise<RasterisedText[]> => {
      const supersample = 10;
      const output: RasterisedText[] = [];
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
        if (!context) throw new Error("No 2D canvas context");
        context.font = `${pixelSize * supersample}px ${family}`;
        context.fillStyle = "#000";
        context.fillText(text, 2 * supersample, Math.round(pixelSize * 1.25) * supersample);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const rows: string[] = [];
        let ambiguousSamples = 0;
        for (let y = 0; y < height; y++) {
          let row = "";
          for (let x = 0; x < width; x++) {
            const sampleY = y * supersample + supersample / 2;
            const sampleX = x * supersample + supersample / 2;
            const alpha = pixels[(sampleY * canvas.width + sampleX) * 4 + 3];
            if (alpha > 20 && alpha < 235) ambiguousSamples++;
            row += alpha >= 128 ? "#" : ".";
          }
          rows.push(row);
        }
        output.push({ rows, ambiguousSamples });
      }
      return output;
    }, jobs);
    return results.map(({ rows, ambiguousSamples }, index) => {
      if (ambiguousSamples > 0) {
        throw new Error(`"${requests[index].text}" is off the pixel grid (${ambiguousSamples} half-covered samples)`);
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
  return rows.slice(inkRows[0], inkRows[inkRows.length - 1] + 1).map((row) => row.slice(firstInk, lastInk + 1));
}
