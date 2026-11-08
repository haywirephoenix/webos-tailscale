// Tailscale manager. Root work goes through the Homebrew Channel's exec to ctl.sh in this app's folder.
// Plain ES5, for the older web engine of webOS 5.
(function () {
  'use strict';
  var CTL = '/media/developer/apps/usr/palm/applications/com.homebrew.tailscalectl/ctl.sh';
  var EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var POLL_MS = 5000;

  function $(id) { return document.getElementById(id); }
  var toggle = $('toggle'), exitBtn = $('exit'), updateBtn = $('update'), refreshBtn = $('refresh'), logoutBtn = $('logout');
  var bootBtn = $('boot');
  var buttons = [toggle, exitBtn, updateBtn, refreshBtn, bootBtn, logoutBtn];
  var armed = null;       // timer while Log out waits for its second press
  var logEl = $('log');
  var scroller = $('scroller');

  var info = null;        // last ctl.sh status reply
  var prev = null;        // the one before, to log what changed
  var busy = false;
  var latest = null;      // latest version once checked
  var login = null;       // { url, qr } while signing in
  var loggedURL = null;   // the login link already shown in the console
  var bridges = [];       // older engines can collect a bridge mid-call, so hold each until it answers
  var timer = null;

  // ---------- exec ----------
  function ctl(command, done) {
    var bridge = new window.PalmServiceBridge();
    bridges.push(bridge);
    bridge.onservicecallback = function (msg) {
      bridges.splice(bridges.indexOf(bridge), 1);
      var reply = {}, answer = null;
      try { reply = JSON.parse(msg); } catch (e) {}
      var out = String(reply.stdoutString || '').trim();
      try { answer = JSON.parse(out); } catch (e) {
        try { var ls = out.split('\n'); answer = JSON.parse(ls[ls.length - 1]); } catch (e2) {}
      }
      if (!answer) {
        var why = reply.errorText || reply.stderrString || out || 'no reply from the Homebrew Channel';
        log('ctl.sh ' + command + ' failed: ' + why);
      }
      done(answer, reply);
    };
    bridge.call(EXEC, JSON.stringify({ command: 'sh ' + CTL + ' ' + command }));
  }

  // ---------- console ----------
  // Newest entry on top; the lines of one entry stay in reading order under its time.
  var lines = [];
  function stamp() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }
  function log(text) {
    var ts = stamp();
    var entry = String(text).split('\n').filter(function (l) { return l.replace(/\s+$/, ''); })
      .map(function (l, i) { return (i ? '          ' : ts + '  ') + l.replace(/\s+$/, ''); });
    if (!entry.length) return;
    lines = entry.concat(lines).slice(0, 200);
    logEl.textContent = lines.join('\n');
    logEl.scrollTop = 0;
  }
  // A command and what it printed, the way a terminal shows it.
  function logRun(a) {
    if (!a) return;
    var text = '$ ' + (a.cmd || 'ctl.sh') + '\n' + (a.output ? a.output : (a.ok ? '(no output)' : '(failed)'));
    log(text);
  }

  // ---------- helpers ----------
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeAgo(iso) {
    if (!iso || iso.indexOf('0001-01-01') === 0) return null;
    var diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    return Math.floor(diff / (86400 * 30)) + 'mo ago';
  }
  function osIcon(os) {
    var map = { linux: '⌗', windows: '⊞', darwin: '⌘', macos: '⌘', ios: '◩', android: '▣' };
    return map[(os || '').toLowerCase()] || '●';
  }
  function first(arr) {
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) if (arr[i]) return arr[i];
    return null;
  }
  function trimDot(s) { return String(s || '').replace(/\.$/, ''); }
  function peersOf(st) {
    var out = [], p = (st && st.Peer) || {};
    Object.keys(p).forEach(function (k) { out.push(p[k]); });
    return out;
  }
  function backendOf(i) { return i && i.status ? i.status.BackendState : null; }
  function backend() { return backendOf(info); }
  function versionShort(v) { return String(v || '').split('-')[0]; }
  function needsLogin() { var b = backend(); return b === 'NeedsLogin' || b === 'NoState'; }
  function exitPeerOf(st) { return peersOf(st).filter(function (p) { return p.ExitNode; })[0]; }

  // ---------- what changed since the last poll, for the console ----------
  function logChanges(a, b) {
    if (!a) {
      log('tailscale ' + (versionShort(b.version) || 'not installed') + ' · ' +
        (!b.installed ? 'no build in /home/root/sbin' : !b.running ? 'tailscaled stopped' : 'state ' + (backendOf(b) || '?')) +
        (b.status ? ' · ' + peersOf(b.status).length + ' peers' : ''));
      return;
    }
    var out = [];
    if (a.installed !== b.installed) out.push(b.installed ? 'tailscale installed' : 'tailscale build missing');
    if (!!a.boot !== !!b.boot) out.push(b.boot ? 'start at boot on' : 'start at boot off');
    if (a.running !== b.running) out.push(b.running ? 'tailscaled started (pid ' + b.pid + ')' : 'tailscaled stopped');
    else if (a.pid && b.pid && a.pid !== b.pid) out.push('tailscaled restarted (pid ' + b.pid + ')');
    if (versionShort(a.version) !== versionShort(b.version) && b.version) out.push('version ' + versionShort(a.version) + ' → ' + versionShort(b.version));
    var sa = backendOf(a), sb = backendOf(b);
    if (sa !== sb && sb) out.push('state ' + (sa || '—') + ' → ' + sb);
    if (sb === 'Running' && sa === 'Running') {
      var before = {};
      peersOf(a.status).forEach(function (p) { before[p.ID] = p; });
      peersOf(b.status).forEach(function (p) {
        var o = before[p.ID];
        if (!o) out.push(p.HostName + ' joined the tailnet');
        else if (!o.Online && p.Online) out.push(p.HostName + ' came online');
        else if (o.Online && !p.Online) out.push(p.HostName + ' went offline');
        else if (!o.CurAddr && p.CurAddr) out.push(p.HostName + ' connected directly (' + p.CurAddr + ')');
        else if (o.CurAddr && !p.CurAddr) out.push(p.HostName + ' now through relay ' + (p.Relay || '?'));
      });
    }
    var ea = exitPeerOf(a.status), eb = exitPeerOf(b.status);
    if ((ea && ea.ID) !== (eb && eb.ID) && sb === 'Running') out.push('exit node ' + (eb ? eb.HostName : 'none'));
    if (sb === 'Running') {
      var ha = (a.status && a.status.Health) || [];
      ((b.status && b.status.Health) || []).forEach(function (h) { if (ha.indexOf(h) < 0) out.push('warning: ' + h); });
    }
    if (out.length) log(out.join('\n'));
  }

  // ---------- render ----------
  function render() {
    var st = info && info.status;
    var b = backend();
    var up = b === 'Running';
    var state = !info ? 'Unknown' : !info.installed ? 'Not installed' : !info.running ? 'Daemon stopped' : (b || 'Starting');

    var pill = $('pill');
    pill.className = 'state-pill ' + (up ? '' : (info && info.running && b !== 'Stopped' ? 'unknown' : 'bad'));
    $('pillText').textContent = state;

    var peers = peersOf(st);
    var online = peers.filter(function (p) { return p.Online; }).length;
    $('tailnet').textContent = '/ ' + ((st && st.CurrentTailnet && st.CurrentTailnet.Name) || (info ? 'not connected' : '…'));
    $('meta').innerHTML = info
      ? '<span><b>' + peers.length + '</b> peers · <b>' + online + '</b> online</span>' +
        '<span>client <b>' + esc(versionShort(info.version) || '—') + '</b></span>' +
        '<span>daemon <b>' + (info.running ? 'pid ' + esc(info.pid) : 'stopped') + '</b></span>' +
        (st ? '<span>tun <b>' + (st.TUN ? 'on' : 'off') + '</b></span>' : '')
      : 'reading status';
    $('build').textContent = info ? (info.dir || '—') : '—';

    // The main button does whatever comes next: install, sign in, connect or disconnect.
    var updating = info && info.updating;
    toggle.className = 'ctl primary' + (up ? ' is-up' : '');
    if (info && !info.installed) toggle.textContent = updating ? 'Installing…' : 'Install Tailscale';
    else if (info && info.loggingIn) toggle.textContent = 'Waiting for login…';
    else if (needsLogin()) toggle.textContent = 'Log in';
    else toggle.textContent = up ? 'Disconnect' : 'Connect';
    toggle.disabled = busy || !info || updating || (info && info.loggingIn);

    var exitPeer = exitPeerOf(st);
    exitBtn.textContent = 'Exit node: ' + (exitPeer ? exitPeer.HostName : 'none');
    exitBtn.disabled = busy || !up;

    var newer = latest && latest !== versionShort(info && info.version);
    if (updating) updateBtn.textContent = 'Updating…';
    else if (newer && info && info.installed) updateBtn.textContent = 'Update to ' + latest;
    else if (latest && info && info.installed) updateBtn.textContent = 'Up to date';
    else updateBtn.textContent = 'Check for update';
    updateBtn.className = 'ctl' + (newer && info && info.installed ? ' attention' : '');
    updateBtn.disabled = busy || updating || (info && !info.installed);
    refreshBtn.disabled = false;

    // Signed in (up or down) is when logging out means anything.
    var signedIn = info && info.running && (b === 'Running' || b === 'Stopped' || b === 'Starting' || b === 'NeedsMachineAuth');
    logoutBtn.disabled = busy || !signedIn;
    logoutBtn.textContent = armed ? 'Confirm' : 'Log out';
    logoutBtn.className = 'ctl' + (armed ? ' danger' : '');

    // Start at boot: shows whether it's on; a press turns it the other way.
    var boot = !!(info && info.boot);
    bootBtn.textContent = 'Boot: ' + (boot ? 'on' : 'off');
    bootBtn.className = 'ctl' + (boot ? ' on' : '');
    bootBtn.disabled = busy || !info || !info.installed;

    // banners
    var html = '';
    if (info && !info.installed) {
      html += '<div class="banner info"><div class="h-title">tailscale is not installed</div>' +
        '<pre>Install Tailscale downloads the latest official ARM build from pkgs.tailscale.com into /home/root/sbin ' +
        'and starts it. Then Log in signs this TV in to your tailnet.</pre></div>';
    }
    var authURL = (login && login.url) || (st && st.AuthURL);
    if ((info && info.loggingIn) || authURL) {
      html += '<div class="banner info login">' +
        (login && login.qr ? '<canvas id="qr" class="qr"></canvas>' : '') +
        '<div><div class="h-title">sign this TV in</div><pre>' + (authURL
          ? 'Scan the code with your phone, or open this link on any device signed in to Tailscale:\n\n' + esc(authURL) +
            '\n\nThe TV joins as soon as you approve it.'
          : 'Asking Tailscale for a login link…') + '</pre></div></div>';
    } else if (b === 'NeedsMachineAuth') {
      html += '<div class="banner"><div class="h-title">waiting for approval</div><pre>This TV is signed in but your tailnet ' +
        'needs an admin to approve new devices. Approve it at login.tailscale.com/admin/machines.</pre></div>';
    }
    // While down, tailscaled keeps the last warnings it had (a relay it could not reach, say), and
    // "Tailscale is stopped." is just the state the pill already shows; only show warnings while up.
    var health = up ? ((st && st.Health) || []) : [];
    if (health.length) {
      html += '<div class="banner"><div class="h-title">⚠ health warnings (' + health.length + ')</div>' +
        health.map(function (h) { return '<pre>' + esc(h) + '</pre>'; }).join('') + '</div>';
    }
    $('banners').innerHTML = html;
    if (login && login.qr && $('qr')) drawQR($('qr'), login.qr);

    $('peers').innerHTML = st && st.Self && b !== 'NeedsLogin' && b !== 'NoState' ? renderPeers(st, peers) : '';

    // A button that was focused may have been disabled while busy; give the remote somewhere to start.
    var f = document.activeElement;
    if (!busy && (!f || f === document.body || f.disabled)) { var g = focusable()[0]; if (g) g.focus(); }
  }

  // This TV goes first, as a card like the others.
  function renderSelf(st) {
    var self = st.Self;
    var on = backend() === 'Running' && self.Online;
    var exitPeer = exitPeerOf(st);
    var badges = [];
    if (self.Relay) badges.push('<span class="badge relay">' + esc(self.Relay) + '</span>');
    return '<div class="peer-card self' + (on ? '' : ' offline') + '">' +
      '<div class="peer-head"><div class="peer-id"><div class="os-icon">' + osIcon(self.OS) + '</div><div class="names">' +
      '<div class="hostname">' + esc(self.HostName) + '<span class="tag-you">you</span></div>' +
      '<div class="dns">' + esc(trimDot(self.DNSName)) + '</div></div></div>' +
      '<div class="status-dot ' + (on ? 'online' : 'offline') + '"></div></div>' +
      '<div class="peer-rows">' +
      row('address', esc(first(self.TailscaleIPs) || first(st.TailscaleIPs) || 'no address'), 'mono') +
      row('node id', esc(self.ID || '—'), 'mono') +
      row('exit node', esc(exitPeer ? exitPeer.HostName : 'none')) +
      row('status', on ? 'online' : 'offline', on ? 'on' : 'off') +
      '</div>' + (badges.length ? '<div class="badges">' + badges.join('') + '</div>' : '') + '</div>';
  }

  function renderPeers(st, peers) {
    var html = '<div class="section-label">Devices <span class="count">(' + (peers.length + 1) + ')</span></div>';
    peers.sort(function (a, b) {
      if (!!b.Online !== !!a.Online) return (b.Online ? 1 : 0) - (a.Online ? 1 : 0);
      return (a.HostName || '').localeCompare(b.HostName || '');
    });
    return html + '<div class="peer-grid">' + renderSelf(st) + peers.map(renderPeer).join('') + '</div>';
  }
  function renderPeer(p) {
    var seen = timeAgo(p.LastHandshake && p.LastHandshake.indexOf('0001') !== 0 ? p.LastHandshake : p.LastSeen);
    var badges = [];
    if (p.ExitNode) badges.push('<span class="badge exit">using as exit</span>');
    else if (p.ExitNodeOption) badges.push('<span class="badge exit">exit node</span>');
    if (p.Relay) badges.push('<span class="badge relay">' + esc(p.Relay) + '</span>');
    if (p.Expired) badges.push('<span class="badge expired">key expired</span>');
    return '<div class="peer-card' + (p.Online ? '' : ' offline') + (p.Expired ? ' expired' : '') + (p.ExitNode ? ' using' : '') + '">' +
      '<div class="peer-head"><div class="peer-id"><div class="os-icon">' + osIcon(p.OS) + '</div><div class="names">' +
      '<div class="hostname">' + esc(p.HostName) + '</div><div class="dns">' + esc(trimDot(p.DNSName)) + '</div></div></div>' +
      '<div class="status-dot ' + (p.Online ? 'online' : 'offline') + '"></div></div>' +
      '<div class="peer-rows">' +
      row('address', esc(first(p.TailscaleIPs) || 'no address'), 'mono') +
      row('os', esc(p.OS || '—')) +
      row('last seen', p.Online ? 'now' : (seen || '—')) +
      (p.CurAddr ? row('direct', esc(p.CurAddr), 'mono') : '') +
      '</div>' + (badges.length ? '<div class="badges">' + badges.join('') + '</div>' : '') + '</div>';
  }
  function row(k, v, cls) { return '<div class="peer-row"><span class="k">' + k + '</span><span class="v ' + (cls || '') + '">' + v + '</span></div>'; }

  // ---------- login QR ----------
  // "tailscale up --qr" draws the code as text, one row per line and two characters per module,
  // with the light colour as the quiet zone around it. Read it back into a grid of dark modules.
  function parseQR(text) {
    var rows = String(text).split('\n').filter(function (l) {
      return l.length >= 40 && /^[^A-Za-z0-9:\/.]+$/.test(l);
    });
    if (rows.length < 21) return null;
    var light = rows[0].charAt(0);
    return rows.map(function (l) {
      var r = [];
      for (var i = 0; i + 1 < l.length; i += 2) r.push(l.charAt(i) !== light);
      return r;
    });
  }
  function drawQR(canvas, grid) {
    var n = grid.length, m = grid[0].length, px = 4;
    canvas.width = m * px; canvas.height = n * px;
    var c = canvas.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#000';
    for (var y = 0; y < n; y++) for (var x = 0; x < m; x++) if (grid[y][x]) c.fillRect(x * px, y * px, px, px);
  }
  function watchLogin() {
    ctl('login-log', function (a) {
      if (a) {
        var url = (String(a.log).match(/https:\/\/login\.tailscale\.com\/\S+/) || [])[0];
        if (url && a.waiting && (!login || login.url !== url)) {
          login = { url: url, qr: parseQR(a.log) };
          if (url !== loggedURL) { log('Login link: ' + url); loggedURL = url; }
        }
      }
      if (a && a.waiting) { refresh(); setTimeout(watchLogin, 2500); return; }
      if (a && a.log) {
        // What "tailscale up --qr" said last ("Success.", or why it gave up), without the link and code again.
        var tail = String(a.log).split('\n').filter(function (l) {
          return /\w/.test(l) && !/^\W+$/.test(l) && !/To authenticate|login\.tailscale\.com/.test(l);
        }).slice(-2).join('\n');
        if (tail) log('tailscale up: ' + tail);
      }
      login = null;
      refresh();
    });
  }

  // ---------- actions ----------
  function refresh(done) {
    ctl('status', function (a) {
      if (a) { prev = info; info = a; logChanges(prev, info); }
      if (info && backend() === 'Running') login = null;
      render();
      if (done) done();
    });
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { if (!busy) refresh(schedule); else schedule(); }, POLL_MS);
  }
  function run(command, then) {
    busy = true; render();
    ctl(command, function (a) {
      logRun(a);
      busy = false;
      refresh(then);
    });
  }
  // "tailscale status" pads its columns for a terminal; the console is narrow, so close them up.
  function statusText() {
    ctl('status-text', function (a) {
      if (a && a.output) a.output = a.output.split('\n').map(function (l) { return l.replace(/(\S)\s{2,}/g, '$1  '); }).join('\n');
      logRun(a);
    });
  }

  toggle.addEventListener('click', function () {
    if (info && !info.installed) return startUpdate('Installing the latest Tailscale…');
    if (needsLogin()) {
      busy = true; render();
      ctl('login', function (a) {
        logRun(a);
        busy = false;
        refresh(function () { setTimeout(watchLogin, 1500); });
      });
      return;
    }
    run(backend() === 'Running' ? 'down' : 'up');
  });

  exitBtn.addEventListener('click', function () {
    var st = info && info.status;
    var options = [{ name: 'none', ip: '' }];
    peersOf(st).filter(function (p) { return p.ExitNodeOption; }).forEach(function (p) {
      options.push({ name: p.HostName, ip: first(p.TailscaleIPs) || p.HostName });
    });
    if (options.length === 1) { log('No peer offers itself as an exit node.'); return; }
    var current = exitPeerOf(st);
    var idx = 0;
    if (current) options.forEach(function (o, i) { if (o.name === current.HostName) idx = i; });
    var next = options[(idx + 1) % options.length];
    run("exit-node '" + String(next.ip).replace(/'/g, '') + "'");
  });

  updateBtn.addEventListener('click', function () {
    if (!latest || latest === versionShort(info && info.version)) {
      busy = true; render();
      log('$ curl ' + 'https://pkgs.tailscale.com/stable/?mode=json');
      ctl('latest', function (a) {
        busy = false;
        if (a && a.latest) {
          latest = a.latest;
          log('latest ' + a.latest + ', installed ' + versionShort(a.current) +
            (latest === versionShort(a.current) ? ' — up to date' : ' — press Update to ' + latest));
        } else log('Could not reach pkgs.tailscale.com.');
        render();
      });
      return;
    }
    startUpdate('Updating to ' + latest + '…');
  });

  var shown = 0;   // update-log lines already in the console
  function startUpdate(msg) {
    busy = true; render();
    log(msg);
    ctl('update', function (a) {
      if (!a || !a.started) { busy = false; log((a && a.output) || 'Update did not start.'); render(); return; }
      shown = 0;
      watchUpdate();
    });
  }
  function watchUpdate() {
    ctl('update-log', function (a) {
      if (a) {
        var all = String(a.log || '').split('\n').filter(function (l) { return l.trim(); });
        if (all.length > shown) log(all.slice(shown).join('\n'));
        shown = all.length;
      }
      if (a && a.updating) { setTimeout(watchUpdate, 2000); return; }
      busy = false;
      latest = null;
      refresh();
    });
  }

  refreshBtn.addEventListener('click', function () { refresh(); statusText(); });

  bootBtn.addEventListener('click', function () { run(info && info.boot ? 'boot off' : 'boot on'); });

  // Logging out signs the TV out of the tailnet; getting back needs Log in and a phone, so it
  // takes a second press within five seconds.
  logoutBtn.addEventListener('click', function () {
    if (!armed) {
      armed = setTimeout(function () { armed = null; render(); }, 5000);
      log('Press Log out again to sign this TV out of the tailnet.');
      render();
      return;
    }
    clearTimeout(armed); armed = null;
    // Start the console afresh: the old one holds the last login link and this tailnet's devices.
    login = null; loggedURL = null;
    lines = []; logEl.textContent = '';
    run('logout');
  });

  // ---------- remote keys and wheel ----------
  function focusable() { return buttons.filter(function (b) { return !b.disabled; }); }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === 461 || k === 27) { window.close(); return; }
    var list = focusable(), i = list.indexOf(document.activeElement);
    if (k === 37 || k === 39) {
      if (!list.length) return;
      if (i < 0) i = 0; else i = (i + (k === 39 ? 1 : list.length - 1)) % list.length;
      list[i].focus(); e.preventDefault();
    } else if (k === 38 || k === 40) {
      scroller.scrollTop += k === 40 ? 160 : -160; e.preventDefault();
      if (i < 0 && list.length) list[0].focus();
    }
  });

  // The wheel (the Magic Remote's too) scrolls the console when the pointer is over it, and the
  // device list anywhere else.
  function onWheel(e) {
    var dy = e.deltaY;
    if (dy === undefined) dy = -(e.wheelDelta || 0);
    if (e.deltaMode === 1) dy *= 20;
    var t = e.target, box = scroller;
    while (t && t !== document.body) { if (t === logEl) { box = logEl; break; } t = t.parentNode; }
    box.scrollTop += dy;
    e.preventDefault();
  }
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('mousewheel', function (e) { if (!('onwheel' in document)) onWheel(e); }, { passive: false });

  // Laid out at 1200x675; zoom to fill the window (1.6 on the TV).
  function fit() {
    var z = Math.min(window.innerWidth / 1200, window.innerHeight / 675);
    if (z > 0) document.documentElement.style.zoom = z;
  }
  window.addEventListener('resize', fit);
  fit();
  if (window.TAILSCALE_DEMO) $('demoTag').hidden = false;

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh(schedule); else clearTimeout(timer);
  });

  refresh(function () {
    toggle.focus();
    schedule();
    if (info && info.installed) statusText();
    if (info && info.loggingIn) watchLogin();
    if (info && info.updating) { busy = true; render(); shown = 0; watchUpdate(); }
  });
})();
