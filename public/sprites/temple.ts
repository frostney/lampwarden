// A small Doric temple composed from kit primitives: stylobate, cella, column() builder, entablature, gable roof, pediment.
// Written by hand to show that buildings are composed from S.* shapes plus the column builder; there is no dedicated temple() builder.
export function build(k: Kit) {
  const m = 'marble';
  k.solid(S.box([-17, -11, 0], [17, 11, 1.2], 0), m, { shift: -1 });          // stylobate
  k.solid(S.box([-9, -4, 1.2], [9, 4, 16], 0), 'limestone');                  // cella walls
  for (const u of [-12, 0, 12]) for (const v of [-7.5, 7.5]) column(k, { at: [u, v], order: 'doric', height: 17, mat: m });
  k.solid(S.box([-15, -9.5, 16], [15, 9.5, 18.5], 0), m, { shift: 1 });       // entablature
  k.solid(S.plate([[-16, -10.5, 18.5], [16, -10.5, 18.5], [16, 0, 24], [-16, 0, 24]], 1.2), 'terracotta');
  k.solid(S.plate([[-16, 10.5, 18.5], [16, 10.5, 18.5], [16, 0, 24], [-16, 0, 24]], 1.2), 'terracotta', { shift: -1 });
  k.solid(S.plate([[-15, -9.6, 18.5], [15, -9.6, 18.5], [0, -9.6, 23]], 1.0), m, { shift: 1 }); // front pediment
}
