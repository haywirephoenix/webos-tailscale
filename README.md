# Tailscale for LG webOS TVs

> **Not affiliated with Tailscale.** This is an unofficial community app. It is not made, endorsed or
> supported by Tailscale Inc. "Tailscale" is a trademark of Tailscale Inc. The app downloads the
> official Tailscale builds from `pkgs.tailscale.com`; it does not include or change them.

A Homebrew Channel app for running [Tailscale](https://tailscale.com) on a rooted LG webOS TV. It
installs and updates the official Tailscale build, signs the TV in to your tailnet with a QR code,
brings it up and down, picks an exit node, and shows the devices on your tailnet and what Tailscale
is doing.

Built on an LG OLED55BX6LB (webOS 5.4.3, 32-bit ARM) with Homebrew Channel 0.7.3. Looking for testers!
If you try it on another TV, send a report from the app's **Compatibility** box: it's anonymous, and
the results go in [COMPATIBILITY.md](COMPATIBILITY.md). A report holds the TV's model, webOS and
firmware versions, the app version and your yes or no answers, and is sent only when you press
**Send**, through [webos-compat](https://github.com/haywirephoenix/webos-compat).

## Requirements

- A rooted LG webOS TV with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)
  installed. The app does its root work through the Homebrew Channel's `exec` service.
- An internet connection on the TV, for installing Tailscale and signing in.
- A Tailscale account.

## Install

1. In Homebrew Channel, open **Settings**, choose **Add repository** and enter
   `https://haywirephoenix.github.io/webos-homebrew/apps.json`.
2. Install **Tailscale** from the list of apps.

Or download the IPK from the [releases](https://github.com/haywirephoenix/webos-tailscale/releases)
and install it from a PC with the webOS CLI:

```sh
ares-install -d <device> com.homebrew.tailscalectl_<version>_all.ipk
```

## First run

1. Open **Tailscale**. On a TV without Tailscale, the main button says **Install Tailscale**. It
   downloads the latest official ARM build from `pkgs.tailscale.com`, checks its SHA-256 checksum,
   puts it in `/home/root/sbin`, and starts `tailscaled`.
2. The main button then says **Log in**. The app shows a QR code and a login link. Scan the code
   with a phone signed in to Tailscale, or open the link on any device, and approve the TV.
3. The TV joins your tailnet. From then on the main button is **Connect** or **Disconnect**.

The same **Log in** button comes back if the TV's key expires or after **Log out**.

## Using it

The remote's left and right arrows move between the buttons; up and down, or the Magic Remote's
wheel, scroll the device list. The wheel scrolls the console when the pointer is over it.

| Button | What it does |
| --- | --- |
| Connect / Disconnect | `tailscale up` or `tailscale down`. Starts `tailscaled` first if it isn't running. |
| Exit node | Cycles through *none* and each device that offers itself as an exit node (`tailscale set --exit-node`). |
| Check for update / Update to … | Looks up the latest stable version, then on a second press downloads it, checks it and switches to it. If the new `tailscaled` won't start, it goes back to the old build. The build in use and the one before it are kept. |
| Refresh | Reads the status now and prints `tailscale version` and `tailscale status` to the console. |
| Boot: on / off | Start at boot. When it's on, Tailscale starts and connects each time the TV starts; a press turns it the other way. See [Start at boot](#start-at-boot). |
| Log out | `tailscale logout`. Needs a second press within five seconds, then clears the console. |

The **devices** list shows this TV first, then the other devices on the tailnet: address, OS, when
they were last seen, whether they're connected directly or through a relay, exit nodes, and expired
keys. Health warnings appear above it while Tailscale is up.

The **console** shows each command the app runs and what Tailscale printed, and what changes between
the checks it makes every five seconds: the state, devices coming online or going offline, a device
switching between a direct connection and a relay, the exit node, new warnings, and the daemon
starting, stopping or changing version.

## Files on the TV

| Path | |
| --- | --- |
| `/home/root/sbin/tailscale_<version>_arm/` | Official static builds (`tailscale`, `tailscaled`). |
| `/home/root/sbin/tailscale-current` | Symlink to the build in use. Scripts and key bindings should use this path, so they keep working after an update. |
| `/home/root/tailscaled.state` | The TV's Tailscale identity and settings. |
| `/var/lib/webosbrew/init.d/70-tailscale` | The start-at-boot script, there only while **Boot** is on. |
| `/tmp/tailscalectl-update.log`, `/tmp/tailscalectl-login.log` | Output of the last update and login. |

`tailscaled` runs as `tailscaled --state=/home/root/tailscaled.state`. Only one `tailscaled` can run
at a time.

### Start at boot

By default Tailscale isn't started at boot: the app, or a script of your own, starts it when it's
needed. Turn **Boot** on and the app writes `/var/lib/webosbrew/init.d/70-tailscale`, which the
Homebrew Channel runs each time the TV starts. About ten seconds after boot, it starts `tailscaled`
(unless one is already running) and runs `tailscale up`. Turning **Boot** off deletes the script.

The script uses `tailscale-current`, so it keeps working after an update, and it stands on its own,
so it keeps working even if the app is removed. Delete the file to stop it by hand.

### Settings this TV needs

On the TV it was built on, the kernel has no `ip_tables` module and `/etc` is read-only. Tailscale
can't add firewall rules or take over DNS there, and only reports health warnings about it, so the
app turns both off when it signs in or connects:

```sh
tailscale set --netfilter-mode=off   # no iptables
tailscale set --accept-dns=false     # /etc is read-only
```

The settings are saved in the state file. Names on the tailnet (MagicDNS) then don't resolve on the
TV itself; reaching devices by their Tailscale address works, and so does reaching the TV from
other devices.

Once these are set, `tailscale up` has to be run without flags. With any flag, Tailscale asks for
every non-default setting to be given again.

## Remote keys and scripts

The app works alongside [lginputhook](https://github.com/webosbrew/lginputhook) key bindings and your
own scripts. Point them at `tailscale-current` and find the daemon with `pidof tailscaled`, for
example:

```sh
TS=/home/root/sbin/tailscale-current
[ -z "$(pidof tailscaled)" ] && setsid $TS/tailscaled --state=/home/root/tailscaled.state </dev/null >/dev/null 2>&1 &
$TS/tailscale up
```

## How it works

```
index.html / app.js  --PalmServiceBridge-->  luna://org.webosbrew.hbchannel.service/exec  -->  ctl.sh (root)
```

The app is a plain web app and can't run commands itself, so it asks the Homebrew Channel to run
`ctl.sh`, which ships inside the app. Each `ctl.sh` command prints one line of JSON:

| Command | |
| --- | --- |
| `status` | Whether Tailscale is installed and running, its version, whether it starts at boot, and `tailscale status --json`. |
| `status-text` | `tailscale version` and `tailscale status`, for the console. |
| `up`, `down` | `tailscale up` (bare, with a 30-second limit) or `tailscale down`. |
| `exit-node [IP]` | `tailscale set --exit-node=IP`; no IP clears it. |
| `login`, `login-log` | Starts `tailscale up --qr --reset` in the background, and reads what it printed (the link and the QR code as text, which the app draws). |
| `logout` | `tailscale logout`. |
| `boot on`, `boot off` | Writes or deletes the start-at-boot script. `status` reports whether it's on. |
| `latest` | The latest stable version from `pkgs.tailscale.com`. |
| `update`, `update-log` | Installs or updates in the background, and reads its progress. |

The app is plain ES5 for the web engine of webOS 5 (Chrome 68). That engine has no `gap` for flex
layouts, so the stylesheet spaces things with margins.

## Demo mode

To preview the app on a PC, serve the `tailscale-ctl` folder and open it in a browser:

```sh
python -m http.server 8123 --bind 127.0.0.1 -d tailscale-ctl
```

Then open `http://localhost:8123/`.

Without the TV's service bridge, `demo.js` stands in for `ctl.sh` with made-up data, and every button
works. Choose where it starts with `?state=`:

| State | |
| --- | --- |
| `stopped` | Signed in, Tailscale down (the default). |
| `running` | Tailscale up. |
| `many` | Up, with 19 devices, to try scrolling. |
| `exit` | Up, using an exit node. |
| `warn` | Up, with a health warning. |
| `login` | Needs signing in. **Log in** shows a QR code, and the TV is "approved" after about 14 seconds. |
| `fresh` | Tailscale not installed. **Install Tailscale** runs a pretend install. |
| `nodaemon` | Installed, `tailscaled` not running. |
| `updating` | An update in progress. |

Add `&boot=on` to start with **Boot** turned on.

On the TV, start demo mode with launch parameters:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.homebrew.tailscalectl","params":{"demo":true,"state":"many"}}'
```

A **DEMO** tag appears beside the buttons whenever demo mode is on.

## Building

```sh
python tools/build.py
```

This writes `dist/com.homebrew.tailscalectl_<version>_all.ipk` and the release's manifest, which
the [webos-homebrew](https://github.com/haywirephoenix/webos-homebrew) listing points at. It needs
only Python 3.

## Licence

MIT, see [LICENSE](LICENSE).
