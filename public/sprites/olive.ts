function build(k) {
  tree(k, { at: [0, 0], kind: 'olive', height: 30 });
  k.capsule([1, 1, 1.5], [5, 3, 0.3], 1.4, 0.7, 'leather');
  k.capsule([-1, 0.5, 1.2], [-4, 3, 0.3], 1.2, 0.6, 'leather', { shift: -1 });
}
