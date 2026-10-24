// Throws a non-Error whose conversions run forever, to catch a host that stringifies thrown values.
function build(k) {
  throw { toString: function () { for (;;) {} }, toJSON: function () { for (;;) {} }, valueOf: function () { for (;;) {} }, message: { toString: function () { for (;;) {} } } };
}
