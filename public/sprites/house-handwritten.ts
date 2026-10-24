// A whitewashed Greek island house from the kit's house() builder: framed blue door on the +u face, shuttered windows,
// flat roof with parapet, chimney, plant pots, an amphora and bougainvillea over the door. Hand-written example (not Mubit output).
export function build(k: Kit) {
  house(k, { w: 24, d: 18, storeys: 1, wall: 'whitewash', roof: 'flat', door: 'u', windows: 2, shutters: 'aegean', extras: ['pots', 'amphora', 'chimney', 'bougainvillea'] });
}
