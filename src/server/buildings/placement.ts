// What the plaza's placer needs to know about an accepted building sprite, measured once on the server from the PNG the
// sandbox rendered, so no client ever measures pixels: where it stands (the anchor), the box of what was painted, and the
// extents of its base and of the whole sprite in the form the committed sprites' are (src/scene/extent.ts).
import { type Building, buildingSchema } from "@/game/building";
import { measureSprite } from "@/scene/extent";
import { decodePng } from "../../../tools/logo/png";
import { anchorYFromBbox } from "../creatures/job-shell";

type Placement = Pick<Building, "anchorY" | "bbox" | "extent">;

/** The render's bbox ("left,top,right,bottom") as four whole pixels, or null when it is not that. */
function parseBbox(bbox: string): Building["bbox"] | null {
  const parsed = buildingSchema.shape.bbox.safeParse(bbox.split(",").map(Number));
  return parsed.success ? parsed.data : null;
}

/** The placement of the sprite a render produced, or null when the render's bbox or the picture cannot be read. */
export function measurePlacement(png: Uint8Array, bbox: string): Placement | null {
  const painted = parseBbox(bbox);
  if (!painted) return null;
  const anchorY = anchorYFromBbox(bbox);
  try {
    const image = decodePng(Buffer.from(png));
    if (image.width !== 128 || image.height !== 128) return null;
    // what was measured must be what a record can hold: a picture with no solid pixel, or a base of fewer than three corners,
    // has no extent the placer can use, and would be stored as a record that could never be read back
    const extent = buildingSchema.shape.extent.safeParse(measureSprite(image.data, anchorY));
    return extent.success ? { anchorY, bbox: painted, extent: extent.data } : null;
  } catch {
    return null;
  }
}
