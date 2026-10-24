// Leaving work behind: timers and promise jobs that would run after the render returned. In a host-realm sandbox the
// host's own timers are reachable and a marker file proves the callback ran later; inside QuickJS there are no timers
// and the host never runs promise jobs; the harness also measures the host's CPU use after the render returned.
function build(k) {
  var global = (0, function () { return this; })();
  var scheduled = [];
  var host;
  try { host = global.constructor.constructor('return pro' + 'cess')(); } catch (error) {}
  try { setTimeout(function () {}, 1); scheduled.push('setTimeout'); } catch (error) {}
  try { setInterval(function () {}, 1000); scheduled.push('setInterval'); } catch (error) {}
  try { queueMicrotask(function () {}); scheduled.push('queueMicrotask'); } catch (error) {}
  if (host) {
    try {
      var write = function () { host['getBuiltin' + 'Module']('fs').writeFileSync('__MARKER_DIR__/after-timer', 'ran'); };
      global.constructor.constructor('return setTimeout')()(write, 300);
      scheduled.push('hostSetTimeout');
    } catch (error) {}
  }
  // a promise job that spins for 3 s (only while a clock exists; a job in QuickJS would be stopped by the deadline)
  Promise.resolve().then(function () {
    var end = typeof Date === 'undefined' ? 0 : Date.now() + 3000;
    for (var count = 0; count < 4e8 && (!end || Date.now() < end); count++) {}
    if (host) host['getBuiltin' + 'Module']('fs').writeFileSync('__MARKER_DIR__/after-promise', 'ran');
  });
  scheduled.push('promiseJob');
  throw new Error('PROBE ' + JSON.stringify({ scheduled: scheduled, host: !!host }));
}
