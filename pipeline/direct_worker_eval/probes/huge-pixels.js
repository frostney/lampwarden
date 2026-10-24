// Hands back a 128 MiB "sprite" by replacing the kit's post step.
function build(k) {
  __kit.post = function () { return { rgba: new Uint8Array(1 << 27), stats: {} }; };
}
