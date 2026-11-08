#!/bin/sh
# Root side of the Tailscale app. The app runs it through the Homebrew Channel's exec:
#   sh ctl.sh status | status-text | up | down | exit-node [NAME]
#             login | login-log | logout | latest | update | update-log
# Each command prints one JSON object on stdout.
#
# Layout on the TV:
#   /home/root/sbin/tailscale_<version>_arm/   official static builds
#   /home/root/sbin/tailscale-current          symlink to the build in use
#   /home/root/tailscaled.state                the pairing

SBIN=/home/root/sbin
CUR=$SBIN/tailscale-current
STATE=/home/root/tailscaled.state
LOG=/tmp/tailscalectl-update.log
LOCK=/tmp/tailscalectl-update.lock
LOGIN_LOG=/tmp/tailscalectl-login.log
PKGS=https://pkgs.tailscale.com/stable
SELF=$(cd "$(dirname "$0")" && pwd)/ctl.sh

# A JSON string body, with newlines kept as \n so the console shows output as tailscale printed it.
json_str() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\t\r' '  ' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}
# One reply line: result STATUS COMMAND OUTPUT, where STATUS is the exit status of COMMAND.
result() {
  printf '{"ok":%s,"cmd":"%s","output":"%s"}\n' "$([ "$1" -eq 0 ] && echo true || echo false)" "$(json_str "$2")" "$(json_str "$3")"
}
# BusyBox timeout on this TV wants -t SECONDS; newer ones take SECONDS.
tmo_flag() { timeout -t 1 true 2>/dev/null && echo "-t"; }
daemon_pid() { pidof tailscaled | cut -d' ' -f1; }

# The newest tailscale_<version>_arm build that has both binaries.
newest_dir() {
  ls -d "$SBIN"/tailscale_*_arm 2>/dev/null | while read -r d; do
    [ -x "$d/tailscaled" ] && [ -x "$d/tailscale" ] && echo "$d"
  done | sort -t. -k1,1 -k2,2n -k3,3n | tail -n 1
}

# Make sure tailscale-current points at a working build.
ensure_link() {
  [ -x "$CUR/tailscaled" ] && [ -x "$CUR/tailscale" ] && return 0
  d=$(newest_dir)
  [ -n "$d" ] || return 1
  ln -sfn "$(basename "$d")" "$CUR"
}

version_of() { "$1/tailscale" version 2>/dev/null | head -n 1; }

start_daemon() {
  [ -n "$(daemon_pid)" ] && return 0
  setsid "$CUR/tailscaled" --state="$STATE" </dev/null >/dev/null 2>&1 &
  i=0
  while [ $i -lt 15 ]; do
    sleep 1
    # status exits non-zero while stopped or logged out, so look for a parsed reply
    "$CUR/tailscale" status --json 2>/dev/null | grep -q '"BackendState"' && return 0
    i=$((i + 1))
  done
  [ -n "$(daemon_pid)" ]
}

stop_daemon() {
  pid=$(daemon_pid)
  [ -n "$pid" ] || return 0
  kill "$pid"
  i=0
  while [ $i -lt 10 ] && kill -0 "$pid" 2>/dev/null; do sleep 1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  sleep 1
}

# The "tailscale up --qr" a login started, if it is still waiting.
login_pid() {
  for p in $(pidof tailscale); do
    tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null | grep -q ' up --qr' && { echo "$p"; return; }
  done
}

cmd_status() {
  ensure_link
  pid=$(daemon_pid)
  ver=$(version_of "$CUR")
  dir=$(basename "$(readlink "$CUR" 2>/dev/null)")
  st=null
  if [ -n "$pid" ]; then
    out=$("$CUR/tailscale" status --json 2>/dev/null)
    case "$out" in \{*) st=$out ;; esac
  fi
  upd=false; [ -d "$LOCK" ] && upd=true
  inst=false; [ -x "$CUR/tailscaled" ] && inst=true
  login=false; [ -n "$(login_pid)" ] && login=true
  printf '{"installed":%s,"running":%s,"pid":"%s","version":"%s","dir":"%s","updating":%s,"loggingIn":%s,"status":%s}\n' \
    "$inst" "$([ -n "$pid" ] && echo true || echo false)" "$pid" "$(json_str "$ver")" "$(json_str "$dir")" "$upd" "$login" "$st"
}

