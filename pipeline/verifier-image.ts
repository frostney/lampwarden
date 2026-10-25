// The image the verifier sees: the 128 px sprite magnified 4x with nearest-neighbour on the (46, 46, 56) backdrop the
// verifier prompt is calibrated on, as a base64 PNG.
import { PixelImage } from "../tools/logo/image";
import { decodePng, encodePng } from "../tools/logo/png";

const BACKDROP = [46, 46, 56, 255] as const;
const MAGNIFICATION = 4;

function verifierImageBytes(spritePng: Uint8Array): Uint8Array {
  const sprite = decodePng(Buffer.from(spritePng));
  const backdrop = new PixelImage(sprite.width * MAGNIFICATION, sprite.height * MAGNIFICATION, BACKDROP);
  return encodePng(backdrop.draw(sprite, 0, 0, MAGNIFICATION));
}

export function verifierImageBase64(spritePng: Uint8Array): string {
  return Buffer.from(verifierImageBytes(spritePng)).toString("base64");
}
