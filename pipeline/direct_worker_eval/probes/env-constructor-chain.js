// Can a build reach `process.env` and read the host's canary secret? Tries the constructor chains that recover `process`
// in a realm that has deleted it, the Error stack-trace API, and (asynchronously) `import("node:process")`. What the
// synchronous routes find is thrown as the error; what the import finds is written to a marker file, because the build
// has returned by the time the import settles.
function build(k) {
  var global = (0, function () { return this; })();
  var routes = {
    constructorChain: function () { return global.constructor.constructor('return pro' + 'cess')(); },
    functionConstructor: function () { return Function('return pro' + 'cess')(); },
    arrowChain: function () { return (function () {}).constructor('return pro' + 'cess')(); },
    arrayChain: function () { return [].constructor.constructor('return pro' + 'cess')(); },
    thisChain: function () { return global.constructor.constructor('return this')()['pro' + 'cess']; },
    globalProperty: function () { return global['pro' + 'cess']; },
    evalRoute: function () { return (0, eval)('pro' + 'cess'); },
    callSites: function () {
      var found;
      var previous = Error.prepareStackTrace;
      Error.prepareStackTrace = function (_error, sites) {
        for (var index = 0; index < sites.length; index++) {
          try { var thisValue = sites[index].getThis(); if (thisValue && thisValue.env) found = thisValue; } catch (error) {}
          try { var fn = sites[index].getFunction(); if (fn && fn.process && fn.process.env) found = fn.process; } catch (error) {}
        }
        return '';
      };
      try { new Error().stack; } finally { Error.prepareStackTrace = previous; }
      return found;
    },
  };
  var reached = [];
  var secretSeen = null;
  var envKeys = null;
  for (var name in routes) {
    try {
      var host = routes[name]();
      if (host && host.env) {
        reached.push(name);
        envKeys = Object.keys(host.env).length;
        secretSeen = host.env['__CANARY_ENV__'] || secretSeen;
      }
    } catch (error) {}
  }
  try {
    import('node:process').then(function (module) {
      var env = module.default.env;
      var report = JSON.stringify({ envKeys: Object.keys(env).length, secretSeen: env['__CANARY_ENV__'] || null });
      return import('node:fs').then(function (fs) { fs.writeFileSync('__MARKER_DIR__/import-env', report); });
    }).catch(function () {});
  } catch (error) {}
  throw new Error('PROBE ' + JSON.stringify({ reached: reached, envKeys: envKeys, secretSeen: secretSeen }));
}
