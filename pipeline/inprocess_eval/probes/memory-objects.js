// The same with small objects, which count against the JavaScript heap rather than against array-buffer memory: 10M of them.
function build(k) {
  var keep = [];
  for (var count = 0; count < 10000000; count++) keep.push({ count: count, list: [count] });
  throw new Error('PROBE allocated ' + keep.length + ' objects and was never stopped');
}
