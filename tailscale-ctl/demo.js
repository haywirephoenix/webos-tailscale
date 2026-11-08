// Demo mode: stands in for ctl.sh when the page is opened on a PC (no PalmServiceBridge), or with ?demo.
// Open index.html in a browser. Pick a starting state with
// ?state=stopped|running|many|exit|login|fresh|nodaemon|warn|updating   (many: 18 devices; fresh: not installed)
// Add &boot=on to start with Start at boot turned on.
// Made-up data only.
(function () {
  'use strict';
  var params = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  // On the TV, demo mode comes from launch parameters: {"demo": true, "state": "many"}.
  try {
    var lp = window.PalmSystem && JSON.parse(window.PalmSystem.launchParams || '{}');
    if (lp && lp.demo) { params.demo = ''; if (lp.state) params.state = lp.state; }
  } catch (e) {}
  if (window.PalmServiceBridge && !('demo' in params)) return;

  var now = Date.now();
  function ago(s) { return new Date(now - s * 1000).toISOString(); }
  function inDays(d) { return new Date(now + d * 86400000).toISOString(); }
  function peer(id, host, os, ip, online, extra) {
    var p = {
      ID: id, HostName: host, DNSName: host.toLowerCase().replace(/\s+/g, '-') + '.tail00000.ts.net.', OS: os,
      TailscaleIPs: [ip], Online: online, Relay: 'lhr', CurAddr: '', ExitNode: false, ExitNodeOption: false,
      LastSeen: online ? ago(5) : ago(3600 * 30), LastHandshake: online ? ago(40) : '0001-01-01T00:00:00Z',
      KeyExpiry: inDays(120), Expired: false
    };
    for (var k in extra) p[k] = extra[k];
    return p;
  }

  var version = '1.98.9';
  var state = {
    installed: true, running: true, backend: 'Stopped', exit: '', updating: false, log: [], authURL: '', health: [],
    loggingIn: false, loginLog: '', boot: params.boot === 'on'
  };
  var s = params.state || 'stopped';
  if (s === 'running' || s === 'exit' || s === 'warn' || s === 'many') state.backend = 'Running';
  if (s === 'exit') state.exit = '100.64.0.6';
  if (s === 'login') state.backend = 'NeedsLogin';
  if (s === 'fresh') { state.installed = false; state.running = false; version = ''; }
  if (s === 'nodaemon') state.running = false;
  if (s === 'warn') state.health = ["Tailscale could not connect to the 'London' relay server. Your Internet connection might be down, or the server might be temporarily unavailable."];
  if (s === 'updating') state.updating = true;

  var peers = [
    peer('nDEMO1CNTRL', 'Test PC', 'windows', '100.64.0.4', true, { CurAddr: '203.0.113.99:41641' }),
    peer('nDEMO2CNTRL', 'Dummy', 'windows', '100.64.0.2', true, {}),
    peer('nDEMO3CNTRL', 'Redmagic 12 Pro', 'android', '100.64.0.5', false, {}),
    peer('nDEMO4CNTRL', 'pi-exit', 'linux', '100.64.0.6', true, { ExitNodeOption: true }),
    peer('nDEMO5CNTRL', 'vps-ams', 'linux', '100.64.0.7', true, { ExitNodeOption: true, Relay: 'ams' }),
    peer('nDEMO6CNTRL', 'Steve', 'windows', '100.64.0.8', false, { KeyExpiry: inDays(-3), Expired: true }),
    peer('nDEMO7CNTRL', 'macbook', 'macOS', '100.64.0.9', false, {})
  ];
  if (s === 'many') {
    ['nas', 'printer-pi', 'garage-cam', 'work-laptop', 'ipad', 'steamdeck', 'hass', 'router', 'kid-tablet', 'plex', 'vps-nyc']
      .forEach(function (h, i) {
        peer && peers.push(peer('nMANY' + i + 'CNTRL', h, i % 3 ? 'linux' : 'android', '100.64.1.' + (i + 1), i % 2 === 0, {}));
      });
  }

  // A made-up code in the text form "tailscale up --qr" prints ("#" light, " " dark, two per module).
  function fakeQR() {
    var n = 25, g = [], seed = 7, y, x;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) & 1; }
    function finder(oy, ox) {
      for (var j = 0; j < 7; j++) for (var k = 0; k < 7; k++)
        g[oy + j][ox + k] = j === 0 || j === 6 || k === 0 || k === 6 || (j > 1 && j < 5 && k > 1 && k < 5);
    }
    for (y = 0; y < n; y++) { g.push([]); for (x = 0; x < n; x++) g[y].push(!!rnd()); }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    var quiet = new Array((n + 8) * 2 + 1).join('#'), out = [quiet, quiet, quiet, quiet];
    for (y = 0; y < n; y++) {
      var l = '########';
      for (x = 0; x < n; x++) l += g[y][x] ? '  ' : '##';
      out.push(l + '########');
    }
    return out.concat([quiet, quiet, quiet, quiet]).join('\n');
  }

  function status() {
    if (!state.running) return null;
    var up = state.backend === 'Running';
    var map = {};
    if (state.backend === 'NeedsLogin') return { Version: version + '-tdemo', TUN: true, BackendState: 'NeedsLogin',
      AuthURL: state.authURL, TailscaleIPs: null, Self: { HostName: 'LGwebOSTV', OS: 'linux', Online: false }, Health: [], Peer: null };
    peers.forEach(function (p) {
      var c = JSON.parse(JSON.stringify(p));
      c.ExitNode = up && state.exit === p.TailscaleIPs[0];
      if (!up) { c.Online = false; c.CurAddr = ''; }
      map['nodekey:' + p.ID] = c;
    });
    return {
      Version: version + '-tdemo', TUN: true, BackendState: state.backend, AuthURL: state.authURL,
      TailscaleIPs: ['100.64.0.1'],
      Self: {
        ID: 'nDEMOSELFCNTRL', HostName: 'LGwebOSTV', DNSName: 'lgwebostv.tail00000.ts.net.', OS: 'linux',
        TailscaleIPs: ['100.64.0.1'], Online: up, Relay: 'lhr', KeyExpiry: inDays(170)
      },
      Health: state.backend === 'Stopped' ? ['Tailscale is stopped.'].concat(state.health) : state.health,
      MagicDNSSuffix: 'tail00000.ts.net',
      CurrentTailnet: up ? { Name: 'demo@example.com', MagicDNSSuffix: 'tail00000.ts.net', MagicDNSEnabled: true } : null,
      Peer: map
    };
  }

  function reply(cmd) {
    var a = cmd.split(' '), op = a[0];
    if (op === 'status') {
      return { installed: state.installed, running: state.running, pid: state.running ? '4242' : '', version: version,
        dir: state.installed ? 'tailscale_' + version + '_arm' : '', updating: state.updating, loggingIn: state.loggingIn,
        boot: state.boot, status: status() };
    }
    if (op === 'status-text') {
      if (!state.installed) return { ok: false, cmd: 'tailscale status', output: 'Tailscale is not installed. Use Install.' };
      var st = status(), txt = version + '\n  long version: ' + version + '-tdemo\n';
      if (!st || st.BackendState !== 'Running') txt += 'Tailscale is ' + (st ? st.BackendState.toLowerCase() : 'not running') + '.';
      else {
        txt += '100.64.0.1      lgwebostv    demo@  linux    -\n';
        peers.forEach(function (p) {
          txt += (p.TailscaleIPs[0] + '          ').slice(0, 16) + (p.HostName.toLowerCase() + '             ').slice(0, 13) +
            'demo@  ' + (p.OS + '         ').slice(0, 9) + (p.Online ? (p.CurAddr ? 'active; direct ' + p.CurAddr : 'active; relay "lhr"') : 'offline') + '\n';
        });
      }
      return { ok: true, cmd: 'tailscale version && tailscale status', output: txt };
    }
    if (op === 'up') {
      state.running = true;
      state.backend = 'Running';
      return { ok: true, cmd: 'tailscale up', output: '' };
    }
    if (op === 'down') { state.backend = 'Stopped'; return { ok: true, cmd: 'tailscale down', output: '' }; }
    if (op === 'exit-node') {
      state.exit = (a[1] || '').replace(/'/g, '');
      return { ok: true, cmd: 'tailscale set --exit-node=' + state.exit, output: '' };
    }
    if (op === 'login') {
      state.running = true; state.loggingIn = true; state.loginLog = '';
      setTimeout(function () {
        state.authURL = 'https://login.tailscale.com/a/1a2b3c4d5e6f7a';
        state.loginLog = '\nTo authenticate, visit:\n\n\t' + state.authURL + '\n\n' + fakeQR() + '\n';
      }, 1500);
      setTimeout(function () {   // someone approves it on their phone
        state.loggingIn = false; state.authURL = ''; state.backend = 'Running';
        state.loginLog += '\nSuccess.\n';
      }, 14000);
      return { ok: true, cmd: 'tailscale up --qr --reset --netfilter-mode=off --accept-dns=false', output: 'Waiting for the login URL...' };
    }
    if (op === 'login-log') return { waiting: state.loggingIn, log: state.loginLog };
    if (op === 'boot') {
      state.boot = a[1] === 'on';
      return { ok: true, cmd: 'boot ' + a[1],
        output: state.boot ? 'Tailscale starts at boot (/var/lib/webosbrew/init.d/70-tailscale).' : 'Tailscale no longer starts at boot.' };
    }
    if (op === 'logout') { state.backend = 'NeedsLogin'; return { ok: true, cmd: 'tailscale logout', output: '' }; }
    if (op === 'latest') return { latest: '1.104.5', current: version };
    if (op === 'update') {
      var fresh = !state.installed;
      state.updating = true;
      state.log = fresh ? ['Tailscale is not installed yet; installing the latest build.', 'Latest:  1.104.5']
        : ['Current: ' + version + ' (tailscale_' + version + '_arm)', 'Latest:  1.104.5'];
      var steps = ['Downloading tailscale_1.104.5_arm.tgz ...', 'Checksum OK. Unpacking ...']
        .concat(fresh ? [] : ['Stopping tailscaled (4242) ...'])
        .concat(['Starting tailscaled ...', 'Now: 1.104.5', 'DONE']);
      steps.forEach(function (l, i) {
        setTimeout(function () {
          state.log.push(l);
          if (l === 'Starting tailscaled ...' && fresh) { state.installed = true; state.running = true; state.backend = 'NeedsLogin'; }
          if (l === 'Now: 1.104.5') version = '1.104.5';
          if (l === 'DONE') state.updating = false;
        }, 1200 * (i + 1));
      });
      return { started: true };
    }
    if (op === 'update-log') return { updating: state.updating, log: state.log.join('\n') };
    return { error: 'unknown command ' + cmd };
  }

  // Same shape as the Homebrew Channel exec reply, with a short delay like the real thing.
  window.PalmServiceBridge = function () {};
  window.PalmServiceBridge.prototype.call = function (uri, payload) {
    var self = this;
    var cmd = JSON.parse(payload).command.replace(/^sh \S+ /, '');
    setTimeout(function () {
      var out = JSON.stringify(reply(cmd));
      self.onservicecallback(JSON.stringify({ returnValue: true, stdoutString: out + '\n', stderrString: '' }));
    }, cmd === 'up' || cmd === 'login' ? 900 : 150);
  };
  window.PalmServiceBridge.prototype.cancel = function () {};
  window.TAILSCALE_DEMO = true;
})();
