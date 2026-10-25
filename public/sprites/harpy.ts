function build(k) {
  harpy(k, {
    facing: 40,
    pose: POSE || 'attack3',
    skin: 'skin_pale',
    head: { type: 'human', hair: 'fur_dark' },
    wings: { type: 'feather', colour: 'fur_dark', span: 12 },
    legs: { lower: 'bird' },
  });
}
