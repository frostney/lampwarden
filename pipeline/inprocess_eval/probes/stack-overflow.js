function build(k) {
  function recurse(depth) { return recurse(depth + 1) + 1; }
  recurse(0);
}
