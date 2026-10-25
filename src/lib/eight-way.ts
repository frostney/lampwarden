const SECTORS = 8;
const SECTOR = (2 * Math.PI) / SECTORS;

/** The nearest of the eight directions to (horizontal, vertical): each axis -1, 0 or 1. */
export function eightWayStep(horizontal: number, vertical: number): [number, number] {
  const sector = Math.round(Math.atan2(vertical, horizontal) / SECTOR);
  return [Math.round(Math.cos(sector * SECTOR)), Math.round(Math.sin(sector * SECTOR))];
}
