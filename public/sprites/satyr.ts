function build(k) {
  satyr(k, {
    facing: 25,
    build: 'slim',
    height: 22,
    pose: POSE || 'walk2',
    skin: 'skin',
    head: { type: 'goat', hair: 'fur_dark', beard: 'fur_dark' },
    torso: { armour: 'none' },
    legs: { lower: 'goat', colour: 'fur_dark' },
    weapon: 'pipes',
    weaponMat: 'wood',
  });
}
