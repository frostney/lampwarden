function build(k) {
  const top = statueBase(k, { at: [0, 0], w: 9, h: 4, mat: 'limestone' });
  humanoid(k, {
    at: [0, 0, top], facing: 20, pose: 'attack2', build: 'heavy', height: 24,
    material: 'marble', skin: 'marble',
    head: { type: 'human', beard: 'marble', hair: 'marble', helmet: 'none' },
    torso: { armour: 'none' },
    weapon: 'thunderbolt',
  });
}