# What "tailscale version" and "tailscale status" print, for the console.
cmd_status_text() {
  ensure_link || { result 1 "tailscale status" "Tailscale is not installed. Use Install."; return; }
  out="$("$CUR/tailscale" version 2>&1 | head -n 3)
$("$CUR/tailscale" status 2>&1)"
  result 0 "tailscale version && tailscale status" "$out"
}

# This TV's kernel has no ip_tables module and /etc is read-only, so tailscaled can neither add
# firewall rules nor take over DNS; both only end in health warnings. These print the flags that
# turn them off, for TVs like this one.
needed_flags() {
  iptables -t filter -L -n >/dev/null 2>&1 || printf ' --netfilter-mode=off'
  if ( : >/etc/.tailscalectl-probe ) 2>/dev/null; then rm -f /etc/.tailscalectl-probe; else printf ' --accept-dns=false'; fi
}

# Turn them off once; the choice is kept in the state file, so the remote keys and tailscale.sh
# get it too.
fix_prefs() {
  prefs=$("$CUR/tailscale" debug prefs 2>/dev/null)
  flags=$(needed_flags)
  case "$flags" in *netfilter*)
    printf '%s' "$prefs" | grep -q '"NetfilterMode": 0' ||
      { "$CUR/tailscale" set --netfilter-mode=off >/dev/null 2>&1 && echo "Turned off netfilter mode (no iptables on this TV)."; } ;;
  esac
  case "$flags" in *accept-dns*)
    printf '%s' "$prefs" | grep -q '"CorpDNS": true' &&
      { "$CUR/tailscale" set --accept-dns=false >/dev/null 2>&1 && echo "Turned off DNS from the tailnet (/etc is read-only)."; } ;;
  esac
}

cmd_up() {
  ensure_link || { result 1 "tailscale up" "Tailscale is not installed. Use Install."; return; }
  start_daemon || { result 1 "tailscaled --state=$STATE" "tailscaled did not start"; return; }
  fixed=$(fix_prefs)
  # A bare "up": with any flag, tailscale up insists on repeating every non-default setting.
  out=$(timeout $(tmo_flag) 30 "$CUR/tailscale" up 2>&1); rc=$?
  [ -n "$fixed" ] && out="$fixed
$out"
  result $rc "tailscale up" "$out"
}

cmd_down() {
  if [ -z "$(daemon_pid)" ]; then result 0 "tailscale down" "tailscaled is not running"; return; fi
  out=$("$CUR/tailscale" down 2>&1); rc=$?
  result $rc "tailscale down" "$out"
}

cmd_exit_node() {
  if [ -z "$(daemon_pid)" ]; then result 1 "tailscale set --exit-node=$1" "tailscaled is not running"; return; fi
  out=$("$CUR/tailscale" set --exit-node="$1" 2>&1); rc=$?
  result $rc "tailscale set --exit-node=$1" "$out"
}

# Sign the TV in, the first time or once its key has expired. "tailscale up --qr" prints a login
# URL and a QR code for it, then waits (up to 15 minutes) until the TV is approved from a phone or
# computer; the app reads both from login-log. --reset starts from default settings, so the flags
# this TV needs are given again.
cmd_login() {
  ensure_link || { result 1 "tailscale up --qr" "Tailscale is not installed. Use Install first."; return; }
  start_daemon || { result 1 "tailscaled --state=$STATE" "tailscaled did not start"; return; }
  [ -n "$(login_pid)" ] && { result 0 "tailscale up --qr" "Already waiting for a login."; return; }
  flags=$(needed_flags)
  : >"$LOGIN_LOG"
  setsid timeout $(tmo_flag) 900 "$CUR/tailscale" up --qr --reset $flags </dev/null >>"$LOGIN_LOG" 2>&1 &
  result 0 "tailscale up --qr --reset$flags" "Waiting for the login URL..."
}

cmd_login_log() {
  waiting=false; [ -n "$(login_pid)" ] && waiting=true
  printf '{"waiting":%s,"log":"%s"}\n' "$waiting" "$(json_str "$(cat "$LOGIN_LOG" 2>/dev/null)")"
}

cmd_logout() {
  if [ -z "$(daemon_pid)" ]; then result 1 "tailscale logout" "tailscaled is not running"; return; fi
  out=$("$CUR/tailscale" logout 2>&1); rc=$?
  rm -f "$LOGIN_LOG"   # the old login link has no use now
  result $rc "tailscale logout" "$out"
}

latest_version() {
  curl -fsL --max-time 20 "$PKGS/?mode=json" 2>/dev/null |
    sed -n 's/.*"arm": *"tailscale_\([0-9.]*\)_arm\.tgz".*/\1/p' | head -n 1
}

