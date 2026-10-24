// Mutates the kit's own state: the shared tables, the shape library and the builder prototypes. A reused context would
// render the next sprite differently; a fresh context per render must not.
function build(k) {
  PALETTE.bronze[0] = '#ff00ff';
  THEMES.greek.metal = 'gold';
  MATS.length = 0;
  S.sphere = S.box;
  Kit.prototype.solid = function () { return 0; };
  Frame.prototype.p = function () { return [0, 0, 0]; };
  __kit.hash = function () { return 0.5; };
  lampstand(k, { height: 34, mat: 'bronze', lit: true, base: 'tripod', head: 'lantern' });
}
