// Bun only: the `Bun` global of a Bun worker is not deletable, so a constructor chain recovers it. Does it hand the build
// the host's environment, files or processes? Under Node there is no `Bun`, and the probe reports { bun: false }.
function build(k) {
  var global = (0, function () { return this; })();
  var bun;
  try { bun = global.constructor.constructor('return typeof Bun === "undefined" ? undefined : Bun')(); } catch (error) {}
  var report = { bun: !!bun };
  if (bun) {
    try { report.envKeys = Object.keys(bun.env).length; report.secretSeen = bun.env['__CANARY_ENV__'] || null; } catch (error) { report.envError = 1; }
    try { report.fileSeen = String(bun.spawnSync(['cat', '__CANARY_FILE__']).stdout).slice(0, 24); report.spawned = true; } catch (error) { report.spawnError = 1; }
    try { bun.write('__MARKER_DIR__/written-by-build', 'x'); report.wrote = true; } catch (error) { report.writeError = 1; }
  }
  throw new Error('PROBE ' + JSON.stringify(report));
}
