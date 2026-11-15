#!/bin/sh
# Root side of the Tailscale app. The app runs it through the Homebrew Channel's exec:
#   sh ctl.sh status | status-text | up | down | exit-node [NAME]
#             login | login-log | logout | boot on|off | latest | update | update-log | info
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
BOOT=/var/lib/webosbrew/init.d/70-tailscale   # the Homebrew Channel runs init.d at boot
PKGS=https://pkgs.tailscale.com/stable
SELF=$(cd "$(dirname "$0")" && pwd)/ctl.sh

# Kernels without policy routing ("ip rule" fails, as on some TVs). tailscaled keeps its own traffic
# out of the tunnel with a socket mark and an ip rule. Without policy routing the mark does nothing,
# and an exit node's default route replaces the TV's own in the main table, so tailscaled's packets
# loop into the tunnel and nothing gets out. So there tailscaled binds its sockets to the network
# interface instead (TS_FORCE_LINUX_BIND_TO_DEVICE), and keep_routes adds two routes: a second
# default route through the router, with a high metric, which tailscaled's replace leaves alone and
# its bound sockets use; and the local network, which would otherwise go through the exit node too.
# The boot script gets a copy of these, so keep them standing on their own.
ROUTES_FN=$(cat <<'EOF'
TSCTL_METRIC=4242
TSCTL_GW=/tmp/tailscalectl-gw
no_policy_routing() { ! ip rule >/dev/null 2>&1; }
bind_env() { no_policy_routing && export TS_FORCE_LINUX_BIND_TO_DEVICE=true; return 0; }
keep_routes() {
  no_policy_routing || return 0
  set -- $(ip -4 route show default 2>/dev/null | grep -v 'dev tailscale' |
    sed -n 's/^default via \([0-9.]*\) dev \([^ ]*\).*/\1 \2/p' | head -n 1)
  if [ -n "$2" ]; then echo "$1 $2" >"$TSCTL_GW"; else set -- $(cat "$TSCTL_GW" 2>/dev/null); fi
  [ -n "$2" ] || return 0
  ip -4 route show default | grep -q "via $1 dev $2 .*metric $TSCTL_METRIC" ||
    ip route add default via "$1" dev "$2" metric $TSCTL_METRIC 2>/dev/null
  lan=$(ip -4 -o addr show dev "$2" 2>/dev/null | sed -n 's/.* inet \([0-9.]*\/[0-9]*\).*/\1/p' | head -n 1 |
    awk -F'[./]' '$5 >= 8 && $5 < 32 { s = 2 ^ (32 - $5); v = int(((($1 * 256 + $2) * 256 + $3) * 256 + $4) / s) * s
      printf "%d.%d.%d.%d/%d", int(v / 16777216), int(v / 65536) % 256, int(v / 256) % 256, v % 256, $5 }')
  [ -n "$lan" ] || return 0
  ip -4 route show "$lan" 2>/dev/null | grep -q . || ip route add "$lan" dev "$2" metric $TSCTL_METRIC 2>/dev/null
  return 0
}
EOF
)
eval "$ROUTES_FN"

# Whether the running tailscaled has the setting it needs here (it is read once, at start).
daemon_env_ok() {
  no_policy_routing || return 0
  p=$(daemon_pid)
  [ -z "$p" ] || tr '\0' '\n' <"/proc/$p/environ" 2>/dev/null | grep -q '^TS_FORCE_LINUX_BIND_TO_DEVICE='
}
# Restart tailscaled if it is running without it; prints a line for the console when it does.
fix_daemon_env() {
  daemon_env_ok && return 0
  echo "Restarted tailscaled so its own traffic stays off the tunnel (this TV has no policy routing)."
  stop_daemon; start_daemon
}

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
  keep_routes
  ( bind_env; exec setsid "$CUR/tailscaled" --state="$STATE" ) </dev/null >/dev/null 2>&1 &
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
  [ -n "$pid" ] && keep_routes
  [ -x "$BOOT" ] && ! grep -q 'keep_routes' "$BOOT" && write_boot
  if [ -n "$pid" ]; then
    out=$("$CUR/tailscale" status --json 2>/dev/null)
    case "$out" in \{*) st=$out ;; esac
  fi
  upd=false; [ -d "$LOCK" ] && upd=true
  inst=false; [ -x "$CUR/tailscaled" ] && inst=true
  login=false; [ -n "$(login_pid)" ] && login=true
  boot=false; [ -x "$BOOT" ] && boot=true
  printf '{"installed":%s,"running":%s,"pid":"%s","version":"%s","dir":"%s","updating":%s,"loggingIn":%s,"boot":%s,"status":%s}\n' \
    "$inst" "$([ -n "$pid" ] && echo true || echo false)" "$pid" "$(json_str "$ver")" "$(json_str "$dir")" "$upd" "$login" "$boot" "$st"
}

