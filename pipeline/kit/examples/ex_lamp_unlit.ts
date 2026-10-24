// The town lamp, unlit: the same lampstand() with lit:false (dark horn panels, cold metal, no sparks).
// Hand-written example (not Mubit output).
export function build(k: Kit) {
  lampstand(k, { height: 34, mat: 'bronze', lit: false, base: 'tripod', head: 'lantern' });
}
