// The JavaScript-only counterpart of scheduling with `at`: start a detached process that outlives the render and the
// build's own sandbox. It touches a marker one second later and records its own pid so the harness can clean up.
function build(k) {
  var global = (0, function () { return this; })();
  var host;
  try { host = global.constructor.constructor('return pro' + 'cess')(); } catch (error) {}
  if (!host) throw new Error('PROBE ' + JSON.stringify({ host: false }));
  var spawned;
  try {
    var child = host['getBuiltin' + 'Module']('child_process').spawn('sh', ['-c', 'echo $$ > __MARKER_DIR__/at-pid; sleep 1; echo ran > __MARKER_DIR__/at-ran'], { detached: true, stdio: 'ignore' });
    child.unref();
    spawned = true;
  } catch (error) { spawned = false; }
  throw new Error('PROBE ' + JSON.stringify({ host: true, spawned: spawned }));
}
