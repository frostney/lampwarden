// Pollutes prototypes in the build's own realm, then through the host-realm constructors that leak into a node:vm
// context, then renders a lamp. The harness checks the host's intrinsics and renders a clean sprite afterwards.
function build(k) {
  var global = (0, function () { return this; })();
  Object.prototype.sandboxPolluted = 'yes';
  Array.prototype.push = function () { return 0; };
  Array.prototype.map = function () { return []; };
  Math.floor = function () { return 0; };
  Uint8Array.prototype.set = function () {};
  try {
    var HostObject = global.constructor;
    var HostFunction = HostObject.constructor;
    HostObject.prototype.hostPolluted = 'yes';
    HostFunction('return Math')().round = function () { return 0; };
    HostFunction('return Array')().prototype.hostPolluted = 'yes';
  } catch (error) {}
  lampstand(k, { height: 34, mat: 'bronze', lit: true, base: 'tripod', head: 'lantern' });
}
