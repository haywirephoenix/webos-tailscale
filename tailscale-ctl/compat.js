// The Compatibility box and its form: yes or no questions, sent with the TV's model and versions as
// an anonymous report to the relay (github.com/haywirephoenix/webos-compat), which adds it to
// COMPATIBILITY.md on GitHub. Nothing is sent until Send is pressed. Plain ES5, for webOS 5.
window.Compat = (function () {
  'use strict';
  var REPORT_URL = 'https://haywire.webos-compat.workers.dev/report';
  var COUNT_URL = 'https://raw.githubusercontent.com/haywirephoenix/webos-tailscale/main/compat/reports.json';
  var TABLE = 'github.com/haywirephoenix/webos-tailscale/blob/main/COMPATIBILITY.md';
  var SENT_KEY = 'tailscalectl.reported';
  // Keep in step with QUESTIONS in tools/compat.py.
  var QUESTIONS = [
    ['installs', 'Tailscale installs and updates from the app'],
    ['login', 'The TV signs in with the QR code'],
    ['connects', 'It connects and lists my devices'],
    ['reach_tv', 'I can reach the TV from another device'],
    ['reach_out', 'The TV can reach my other devices'],
    ['exit_node', 'Using an exit node works'],
    ['boot', 'It connects again after restarting the TV']
  ];
  function $(id) { return document.getElementById(id); }
  var panel = $('compat'), list = $('questions'), about = $('aboutTv'), result = $('sendNote');
  var sendButton = $('send'), cancelButton = $('cancelReport');
  var cardButton = $('report'), cardNote = $('reportNote'), count = $('reportCount');
  var ctl = null, onClose = null, open = false, opened = 0, info = null, sending = false, answers = {};
  var demo = !!window.TAILSCALE_DEMO;

  function stored() {
    try { return window.localStorage.getItem(SENT_KEY) || ''; } catch (e) { return ''; }
  }
  function remember(version) {
    if (demo) return;
    try { window.localStorage.setItem(SENT_KEY, version); } catch (e) {}
  }
  // One report per app version, so after sending it thanks you until the next update.
  function showCard(version) {
    var sent = version && stored() === version;
    cardButton.disabled = !!sent;
    cardButton.textContent = sent ? 'Report sent' : 'Send a report';
    cardNote.textContent = sent ?
      'Thank you for your report. You can send another after an update.' :
      'Looking for testers! Help support this app by sending an anonymous compatibility report.';
  }
  function showCount(total) {
    count.textContent = total > 0 ? '(' + total + ')' : '';
  }
  function fetchCount() {
    if (demo) return showCount(7);
    var x = new XMLHttpRequest();
    x.onload = function () {
      try { showCount(JSON.parse(x.responseText).total); } catch (e) {}
    };
    x.open('GET', COUNT_URL);
    x.send();
  }
  function tick(button, key) {
    answers[key] = !answers[key];
    button.className = 'ctl check' + (answers[key] ? ' on' : '');
    button.setAttribute('aria-pressed', answers[key] ? 'true' : 'false');
  }
  function draw() {
    list.innerHTML = '';
    QUESTIONS.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'ctl check';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<i></i>';
      b.appendChild(document.createTextNode(q[1]));
      b.addEventListener('click', function () { tick(b, q[0]); });
      list.appendChild(b);
    });
  }
  function report() {
    var s = info && info.system || {}, all = {};
    // Every question, so that a TV where nothing works is reported too.
    QUESTIONS.forEach(function (q) { all[q[0]] = !!answers[q[0]]; });
    return {
      app: 'tailscale',
      model: String(s.modelName || ''),
      webos: String(info && info.webos || s.sdkVersion || ''),
      firmware: s.firmwareVersion ? String(s.firmwareVersion) : undefined,
      version: String(info && info.version || ''),
      answers: all
    };
  }
  function say(text, className) {
    result.textContent = text;
    result.className = 'note' + (className ? ' ' + className : '');
  }
  function ready(a) {
    info = a;
    var r = report();
    if (!r.model || !r.webos || !r.version) {
      about.textContent = 'This TV\'s model or webOS version could not be read, so a report can\'t be sent.';
      sendButton.disabled = true;
      return;
    }
    about.textContent = 'Sent with your answers: ' + r.model + ', webOS ' + r.webos +
      (r.firmware ? ', firmware ' + r.firmware : '') + ', app ' + r.version +
      '. Nothing else: no IDs, no device names or addresses. Results appear on ' + TABLE + '.';
    sendButton.disabled = false;
    showCard(r.version);
  }
  function done(status, text) {
    sending = false;
    sendButton.textContent = 'Send';
    if (status === 200 || status === 409) {
      remember(info.version);
      showCard(info.version);
      say(status === 200 ? 'Sent. Thank you!' : 'A report for this version was already sent from here. Thank you!', 'go');
      sendButton.disabled = true;
      cancelButton.textContent = 'Close';
      cancelButton.focus();
      // The thanks stays long enough to read, then the form closes by itself.
      var shown = opened;
      setTimeout(function () { if (open && opened === shown) close(); }, 2500);
      return;
    }
    var error = '';
    try { error = JSON.parse(text).error; } catch (e) {}
    say(status === 429 ? 'Too many tries. Wait a minute and send again.' :
      status === 503 ? 'Today\'s reports are full. Please try again tomorrow.' :
      'It could not be sent' + (error ? ': ' + error : status ? '' : ': no connection') + '. Try again later.', 'error');
  }
  function send() {
    if (sending || !info) return;
    sending = true;
    sendButton.textContent = 'Sending…';
    say('');
    if (demo) return setTimeout(function () { done(200, ''); }, 600);
    var x = new XMLHttpRequest();
    x.onload = function () { done(x.status, x.responseText); };
    x.onerror = function () { done(0, ''); };
    x.timeout = 15000;
    x.ontimeout = x.onerror;
    x.open('POST', REPORT_URL);
    // Plain text keeps it a simple request, with no preflight; the relay reads it as JSON.
    x.setRequestHeader('Content-Type', 'text/plain');
    x.send(JSON.stringify(report()));
  }
  function close() {
    if (!open) return;
    open = false;
    panel.style.display = 'none';
    if (onClose) onClose();
  }
  sendButton.addEventListener('click', send);
  cancelButton.addEventListener('click', close);
  draw();
  fetchCount();

  return {
    isOpen: function () { return open; },
    close: close,
    // The form's buttons, in order, for the remote's arrow keys.
    buttons: function () {
      return Array.prototype.filter.call(panel.getElementsByTagName('button'), function (b) { return !b.disabled; });
    },
    // Reads the app version early, so the box knows whether this version was already reported.
    init: function (call) {
      call('info', function (a) { if (a) { info = a; showCard(a.version); } });
    },
    open: function (call, closed) {
      ctl = call;
      onClose = closed;
      open = true;
      opened++;
      answers = {};
      draw();
      say('');
      cancelButton.textContent = 'Cancel';
      sendButton.textContent = 'Send';
      sendButton.disabled = true;
      about.textContent = 'Reading this TV\'s model…';
      panel.style.display = 'flex';
      list.firstChild.focus();
      ctl('info', ready);
    }
  };
})();
