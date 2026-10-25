function build(k) {
  hero(k, {
    sex: 'male',
    melee: 'xiphos',
    ranged: 'bow',
    pose: POSE || 'idle',
    facing: FACING,
    helmet: 'none',
    cape: true,
    palette: { cloth: 'marble', accent: 'crimson', hair: 'fur_dark', skin: 'skin', metal: 'bronze' },
  });
}
