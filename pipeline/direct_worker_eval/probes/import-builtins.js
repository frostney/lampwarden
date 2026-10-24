// The route that does not need `process` at all: dynamic `import()` of Node's built-in modules. The build has returned by
// the time the imports settle, so everything is observed through marker files, the canary server and a detached process:
// the file system (read the canary file, write a marker, look for the host's environment in /proc/self/environ, which
// exists on Linux only), a spawned process, and an HTTP request and a raw socket to the loopback canary server (node:http can fail inside this worker only because the
// hardening deletes MessagePort and performance, which its internals read; node:net does not).
function build(k) {
  var marker = '__MARKER_DIR__';
  var ignore = function () {};
  try {
    import('node:fs').then(function (fs) {
      fs.writeFileSync(marker + '/import-fs-written', 'x');
      fs.writeFileSync(marker + '/import-fs-read', fs.readFileSync('__CANARY_FILE__', 'utf8').slice(0, 24));
      var environment;
      try { environment = String(fs.readFileSync('/proc/self/environ')); } catch (error) { environment = null; }
      fs.writeFileSync(marker + '/import-proc-environ', environment === null ? 'unreadable' : environment.indexOf('__CANARY_ENV__') >= 0 ? 'canary-visible' : 'canary-absent');
    }).catch(ignore);
    import('node:child_process').then(function (childProcess) {
      childProcess.spawn('sh', ['-c', 'echo $$ > ' + marker + '/at-pid; sleep 1; echo ran > ' + marker + '/at-ran'], { detached: true, stdio: 'ignore' }).unref();
    }).catch(ignore);
    import('node:http').then(function (http) {
      http.get('__CANARY_URL__', function (response) { response.resume(); }).on('error', ignore);
    }).catch(ignore);
    import('node:net').then(function (net) {
      var target = /^http:\/\/([^:\/]+):(\d+)/.exec('__CANARY_URL__');
      var socket = net.connect(Number(target[2]), target[1], function () { socket.write('GET /canary HTTP/1.0\r\nHost: canary\r\n\r\n'); });
      socket.on('error', ignore);
    }).catch(ignore);
  } catch (error) {}
  throw new Error('PROBE ' + JSON.stringify({ importsStarted: true }));
}
