function build(k) {
  hero(k, {
    sex: 'female', melee: 'spear', ranged: 'sling',
    pose: POSE || 'idle', facing: FACING,
    helmet: 'attic', cape: true,
    palette: { cloth: 'linen', accent: 'aegean', hair: 'fur_dark', skin: 'skin_olive', metal: 'bronze' },
  });
}
