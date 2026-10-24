function build(k) {
  amphora(k, { at: [-5, -4], height: 24, style: 'black-figure', figure: 'warriors', border: 'meander' });
  amphora(k, { at: [3, -6], height: 22, style: 'black-figure', figure: 'horses', border: 'palmette' });
  amphora(k, { at: [-6, 4], height: 21, style: 'black-figure', figure: 'rider', border: 'meander' });
  amphora(k, { at: [2, 2], height: 19, style: 'black-figure', figure: 'warriors', border: 'palmette' });
  amphora(k, { at: [8, 7], height: 14, style: 'black-figure', figure: 'horses', border: 'meander' });
  k.ring([9, -4, 1], [0, 0, 1], 3, 1, 'linen');
  k.ellipsoid([-1, 10, 1], [3, 2, 1], 'terracotta', { shift: -1 });
}
