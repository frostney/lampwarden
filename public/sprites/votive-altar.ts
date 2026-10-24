function build(k) {
  altar(k, { at: [0, 0], w: 8, h: 7, mat: 'marble', fire: true });
  k.lathe([0, 0, 7], [[0, 1.2], [0.6, 2.4], [1.4, 3.2], [1.8, 3.4]], 'bronze');
  k.ring([0, 0, 8.8], [0, 0, 1], 3.3, 0.4, 'bronze');
  k.box([-4.6, -4.6, 0], [4.6, 4.6, 1], 'marble', { shift: -1 });
}
