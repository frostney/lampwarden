// Catastrophic backtracking: a regular expression that would run for years.
function build(k) {
  /(a+)+$/.test('a'.repeat(64) + 'b');
}
