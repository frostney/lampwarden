// The town lamp, lit: lampstand() with a lion-paw tripod, fluted bronze shaft and a lantern glowing with fire light.
// Hand-written example (not Mubit output).
export function build(k: Kit) {
  lampstand(k, { height: 34, mat: 'bronze', lit: true, base: 'tripod', head: 'lantern' });
}