# Start at boot. The script stands on its own, so it keeps working after an update (it uses
# tailscale-current) and even if the app is removed; turning it off deletes it. At boot it starts
# tailscaled unless one is running, then brings Tailscale up.
write_boot() {
  mkdir -p "$(dirname "$BOOT")"
  {
    cat <<'EOF'
#!/bin/sh
# Starts Tailscale at boot. Written by the Tailscale app (com.homebrew.tailscalectl): turn it off
# there, or delete this file. The Homebrew Channel runs it from /var/lib/webosbrew/init.d.
TS=/home/root/sbin/tailscale-current
EOF
    printf '%s\n' "$ROUTES_FN"
    cat <<'EOF'
(
  sleep 10
  [ -x "$TS/tailscaled" ] || exit 0
  # Wait for the network, so the routes this TV may need can be kept.
  i=0
  while [ $i -lt 60 ] && ! ip -4 route show default | grep -q ' via '; do sleep 1; i=$((i + 1)); done
  keep_routes
  if [ -z "$(pidof tailscaled)" ]; then
    ( bind_env; exec setsid "$TS/tailscaled" --state=/home/root/tailscaled.state ) </dev/null >/dev/null 2>&1 &
  fi
  i=0
  while [ $i -lt 30 ]; do
    "$TS/tailscale" status --json 2>/dev/null | grep -q '"BackendState"' && break
    sleep 1; i=$((i + 1))
  done
  # A bare "up": the settings this TV needs are already saved in the state file.
  if timeout -t 1 true 2>/dev/null; then timeout -t 60 "$TS/tailscale" up; else timeout 60 "$TS/tailscale" up; fi
  keep_routes
) </dev/null >/dev/null 2>&1 &
exit 0
EOF
  } >"$BOOT"
  chmod 755 "$BOOT"
}

cmd_boot() {
  case "$1" in
    on)
      write_boot
      if [ -x "$BOOT" ] && sh -n "$BOOT"; then result 0 "boot on" "Tailscale starts at boot ($BOOT)."
      else result 1 "boot on" "Could not write $BOOT."; fi ;;
    off)
      rm -f "$BOOT"
      if [ -e "$BOOT" ]; then result 1 "boot off" "Could not remove $BOOT."
      else result 0 "boot off" "Tailscale no longer starts at boot."; fi ;;
    *) result 1 "boot $1" "usage: ctl.sh boot on|off" ;;
  esac
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
  fixed=$(fix_daemon_env; fix_prefs)
  keep_routes
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

# With an exit node, the TV keeps its local network (casting, the router, SSH from a PC).
cmd_exit_node() {
  if [ -z "$(daemon_pid)" ]; then result 1 "tailscale set --exit-node=$1" "tailscaled is not running"; return; fi
  note=""
  if [ -n "$1" ]; then
    keep_routes
    note=$(fix_daemon_env)
    set -- "$1" --exit-node-allow-lan-access=true
  fi
  out=$("$CUR/tailscale" set --exit-node="$1" $2 2>&1); rc=$?
  keep_routes
  [ -n "$note" ] && out="$note${out:+
$out}"
  result $rc "tailscale set --exit-node=$1${2:+ $2}" "$out"
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

# The TV's model, webOS and firmware versions and this app's version, for a compatibility report.
cmd_info() {
  sys=$(luna-send -n 1 luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName","firmwareVersion","sdkVersion"]}' 2>/dev/null | tail -n 1)
  case "$sys" in "{"*) ;; *) sys='{}' ;; esac
  release=$(nyx-cmd OSInfo query webos_release 2>/dev/null | tr -cd '0-9.')
  version=$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$(dirname "$SELF")/appinfo.json")
  printf '{"system":%s,"webos":"%s","version":"%s"}\n' "$sys" "$release" "$version"
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
  boot) cmd_boot "$2" ;;
  latest) cmd_latest ;;
  update) cmd_update ;;
  do-update) do_update ;;
  update-log) cmd_update_log ;;
  info) cmd_info ;;
  *) echo '{"error":"usage: ctl.sh status|status-text|up|down|exit-node [NAME]|login|login-log|logout|boot on|off|latest|update|update-log"}' ;;
esac
