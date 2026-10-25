// Builds the Lampwarden logo and every asset derived from it.
// usage: bun tools/logo/build.ts            write the assets into public/logo/ and src/app/
//        bun tools/logo/build.ts --check    write nothing; compare the committed assets with a fresh build
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { appleTouchIcon, favicon16, favicon32, logo, manifestIcon, socialCard } from "./compose";
import { rasteriseTexts } from "./glyphs";
import { type PixelImage, scaleImage, toSvg } from "./image";
import { decodeIco, decodePng, encodeIco, encodePng } from "./png";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

interface Asset {
  /** Relative to the repository root. */
  readonly path: string;
  readonly bytes: Buffer;
  /** The decoded pixels (one image per ICO frame), empty for SVG. */
  readonly frames: readonly PixelImage[];
}

const pngAsset = (path: string, image: PixelImage): Asset => ({ path, bytes: encodePng(image), frames: [image] });

async function buildAssets(): Promise<Asset[]> {
  const [wordmark, tagline, ...extra] = await rasteriseTexts([
    { text: "LAMPWARDEN", fontFile: join(repositoryRoot, "src/app/fonts/ithaca/Ithaca.ttf"), pixelSize: 16 },
    {
      text: "KEEP ONE BURNING UNTIL DAWN",
      fontFile: join(repositoryRoot, "src/app/fonts/tiny5/Tiny5.ttf"),
      pixelSize: 8,
    },
  ]);
  if (!wordmark || !tagline || extra.length > 0) {
    throw new Error("expected exactly the wordmark and the tagline");
  }
  const master = logo(wordmark, true);
  const smallFavicon = favicon16();
  const icon = favicon32();
  const card = socialCard(master, tagline);
  return [
    pngAsset("public/logo/logo.png", master),
    pngAsset("public/logo/logo@4x.png", scaleImage(master, 4)),
    pngAsset("public/logo/logo-noglow.png", logo(wordmark, false)),
    { path: "public/logo/logo.svg", bytes: Buffer.from(toSvg(master, 8)), frames: [] },
    pngAsset("src/app/icon.png", icon),
    { path: "src/app/favicon.ico", bytes: encodeIco([smallFavicon, icon]), frames: [smallFavicon, icon] },
    pngAsset("src/app/apple-icon.png", appleTouchIcon()),
    pngAsset("public/logo/icon-192.png", manifestIcon(192, false)),
    pngAsset("public/logo/icon-512.png", manifestIcon(512, false)),
    pngAsset("public/logo/icon-maskable-192.png", manifestIcon(192, true)),
    pngAsset("public/logo/icon-maskable-512.png", manifestIcon(512, true)),
    pngAsset("src/app/opengraph-image.png", card),
    pngAsset("src/app/twitter-image.png", card),
  ];
}

const samePixels = (first: PixelImage, second: PixelImage): boolean =>
  first.width === second.width &&
  first.height === second.height &&
  first.data.every((value, index) => value === second.data[index]);

/** How the committed file compares with the fresh build, or null when it does not match. */
function compare(asset: Asset): string | null {
  const committed = readFileSync(join(repositoryRoot, asset.path));
  if (committed.equals(asset.bytes)) {
    return "identical bytes";
  }
  if (asset.frames.length === 0) {
    return null;
  }
  const committedFrames = asset.path.endsWith(".ico") ? decodeIco(committed) : [decodePng(committed)];
  const pixelsMatch =
    committedFrames.length === asset.frames.length &&
    committedFrames.every((frame, index) => {
      const fresh = asset.frames[index];
      return fresh !== undefined && samePixels(frame, fresh);
    });
  return pixelsMatch ? "identical pixels, different encoding" : null;
}

const assets = await buildAssets();
if (process.argv.includes("--check")) {
  let mismatches = 0;
  for (const asset of assets) {
    const result = compare(asset);
    if (result === null) {
      mismatches++;
    }
    console.log(`${asset.path}: ${result ?? "DIFFERS"}`);
  }
  if (mismatches > 0) {
    console.error(`${mismatches} asset(s) differ from a fresh build; run bun tools/logo/build.ts`);
    process.exit(1);
  }
} else {
  for (const asset of assets) {
    writeFileSync(join(repositoryRoot, asset.path), asset.bytes);
    console.log(`wrote ${asset.path}`);
  }
}
