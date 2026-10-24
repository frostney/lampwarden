// A stone sea wall segment from the kit's wall() builder: ashlar courses, merlons, an arched gate with plank doors,
// a weedy wet foot and mooring rings. Hand-written example (not Mubit output).
export function build(k: Kit) {
  wall(k, { len: 40, height: 14, mat: 'limestone', crenels: true, gate: true, sea: true });
}
