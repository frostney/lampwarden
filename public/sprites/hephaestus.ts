function build(k) {
  humanoid(k, {
    facing: 20, pose: 'idle', build: 'heavy', skin: 'skin_olive',
    head: { type: 'human', hair: 'fur_dark', beard: 'fur_dark', helmet: 'none' },
    torso: { armour: 'chiton', colour: 'leather', trim: 'bronze' },
    legs: { sandals: true, colour: 'leather' },
    arms: { bracers: 'bronze' },
    weapon: 'hammer', weaponMat: 'iron',
  });
}
