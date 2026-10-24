// An error whose message is 40 million characters.
function build(k) {
  throw new Error('x'.repeat(40000000));
}
