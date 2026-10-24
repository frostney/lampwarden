// A bounded memory bomb: allocates 32 MiB blocks until 1.5 GiB. A renderer with a memory limit stops it early.
function build(k) {
  var keep = [];
  var total = 0;
  while (total < 1536) {
    keep.push(new Float64Array(1 << 22).fill(1));
    total += 32;
  }
  throw new Error('PROBE allocated ' + total + ' MiB and was never stopped');
}
