// Hands back a valid sprite with a 4 MB stats string.
function build(k) {
  var post = __kit.post;
  __kit.post = function (rendered) {
    var result = post(rendered);
    result.stats.flags = 'x'.repeat(4000000);
    return result;
  };
  lampstand(k, { height: 34, mat: 'bronze', lit: true, base: 'tripod', head: 'lantern' });
}
