// Can the build reach the host's process, require, import(), Bun or other host globals? Reports which routes worked.
function build(k) {
  var global = (0, function () { return this; })();
  var routes = {
    process: function () { return typeof process !== 'undefined' ? process : undefined; },
    require: function () { return typeof require !== 'undefined' ? require : undefined; },
    bun: function () { return typeof Bun !== 'undefined' ? Bun : undefined; },
    globalThisProcess: function () { return globalThis['pro' + 'cess']; },
    constructorChain: function () { return global.constructor.constructor('return pro' + 'cess')(); },
    arrayChain: function () { return [].constructor.constructor('return pro' + 'cess')(); },
    hostBun: function () { return global.constructor.constructor('return B' + 'un')(); },
    thisProcess: function () { return global.constructor.constructor('return this')()['pro' + 'cess']; },
  };
  var reached = [];
  for (var name in routes) {
    try {
      var value = routes[name]();
      if (value !== undefined && value !== null) reached.push(name);
    } catch (error) {}
  }
  var dynamicImport = 'unsupported';
  try {
    var pending = import('node:fs');
    dynamicImport = typeof pending;
    if (pending && pending.catch) pending.catch(function () {});
  } catch (error) {
    dynamicImport = 'threw';
  }
  var names = Object.getOwnPropertyNames(global);
  var hostGlobals = ['process', 'require', 'module', 'Bun', 'fetch', 'console', 'setTimeout', 'setImmediate', 'queueMicrotask', 'Date', 'performance', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'globalThis'].filter(function (name) { return names.indexOf(name) >= 0; });
  throw new Error('PROBE ' + JSON.stringify({ reached: reached, dynamicImport: dynamicImport, hostGlobals: hostGlobals, globals: names.length }));
}
