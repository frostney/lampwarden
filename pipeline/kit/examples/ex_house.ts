// A whitewashed Greek house composed from kit primitives: walls, door (+u face), shuttered window (+v face), flat roof with parapet, amphora.
// The camera sees the +u and +v faces, so details go there.
export function build(k: Kit) {
  k.solid(S.box([-14, -10, 0], [14, 10, 14], 0), 'marble', { shift: -1 });          // walls
  k.solid(S.box([-15, -11, 14], [15, 11, 15.5], 0), 'limestone');                  // roof slab
  k.solid(S.box([-15, -11, 15.5], [15, -10, 17]), 'limestone', { shift: 1 });      // parapet (back)
  k.solid(S.box([-15, -11, 15.5], [-14, 11, 17]), 'limestone', { shift: 1 });      // parapet (back)
  k.solid(S.box([13, -4, 0], [15.5, 3, 9.5]), 'wood');                           // door on +u face
  k.solid(S.box([-9, 9, 5], [-2, 11.5, 10.5]), 'aegean');                        // shuttered window on +v face
  k.solid(S.box([4, 9, 5], [10, 11.5, 10.5]), 'aegean');
  amphora(k, { at: [19, -6], height: 8, mat: 'terracotta' });
}