cmd_latest() {
  ensure_link
  printf '{"latest":"%s","current":"%s"}\n' "$(latest_version)" "$(json_str "$(version_of "$CUR")")"
}

# Install or update, run detached with its output in $LOG.
do_update() {
  mkdir "$LOCK" 2>/dev/null || { echo "An update is already running."; return 1; }
  trap 'rm -rf "$LOCK" /tmp/tailscalectl-dl' EXIT
  old=""; cur=""
  if ensure_link; then
    old=$(readlink "$CUR"); cur=$(version_of "$CUR")
    echo "Current: $cur ($old)"
  else
    echo "Tailscale is not installed yet; installing the latest build."
    mkdir -p "$SBIN"
  fi
  new=$(latest_version)
  [ -n "$new" ] || { echo "Could not read the latest version from $PKGS."; return 1; }
  echo "Latest:  $new"
  if [ -n "$cur" ]; then
    case "$cur" in "$new"|"$new-"*) echo "Already up to date."; echo "DONE"; return 0 ;; esac
  fi
  dest=tailscale_${new}_arm
  if [ ! -x "$SBIN/$dest/tailscaled" ]; then
    rm -rf /tmp/tailscalectl-dl && mkdir -p /tmp/tailscalectl-dl && cd /tmp/tailscalectl-dl || return 1
    echo "Downloading $dest.tgz ..."
    curl -fsSL --max-time 300 -o t.tgz "$PKGS/$dest.tgz" || { echo "Download failed."; return 1; }
    want=$(curl -fsL --max-time 20 "$PKGS/$dest.tgz.sha256" | cut -c1-64)
    got=$(sha256sum t.tgz | cut -c1-64)
    [ -n "$want" ] && [ "$want" = "$got" ] || { echo "Checksum mismatch (want $want, got $got)."; return 1; }
    echo "Checksum OK. Unpacking ..."
    tar xzf t.tgz || { echo "Unpack failed."; return 1; }
    "./$dest/tailscale" version >/dev/null 2>&1 || { echo "The new build does not run on this TV."; return 1; }
    rm -rf "${SBIN:?}/$dest" && mv "$dest" "$SBIN/$dest" || { echo "Could not move the build into $SBIN."; return 1; }
    cd / && rm -rf /tmp/tailscalectl-dl
  fi
  was=$(daemon_pid)
  [ -n "$was" ] && { echo "Stopping tailscaled ($was) ..."; stop_daemon; }
  ln -sfn "$dest" "$CUR"
  # Start it after a first install too, so the TV can be signed in.
  if [ -n "$was" ] || [ -z "$old" ]; then
    echo "Starting tailscaled ..."
    if ! start_daemon; then
      if [ -n "$old" ]; then
        echo "The new tailscaled did not start. Going back to $old."
        stop_daemon; ln -sfn "$old" "$CUR"; start_daemon
      else
        echo "tailscaled did not start."
      fi
      return 1
    fi
  fi
  echo "Now: $(version_of "$CUR")"
  # Keep the build in use and the one before it, for going back by hand.
  for d in "$SBIN"/tailscale_*_arm; do
    [ -e "$d" ] || continue
    b=$(basename "$d")
    [ "$b" = "$dest" ] || [ "$b" = "$old" ] || { echo "Removing $b"; rm -rf "$d"; }
  done
  echo "DONE"
}

cmd_update() {
  if [ -d "$LOCK" ]; then echo '{"started":false,"output":"an update is already running"}'; return; fi
  : >"$LOG"
  setsid sh "$SELF" do-update </dev/null >>"$LOG" 2>&1 &
  echo '{"started":true}'
}

cmd_update_log() {
  upd=false; [ -d "$LOCK" ] && upd=true
  printf '{"updating":%s,"log":"%s"}\n' "$upd" "$(json_str "$(tail -n 40 "$LOG" 2>/dev/null)")"
}

case "$1" in
  status) cmd_status ;;
  status-text) cmd_status_text ;;
  up) cmd_up ;;
  down) cmd_down ;;
  exit-node) cmd_exit_node "$2" ;;
  login) cmd_login ;;
  login-log) cmd_login_log ;;
  logout) cmd_logout ;;
  latest) cmd_latest ;;
  update) cmd_update ;;
  do-update) do_update ;;
  update-log) cmd_update_log ;;
  *) echo '{"error":"usage: ctl.sh status|status-text|up|down|exit-node [NAME]|login|login-log|logout|latest|update|update-log"}' ;;
esac
