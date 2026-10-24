// A Doric peripteral temple from the kit's temple() builder: stepped stylobate, 4 x 5 peristyle, frieze with triglyphs,
// sculpted pediment facing +u and a terracotta tiled roof. Hand-written example (not Mubit output).
export function build(k: Kit) {
  temple(k, { order: 'doric', cols: 4, depth: 5, mat: 'marble', roof: 'terracotta' });
}
