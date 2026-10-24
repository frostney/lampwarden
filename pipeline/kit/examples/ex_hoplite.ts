export function build(k: Kit) {
  humanoid(k, {
    facing: 20, build: 'average', pose: 'idle', skin: 'skin',
    head: { type: 'human', helmet: 'corinthian', crest: 'crimson' },
    torso: { armour: 'linothorax', trim: 'aegean' }, legs: { greaves: true, sandals: true },
    weapon: 'spear', shield: { type: 'hoplon', colour: 'bronze', emblem: 'lambda', emblemColour: 'crimson' },
    cape: 'crimson',
  });
}
